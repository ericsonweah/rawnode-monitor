'use strict';

import { EventEmitter } from 'node:events';
import BoundedSignalQueue from '../pipeline/BoundedSignalQueue.js';
import {
  boundedInteger,
  boundedNumber,
  bytesOf,
  cooperativeYield,
  deepFreeze,
  elapsedMs,
  errorRecord,
  nowNs,
  withTimeout,
} from '../support.js';

/** Deterministic lifecycle and bounded hook manager for first-party/userland Monitor plugins. */
export class MonitorPluginManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.enabled = options.enabled !== false;
    this.errorPolicy = options.errorPolicy || 'isolate';
    this.maxPlugins = boundedInteger(options.maxPlugins, 1_000, 1, 100_000);
    this.callbackTimeoutMs = boundedInteger(options.callbackTimeoutMs, 5_000, 1, 300_000);
    this.maxHooks = boundedInteger(options.maxHooks, 10_000, 1, 1_000_000);
    this.maxPendingCallbacks = boundedInteger(options.maxPendingCallbacks, 1_000, 1, 100_000);
    this.pendingCallbacks = new Map();
    this.hookCount = 0;
    this.controller = new AbortController();
    this.setupPromise = null;
    this.startPromise = null;
    this.closePromise = null;
    this.hookBatchSize = boundedInteger(options.hookBatchSize, 128, 1, 10_000);
    this.hookBudgetMs = boundedNumber(options.hookBudgetMs, 4, 0.25, 1_000);
    this.maxHookBytes = boundedInteger(options.maxHookBytes, 1024 * 1024, 256, 64 * 1024 * 1024);
    const hookOverflow = ['drop-new', 'drop-oldest'].includes(String(options.hookOverflow)) ? String(options.hookOverflow) : 'drop-oldest';
    const maxPendingBytes = boundedInteger(options.maxPendingBytes, 16 * 1024 * 1024, 1_024, 1024 * 1024 * 1024);
    this.notifications = new BoundedSignalQueue({
      maxItems: boundedInteger(options.maxPendingHooks, 10_000, 1, 1_000_000),
      maxBytes: maxPendingBytes,
      maxSignalBytes: Math.min(this.maxHookBytes, maxPendingBytes),
      overflow: hookOverflow,
      sizeOf: (entry) => Math.min(
        this.maxHookBytes + 1,
        128 + bytesOf(entry?.payload, this.maxHookBytes) + bytesOf(entry?.context, Math.min(this.maxHookBytes, 64 * 1024)),
      ),
    });
    this.plugins = new Map();
    this.hooks = new Map();
    this.order = [];
    this.runtime = null;
    this.setupComplete = false;
    this.started = false;
    this.closed = false;
    this.closing = false;
    this.frozen = false;
    this.notificationDrainPromise = null;
    this.stats = {
      registered: 0,
      setups: 0,
      starts: 0,
      flushes: 0,
      closes: 0,
      hookCalls: 0,
      hookErrors: 0,
      hookNotifications: 0,
      hookNotificationBatches: 0,
      hookNotificationDrops: 0,
    };
  }

  register(input, options = {}) {
    this._assertOpen();
    if (!this.enabled) return null;
    if (this.frozen) throw new Error('Monitor plugin registry is frozen.');
    const plugin = normalizePlugin(input, options);
    if (this.plugins.size >= this.maxPlugins && !this.plugins.has(plugin.id)) throw new Error(`Monitor plugin limit of ${this.maxPlugins} exceeded.`);
    if (this.plugins.has(plugin.id) && options.replace !== true) throw new Error(`Monitor plugin '${plugin.id}' is already registered.`);
    this.plugins.set(plugin.id, plugin);
    this.stats.registered++;
    return plugin;
  }

  hook(name, handler, options = {}) {
    this._assertOpen();
    if (this.frozen) throw new Error('Monitor plugin hooks are frozen.');
    if (typeof handler !== 'function') throw new TypeError('Monitor plugin hook requires a function.');
    if (this.hookCount >= this.maxHooks) throw Object.assign(new Error('Monitor plugin hook capacity exceeded.'), { code: 'MONITOR_PLUGIN_HOOK_LIMIT' });
    const key = String(name);
    const handlers = this.hooks.get(key) || [];
    const record = Object.freeze({ plugin: options.plugin || 'anonymous', handler, priority: Number(options.priority || 0), once: options.once === true });
    handlers.push(record);
    this.hookCount++;
    handlers.sort((left, right) => right.priority - left.priority || left.plugin.localeCompare(right.plugin));
    this.hooks.set(key, handlers);
    return () => this.offHook(key, handler);
  }

  offHook(name, handler) {
    const handlers = this.hooks.get(String(name));
    if (!handlers) return false;
    const index = handlers.findIndex((record) => record.handler === handler);
    if (index === -1) return false;
    handlers.splice(index, 1);
    this.hookCount--;
    if (!handlers.length) this.hooks.delete(String(name));
    return true;
  }

  async setup(runtime) {
    this._assertOpen();
    if (!this.enabled || this.setupComplete) return this;
    if (this.setupPromise) return this.setupPromise;
    this.setupPromise = this._setup(runtime);
    return this.setupPromise;
  }

  async _setup(runtime) {
    this.runtime = runtime;
    this.order = resolveOrder(this.plugins);
    for (const id of this.order) {
      this._assertOpen();
      const record = this.plugins.get(id);
      try {
        await this._callback(record.plugin.setup, record.plugin, signal => [createApi(this, runtime, record, signal)]);
        this._assertOpen();
        for (const [name, handler] of Object.entries(record.plugin.hooks || {})) this.hook(name, handler.bind(record.plugin), { plugin: id, priority: record.priority });
        record.state = 'ready'; record.setupAt = Date.now(); this.stats.setups++;
      } catch (error) { if (this.closing || this.closed) throw error; record.state = 'failed'; record.error = errorRecord(error); this._error(error, id, 'setup'); if (record.required || this.errorPolicy === 'propagate') throw error; }
    }
    this.setupComplete = true;
    return this;
  }

  async start(runtime = this.runtime) {
    this._assertOpen();
    if (!this.enabled || this.started) return this;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start(runtime);
    return this.startPromise;
  }

  async _start(runtime) {
    if (!this.setupComplete) await this.setup(runtime);
    for (const id of this.order) {
      this._assertOpen();
      const record = this.plugins.get(id);
      if (record.state === 'failed') continue;
      try { await this._callback(record.plugin.start, record.plugin, signal => [createApi(this, runtime, record, signal)]); this._assertOpen(); record.state = 'started'; record.startedAt = Date.now(); this.stats.starts++; }
      catch (error) { if (this.closing || this.closed) throw error; record.state = 'failed'; record.error = errorRecord(error); this._error(error, id, 'start'); if (record.required || this.errorPolicy === 'propagate') throw error; }
    }
    this.started = true;
    return this;
  }

  async invoke(name, payload, context = {}) {
    if (!this.enabled || this.closed || this.closing) return [];
    const handlers = [...(this.hooks.get(String(name)) || [])];
    const output = [];
    for (const record of handlers) {
      if (this.closed || this.closing) break;
      if (record.once) this.offHook(name, record.handler);
      try { output.push(await this._callback(record.handler, null, signal => [payload, { ...context, runtime: this.runtime, plugin: record.plugin, hook: String(name), signal }], { signal: context.signal })); this.stats.hookCalls++; }
      catch (error) { this.stats.hookErrors++; this._error(error, record.plugin, `hook:${name}`); if (this.errorPolicy === 'propagate') throw error; }
    }
    return output;
  }

  notify(name, payload, context = {}) {
    if (!this.enabled || this.closed || this.closing) return false;
    const hook = String(name);
    if (!this.hooks.has(hook)) return false;
    const result = this.notifications.tryPush(
      { name: hook, payload, context },
      { onDrop: () => { this.stats.hookNotificationDrops++; } },
    );
    if (!result.accepted) return false;
    this.stats.hookNotifications++;
    this._scheduleNotificationDrain();
    return true;
  }

  async drainNotifications(options = {}) {
    if (!this.enabled || this.closed || this.closing) return this.notifications.snapshot();
    await withTimeout(async signal => {
      do {
        signal.throwIfAborted();
        if (this.notifications.length && !this.notificationDrainPromise) this._scheduleNotificationDrain();
        const active = this.notificationDrainPromise;
        if (active) await active;
      } while (!this.closed && !this.closing && (this.notifications.length || this.notificationDrainPromise));
    }, options.timeoutMs || this.callbackTimeoutMs, { signal: this._signal(options.signal) });
    return this.notifications.snapshot();
  }

  async flush(options = {}) {
    if (!this.enabled || this.closed || this.closing) return this.snapshot();
    await this.drainNotifications(options);
    const failures = [];
    for (const id of this.order) {
      this._assertOpen();
      const record = this.plugins.get(id);
      if (record.state === 'failed') continue;
      if (typeof record.plugin.flush !== 'function') continue;
      try { await this._callback(record.plugin.flush, record.plugin, signal => [createApi(this, this.runtime, record, signal), { ...options, signal }], options); this.stats.flushes++; }
      catch (error) {
        record.error = errorRecord(error);
        failures.push({ record, error });
        this._error(error, id, 'flush');
      }
    }
    await this.drainNotifications(options);
    const fatal = failures.filter(({ record }) => record.required || options.throwOnError === true || this.errorPolicy === 'propagate');
    if (fatal.length) {
      const error = new AggregateError(fatal.map((entry) => entry.error), 'One or more required Monitor plugins failed during flush().');
      error.code = 'MONITOR_PLUGIN_FLUSH_FAILED';
      error.failures = fatal.map(({ record, error: failure }) => ({ plugin: record.id, required: record.required, error: errorRecord(failure) }));
      throw error;
    }
    return deepFreeze({ ok: failures.length === 0, failures: failures.map(({ record, error }) => ({ plugin: record.id, required: record.required, error: errorRecord(error) })), queue: this.notifications.snapshot() });
  }

  freeze() { this.frozen = true; return this; }
  get(id) { return this.plugins.get(String(id)) || null; }
  list() { return deepFreeze(Array.from(this.plugins.values(), publicRecord)); }
  snapshot() { return deepFreeze({ enabled: this.enabled, setupComplete: this.setupComplete, started: this.started, closing: this.closing, closed: this.closed, frozen: this.frozen, callbackTimeoutMs: this.callbackTimeoutMs, pendingCallbacks: this.pendingCallbacks.size, maxPendingCallbacks: this.maxPendingCallbacks, maxHooks: this.maxHooks, order: [...this.order], plugins: this.list(), hooks: Object.fromEntries(Array.from(this.hooks, ([name, handlers]) => [name, handlers.map((entry) => ({ plugin: entry.plugin, priority: entry.priority, once: entry.once }))])), notifications: this.notifications.snapshot(), stats: { ...this.stats } }); }

  async close(options = {}) {
    if (this.closePromise) return this.closePromise;
    if (this.closed) return this.snapshot();
    this.closing = true;
    this.controller.abort(Object.assign(new Error('Monitor plugin manager is closing.'), { code: 'MONITOR_PLUGIN_CLOSED' }));
    this.notifications.close();
    this.notifications.clear(() => { this.stats.hookNotificationDrops++; });
    this.closePromise = this._close(options);
    return this.closePromise;
  }

  async _close(options) {
    const failures = [];
    const deadline = Date.now() + boundedInteger(options.timeoutMs, this.callbackTimeoutMs, 1, 300_000);
    await Promise.allSettled([this.setupPromise, this.startPromise, this.notificationDrainPromise].filter(Boolean));
    const order = this.order.length ? this.order : [...this.plugins.keys()];
    for (const id of [...order].reverse()) {
      const record = this.plugins.get(id);
      for (const method of ['flush', 'close']) {
        if (method === 'flush' && !['ready', 'started'].includes(record.state)) continue;
        try { await this._callback(record.plugin[method], record.plugin, signal => [createApi(this, this.runtime, record, signal), { ...options, signal }], { cleanup: true, timeoutMs: Math.max(1, deadline - Date.now()) }); }
        catch (error) { record.error = errorRecord(error); this._error(error, id, method); if (record.required || options.throwOnError === true || this.errorPolicy === 'propagate') failures.push(error); }
      }
      record.state = 'closed'; record.closedAt = Date.now(); this.stats.closes++;
    }
    this.started = false;
    this.closed = true;
    this.closing = false;
    this.notifications.close();
    this.hooks.clear();
    this.hookCount = 0;
    this.removeAllListeners();
    if (failures.length && (options.throwOnError === true || this.errorPolicy === 'propagate')) {
      const error = new AggregateError(failures, 'Monitor plugin close completed with lifecycle failures.');
      error.code = 'MONITOR_PLUGIN_CLOSE_FAILED';
      throw error;
    }
    return this.snapshot();
  }

  _scheduleNotificationDrain() {
    if (this.notificationDrainPromise || this.closed || this.closing) return;
    this.notificationDrainPromise = new Promise((resolve) => queueMicrotask(resolve))
      .then(() => this._drainNotificationQueue())
      .catch((error) => this._error(error, 'manager', 'notification-drain'))
      .finally(() => {
        this.notificationDrainPromise = null;
        if (this.notifications.length && !this.closed && !this.closing) this._scheduleNotificationDrain();
      });
  }

  async _drainNotificationQueue() {
    let sliceStarted = nowNs();
    while (!this.closed && !this.closing && this.notifications.length) {
      const batch = this.notifications.shiftMany(this.hookBatchSize);
      this.stats.hookNotificationBatches++;
      for (const notification of batch) await this.invoke(notification.name, notification.payload, notification.context);
      if (this.notifications.length && elapsedMs(sliceStarted) >= this.hookBudgetMs) {
        await cooperativeYield();
        sliceStarted = nowNs();
      }
    }
  }

  _error(error, plugin, phase) { if (this.listenerCount('error') > 0) this.emit('error', error, plugin, phase); else this.emit('pluginError', { plugin, phase, error: errorRecord(error) }); }

  _assertOpen() { if (this.closing || this.closed) throw Object.assign(new Error('Monitor plugin manager is closed.'), { code: 'MONITOR_PLUGIN_CLOSED' }); }
  _signal(signal) { return signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal; }
  async _callback(handler, receiver, args, options = {}) {
    if (typeof handler !== 'function') return;
    if (!options.cleanup) this._assertOpen();
    if (this.pendingCallbacks.has(handler)) throw Object.assign(new Error('Monitor plugin callback is still pending.'), { code: 'MONITOR_PLUGIN_CALLBACK_BUSY' });
    if (this.pendingCallbacks.size >= this.maxPendingCallbacks) throw Object.assign(new Error('Monitor plugin pending-callback capacity exceeded.'), { code: 'MONITOR_PLUGIN_CALLBACK_LIMIT' });
    return withTimeout(signal => {
      const operation = Promise.resolve().then(() => { signal.throwIfAborted(); return handler.apply(receiver, args(signal)); });
      const tracked = operation.finally(() => { if (this.pendingCallbacks.get(handler) === tracked) this.pendingCallbacks.delete(handler); });
      this.pendingCallbacks.set(handler, tracked);
      return tracked;
    }, Math.min(this.callbackTimeoutMs, boundedInteger(options.timeoutMs, this.callbackTimeoutMs, 1, 300_000)), { signal: options.cleanup ? options.signal : this._signal(options.signal) });
  }
}

function normalizePlugin(input, options) {
  let plugin = input;
  if (typeof input === 'function') {
    try { plugin = new input(options.options || {}); }
    catch { plugin = input(options.options || {}); }
  }
  if (!plugin || typeof plugin !== 'object') throw new TypeError('Monitor plugins must be objects, classes, or factories.');
  const id = String(options.id || plugin.id || plugin.name || plugin.constructor?.name || '').trim();
  if (!id) throw new TypeError('Monitor plugins require a stable id.');
  return { id, plugin, version: String(plugin.version || options.version || '0.0.0'), dependencies: Object.freeze(Array.from(new Set((plugin.dependencies || options.dependencies || []).map(String)))), optionalDependencies: Object.freeze(Array.from(new Set((plugin.optionalDependencies || options.optionalDependencies || []).map(String)))), priority: Number(plugin.priority ?? options.priority ?? 0), required: plugin.required === true || options.required === true, state: 'registered', error: null, registeredAt: Date.now(), setupAt: null, startedAt: null, closedAt: null };
}

function resolveOrder(plugins) {
  const visiting = new Set(); const visited = new Set(); const output = [];
  const visit = (id, trail = []) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw Object.assign(new Error(`Monitor plugin dependency cycle: ${[...trail, id].join(' -> ')}`), { code: 'MONITOR_PLUGIN_CYCLE' });
    const record = plugins.get(id); if (!record) throw Object.assign(new Error(`Monitor plugin dependency '${id}' is not registered.`), { code: 'MONITOR_PLUGIN_DEPENDENCY_MISSING' });
    visiting.add(id);
    for (const dependency of record.dependencies) visit(dependency, [...trail, id]);
    for (const dependency of record.optionalDependencies) if (plugins.has(dependency)) visit(dependency, [...trail, id]);
    visiting.delete(id); visited.add(id); output.push(id);
  };
  const ids = Array.from(plugins.values()).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id)).map((entry) => entry.id);
  for (const id of ids) visit(id);
  return output;
}

function createApi(manager, runtime, record, signal = manager.controller.signal) { return Object.freeze({ abortSignal: signal, id: record.id, version: record.version, runtime, monitor: runtime, app: runtime?.app || null, config: runtime?.configuration || null, metrics: runtime?.metrics || null, tracer: runtime?.tracer || null, health: runtime?.healthRegistry || null, resources: runtime?.resources || null, alerts: runtime?.alerts || null, incidents: runtime?.incidents || null, slos: runtime?.slos || null, synthetics: runtime?.synthetics || null, anomalies: runtime?.anomalies || null, hook: (name, handler, options = {}) => { signal.throwIfAborted(); return manager.hook(name, handler, { ...options, plugin: record.id }); }, emit: (name, payload, context) => { signal.throwIfAborted(); return manager.invoke(name, payload, context); }, signal: (kind, payload, options) => { signal.throwIfAborted(); manager._assertOpen(); return runtime?.emitSignal?.(kind, payload, options); }, resolve: (key, fallback = null) => { try { return runtime?.app?.resolve?.(key) ?? fallback; } catch { return fallback; } } }); }
function publicRecord(record) { return { id: record.id, version: record.version, dependencies: record.dependencies, optionalDependencies: record.optionalDependencies, priority: record.priority, required: record.required, state: record.state, error: record.error, registeredAt: record.registeredAt, setupAt: record.setupAt, startedAt: record.startedAt, closedAt: record.closedAt }; }
export default MonitorPluginManager;
