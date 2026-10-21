'use strict';

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { AdvancedEventDispatcher } from '../AdvancedEventDispatcher.js';
import { RedisEventBridge } from '../RedisEventBridge.js';
import { BroadcastManager } from '../broadcasting/BroadcastManager.js';
import { EventSchemaRegistry } from '../contracts/EventSchemaRegistry.js';
import { EventCodecRegistry } from '../serialization/EventCodecRegistry.js';
import { EventOutbox } from '../durable/EventOutbox.js';
import { MemoryOutboxStore } from '../durable/MemoryOutboxStore.js';
import { OutboxPublisher } from '../durable/OutboxPublisher.js';
import { EventJobQueue } from '../queue/EventJobQueue.js';
import { EventScheduler } from '../queue/EventScheduler.js';
import { WorkflowEngine } from '../workflows/WorkflowEngine.js';
import { MemoryWorkflowStore } from '../workflows/MemoryWorkflowStore.js';
import { MemoryEventStore } from '../sourcing/MemoryEventStore.js';
import { ProjectionManager, MemoryProjectionCheckpointStore } from '../sourcing/ProjectionManager.js';
import { EVENT_COMMANDS } from '../console/EventCommands.js';

function isPlain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safeResolve(app, key, fallback = null) { try { return app?.resolve?.(key) ?? fallback; } catch { return fallback; } }
function hasBinding(app, key) {
  try { return !!(app?.container?.has?.(key) || app?.has?.(key) || app?.bound?.(key)); } catch { return false; }
}
function bind(app, kind, key, factory) {
  if (typeof app?.[kind] === 'function') return app[kind](key, factory);
  if (typeof app?.container?.[kind] === 'function') return app.container[kind](key, factory);
  if (typeof app?.bind === 'function') return app.bind(key, factory);
  throw new Error(`Application container cannot bind [${key}]`);
}
function tag(app, key, name) {
  try { app?.tag?.(key, name); return; } catch {}
  try { app?.container?.tag?.(key, name); } catch {}
}
function cfg(config, key, fallback = undefined) {
  try {
    if (typeof config?.get === 'function') {
      const value = config.get(key);
      return value === undefined ? fallback : value;
    }
  } catch {}
  const parts = String(key).split('.');
  let current = config;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) return fallback;
    current = current[part];
  }
  return current;
}
function merge(...sources) {
  const output = {};
  for (const source of sources) {
    if (!isPlain(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (isPlain(value) && isPlain(output[key])) output[key] = merge(output[key], value);
      else if (isPlain(value)) output[key] = merge(value);
      else if (Array.isArray(value)) output[key] = value.slice();
      else if (value !== undefined) output[key] = value;
    }
  }
  return output;
}

export class EventServiceProvider {
  static priority = 2;
  static dependencies = ['app'];

  constructor(app) {
    this.app = app;
    this.scope = null;
    this.listenerInstances = new Map();
    this.lifecycleCleanups = [];
    this.registrationReport = null;
    this.bridge = null;
    this.broadcastManager = null;
    this.outboxPublisher = null;
    this.queue = null;
    this.scheduler = null;
    this.workflows = null;
    this.eventStore = null;
    this.projections = null;
  }

  register() {
    const app = this.app;
    bind(app, 'singleton', 'events.schemas', () => new EventSchemaRegistry(this._config().contracts || {}));
    bind(app, 'singleton', 'events.codecs', () => new EventCodecRegistry(this._config().codecs || {}));
    bind(app, 'singleton', 'events', () => {
      const configuration = this._config();
      const events = new AdvancedEventDispatcher({
        ...configuration.bus,
        profile: configuration.bus?.profile || configuration.profile || 'compat',
        logger: safeResolve(app, 'logger', console),
        schemaRegistry: safeResolve(app, 'events.schemas'),
        codecRegistry: safeResolve(app, 'events.codecs'),
      });
      if (configuration.global !== false) globalThis.events = events;
      return events;
    });
    bind(app, 'singleton', 'events.bridge.redis', () => new RedisEventBridge(app));
    bind(app, 'singleton', 'events.broadcast', () => new BroadcastManager(safeResolve(app, 'events'), this._config().broadcasting || {}));
    bind(app, 'singleton', 'events.outbox.store', () => new MemoryOutboxStore(this._config().durable?.memory || this._config().durable || {}));
    bind(app, 'singleton', 'events.outbox', () => new EventOutbox({
      ...(this._config().durable || {}),
      store: safeResolve(app, 'events.outbox.store'),
      dispatcher: safeResolve(app, 'events'),
      schemaRegistry: safeResolve(app, 'events.schemas'),
    }));
    bind(app, 'singleton', 'events.outbox.publisher', () => {
      const transport = safeResolve(app, 'events.durable.transport');
      return transport ? new OutboxPublisher(safeResolve(app, 'events.outbox.store'), transport, this._config().durable?.publisher || {}) : null;
    });
    bind(app, 'singleton', 'events.queue', () => {
      const queue = new EventJobQueue(this._config().queue || {});
      queue.register('dispatch', async (payload, context) => {
        const events = safeResolve(app, 'events');
        if (!events) throw new Error('Events dispatcher is unavailable');
        return events.run(payload?.context || context?.context || null, () => events.dispatchAsync(payload.eventName, ...(payload.args || [])));
      });
      this.queue = queue;
      return queue;
    });
    bind(app, 'singleton', 'events.scheduler', () => {
      const configuration = this._config().scheduler || {};
      const scheduler = new EventScheduler({
        ...configuration,
        dispatcher: safeResolve(app, 'events'),
        queue: configuration.queue === true ? safeResolve(app, 'events.queue') : null,
      });
      this.scheduler = scheduler;
      return scheduler;
    });
    bind(app, 'singleton', 'events.workflows.store', () => new MemoryWorkflowStore(this._config().workflows?.memory || {}));
    bind(app, 'singleton', 'events.workflows', () => {
      const workflows = new WorkflowEngine({
        ...(this._config().workflows || {}),
        dispatcher: safeResolve(app, 'events'),
        store: safeResolve(app, 'events.workflows.store'),
      });
      this.workflows = workflows;
      return workflows;
    });
    bind(app, 'singleton', 'events.store', () => {
      const eventStore = new MemoryEventStore(this._config().sourcing?.memory || this._config().sourcing || {});
      this.eventStore = eventStore;
      return eventStore;
    });
    bind(app, 'singleton', 'events.projections.checkpoints', () => new MemoryProjectionCheckpointStore());
    bind(app, 'singleton', 'events.projections', () => {
      const projections = new ProjectionManager(safeResolve(app, 'events.store'), {
        ...(this._config().sourcing?.projections || {}),
        checkpoints: safeResolve(app, 'events.projections.checkpoints'),
      });
      this.projections = projections;
      return projections;
    });

    for (const [key, Command] of EVENT_COMMANDS) {
      bind(app, 'singleton', key, () => new Command(app));
      tag(app, key, 'console.command');
    }
  }

  async boot() {
    const configuration = this._config();
    const events = safeResolve(this.app, 'events');
    if (!events) throw new Error('EventServiceProvider could not resolve events');
    this.scope = events.scope('provider:events');

    try {
      this.registrationReport = await this._registerConfiguration(events, configuration);
      this._forwardContainerLifecycle(events, configuration.lifecycle || {});

      this.broadcastManager = safeResolve(this.app, 'events.broadcast');
      if (configuration.broadcasting?.enabled) {
        events.setBroadcastManager(this.broadcastManager, { auto: configuration.broadcasting.auto === true });
        if (configuration.broadcasting.listen === true) this.broadcastManager.start(events);
      }

      this.bridge = safeResolve(this.app, 'events.bridge.redis');
      const bridgeEnabled = configuration.bridge?.redis?.enabled === true || process.env.EVENTS_REDIS === 'true';
      if (bridgeEnabled && process.env.APP_ENV !== 'test') {
        try { await this.bridge.start(configuration.bridge.redis); }
        catch (error) {
          if (configuration.bridge.redis.required === true || configuration.failFast === true) throw error;
          safeResolve(this.app, 'logger', console)?.error?.('[EventServiceProvider] Redis bridge start failed', error);
        }
      }

      if (configuration.durable?.enabled) {
        const outbox = safeResolve(this.app, 'events.outbox');
        events.setOutbox(outbox);
        this.outboxPublisher = safeResolve(this.app, 'events.outbox.publisher');
        if (this.outboxPublisher && configuration.durable.autoStart !== false) this.outboxPublisher.start();
      }

      this._attachEnterpriseSubsystems(events, configuration);

      const environment = process.env.APP_ENV || process.env.NODE_ENV || 'development';
      if (configuration.freezeListeners === true || (environment === 'production' && configuration.dynamicRegistration === false)) {
        events.freezeRegistrations({ contracts: true, codecs: true });
      }

      events.dispatch('events:ready', {
        listeners: this.registrationReport,
        bridge: this.bridge?.snapshot?.() || null,
        profile: events.configuration?.value?.profile,
      });
      return this.registrationReport;
    } catch (error) {
      this.scope?.dispose?.();
      this.scope = null;
      throw error;
    }
  }

  async teardown() {
    for (const cleanup of this.lifecycleCleanups.splice(0)) { try { cleanup(); } catch {} }
    this.scope?.dispose?.();
    this.scope = null;
    try { await this.outboxPublisher?.close?.(); } catch {}
    try { await this.bridge?.close?.(); } catch {}
    try { await this.broadcastManager?.close?.(); } catch {}
    const events = safeResolve(this.app, 'events');
    try { await events?.close?.({ closeBridge: false, closeBroadcasting: false }); } catch {}
    if (globalThis.events === events) delete globalThis.events;
    this.listenerInstances.clear();
    this.queue = null;
    this.scheduler = null;
    this.workflows = null;
    this.eventStore = null;
    this.projections = null;
  }

  _config() {
    const config = safeResolve(this.app, 'config', {});
    const root = cfg(config, 'events', {}) || {};
    const appEvents = cfg(config, 'app.events', {}) || {};
    const bus = merge(appEvents.bus || appEvents, root.bus || {});
    return merge(appEvents, root, { bus });
  }

  async _registerConfiguration(events, configuration) {
    const listeners = configuration.listeners || this._legacyListenerMap(configuration);
    const subscribers = Array.isArray(configuration.subscribers) ? configuration.subscribers : [];
    const report = { loaded: [], skipped: [], failed: [], subscribers: [] };

    for (const [eventName, definitions] of Object.entries(listeners || {})) {
      for (const definition of Array.isArray(definitions) ? definitions : [definitions]) {
        try {
          const resolved = await this._coerceListener(definition);
          if (!resolved.handler) { report.skipped.push({ eventName, definition, reason: 'unresolvable' }); continue; }
          const kind = this._listenerKind(eventName, resolved.options);
          const options = { owner: 'events:config', ...resolved.options };
          const handle = kind === 'any'
            ? this.scope.any(resolved.handler, options)
            : kind === 'pattern'
              ? this.scope.pattern(eventName, resolved.handler, options)
              : this.scope.subscribe(eventName, resolved.handler, options);
          report.loaded.push({ eventName, kind, listenerId: handle?.id, owner: options.owner, priority: options.priority || 0 });
        } catch (error) {
          report.failed.push({ eventName, definition: this._safeDefinition(definition), error: { name: error.name, message: error.message, code: error.code } });
          if (configuration.failFast === true) throw error;
        }
      }
    }

    for (const definition of subscribers) {
      try {
        const Subscriber = await this._resolveTarget(definition);
        const map = Subscriber?.getSubscribedEvents?.();
        if (!map) { report.skipped.push({ subscriber: this._safeDefinition(definition), reason: 'missing-getSubscribedEvents' }); continue; }
        const instance = this._instance(Subscriber);
        for (const [eventName, eventDefinition] of Object.entries(map)) {
          const normalized = typeof eventDefinition === 'string'
            ? { method: eventDefinition }
            : Array.isArray(eventDefinition)
              ? { method: eventDefinition[0], priority: eventDefinition[1] }
              : eventDefinition;
          const method = normalized?.method || normalized?.handle || 'handle';
          if (typeof instance?.[method] !== 'function') throw new Error(`Subscriber method missing: ${Subscriber.name}.${method}`);
          const handler = (...args) => instance[method](...args);
          const kind = this._listenerKind(eventName, normalized || {});
          const options = { ...normalized, owner: normalized?.owner || `subscriber:${Subscriber.name}` };
          const handle = kind === 'any' ? this.scope.any(handler, options) : kind === 'pattern' ? this.scope.pattern(eventName, handler, options) : this.scope.subscribe(eventName, handler, options);
          report.subscribers.push({ subscriber: Subscriber.name, eventName, method, listenerId: handle?.id });
        }
      } catch (error) {
        report.failed.push({ subscriber: this._safeDefinition(definition), error: { name: error.name, message: error.message, code: error.code } });
        if (configuration.failFast === true) throw error;
      }
    }
    return report;
  }

  _legacyListenerMap(configuration) {
    const reserved = new Set(['bus', 'bridge', 'broadcasting', 'durable', 'contracts', 'codecs', 'subscribers', 'profile', 'global', 'failFast']);
    const entries = Object.entries(configuration || {}).filter(([key, value]) => !reserved.has(key) && (Array.isArray(value) || typeof value === 'function' || typeof value === 'string'));
    return Object.fromEntries(entries);
  }

  _listenerKind(eventName, options = {}) {
    if (options.any === true || eventName === '*') return 'any';
    if (options.pattern === true) return 'pattern';
    const stars = (String(eventName).match(/\*/g) || []).length;
    if (String(eventName).includes('**') || String(eventName).includes('?')) return 'pattern';
    if (stars && !(stars === 1 && String(eventName).endsWith(':*'))) return 'pattern';
    return 'exact';
  }

  async _coerceListener(definition) {
    let target = definition;
    let method = null;
    const options = {};
    if (isPlain(definition) && (definition.listener || definition.use || definition.handler)) {
      target = definition.listener || definition.use || definition.handler;
      method = definition.method || null;
      for (const key of ['priority', 'prepend', 'once', 'replay', 'replayConsumesOnce', 'owner', 'tags', 'tag', 'timeoutMs', 'errorPolicy', 'meta', 'pattern', 'any', 'paused']) {
        if (definition[key] !== undefined) options[key] = definition[key];
      }
    }
    target = await this._resolveTarget(target, (parsed) => { method ||= parsed.method; });
    if (typeof target === 'function') {
      const selected = method || 'handle';
      if (target.prototype && typeof target.prototype[selected] === 'function') {
        const instance = this._instance(target);
        return { handler: (...args) => instance[selected](...args), options };
      }
      return { handler: target, options };
    }
    if (target && typeof target === 'object') {
      const selected = method || 'handle';
      if (typeof target[selected] === 'function') return { handler: (...args) => target[selected](...args), options };
    }
    return { handler: null, options };
  }

  async _resolveTarget(target, onParsed = null) {
    if (typeof target !== 'string') return target;
    const parsed = this._parseReference(target);
    onParsed?.(parsed);
    const module = await this._import(parsed.spec);
    return parsed.exportName ? module[parsed.exportName] : module.default || (Object.keys(module).length === 1 ? module[Object.keys(module)[0]] : null);
  }

  _parseReference(input) {
    let spec = String(input).trim();
    let method = null;
    let exportName = null;
    const at = spec.lastIndexOf('@');
    if (at > spec.lastIndexOf('/')) { method = spec.slice(at + 1); spec = spec.slice(0, at); }
    else {
      const dot = spec.lastIndexOf('.');
      if (dot > spec.lastIndexOf('/') && !/\.(?:js|mjs|cjs)$/.test(spec)) { method = spec.slice(dot + 1); spec = spec.slice(0, dot); }
    }
    const hash = spec.indexOf('#', 1);
    if (hash > 0) { exportName = spec.slice(hash + 1); spec = spec.slice(0, hash); }
    if (spec.startsWith('@listeners/')) spec = `#app/Listeners/${spec.slice('@listeners/'.length)}.js`;
    return { spec, method, exportName };
  }

  async _import(spec) {
    if (spec.startsWith('#') || (!spec.startsWith('.') && !path.isAbsolute(spec))) return import(spec);
    const base = typeof this.app?.basePath === 'function' ? this.app.basePath() : process.cwd();
    const absolute = path.isAbsolute(spec) ? spec : path.resolve(base, spec);
    return import(pathToFileURL(absolute).href);
  }

  _instance(Class) {
    if (this.listenerInstances.has(Class)) return this.listenerInstances.get(Class);
    let instance;
    try { instance = this.app?.make?.(Class); } catch {}
    if (!instance) {
      const dependencies = Array.isArray(Class.dependencies) ? Class.dependencies.map((key) => safeResolve(this.app, key)) : [];
      instance = new Class(...dependencies);
    }
    this.listenerInstances.set(Class, instance);
    return instance;
  }

  _forwardContainerLifecycle(events, options) {
    if (options.enabled === false) return;
    const container = this.app?.container || this.app;
    const attach = (name, handler) => {
      if (typeof container?.on !== 'function') return;
      container.on(name, handler);
      this.lifecycleCleanups.push(() => container.off?.(name, handler));
    };
    attach('bound', (serviceName, scope) => events.dispatch('container:bound', { serviceName, scope }));
    attach('resolving', (serviceName) => events.dispatch('container:resolving', { serviceName }));
    attach('resolved', (serviceName) => events.dispatch('container:resolved', { serviceName }));
    attach('failed', (serviceName, error) => events.dispatch('container:failed', { serviceName, error }));
    for (const [method, eventName] of [['onAllResolving', 'container:resolving'], ['onAllResolved', 'container:resolved'], ['onAllFailed', 'container:failed']]) {
      if (typeof container?.[method] !== 'function') continue;
      const listener = (...args) => events.dispatch(eventName, method === 'onAllFailed' ? { serviceName: args[0], error: args[1] } : { serviceName: args[0] });
      const off = container[method](listener);
      if (typeof off === 'function') this.lifecycleCleanups.push(off);
    }
  }

  _attachEnterpriseSubsystems(events, configuration) {
    const attach = (name, key, options = {}) => {
      if (options.enabled === false) return null;
      const subsystem = safeResolve(this.app, key);
      if (!subsystem) return null;
      events.registerSubsystem(name, subsystem, {
        required: options.required === true,
        closeOnShutdown: options.closeOnShutdown !== false,
        meta: { binding: key, ...(options.meta || {}) },
      });
      return subsystem;
    };

    if (configuration.queue?.enabled === true) this.queue = attach('queue', 'events.queue', configuration.queue);
    if (configuration.scheduler?.enabled === true) this.scheduler = attach('scheduler', 'events.scheduler', configuration.scheduler);
    if (configuration.workflows?.enabled === true) this.workflows = attach('workflows', 'events.workflows', configuration.workflows);
    if (configuration.sourcing?.enabled === true) {
      this.eventStore = attach('event-store', 'events.store', configuration.sourcing);
      this.projections = attach('projections', 'events.projections', configuration.sourcing.projections || {});
    }
    if (this.outboxPublisher) events.registerSubsystem('outbox-publisher', this.outboxPublisher, { closeOnShutdown: false, meta: { binding: 'events.outbox.publisher' } });
  }

  _safeDefinition(definition) {
    if (typeof definition === 'function') return definition.name || '[Function]';
    if (typeof definition === 'string') return definition;
    try { return JSON.parse(JSON.stringify(definition)); } catch { return String(definition); }
  }
}

export default EventServiceProvider;
