'use strict';

import { ListenerRegistry } from '../core/ListenerRegistry.js';
import { ListenerScope } from '../core/ListenerScope.js';
import { SubscriptionBuilder } from '../core/SubscriptionBuilder.js';
import { normalizeEventName, computeWildcardEvents } from '../support/glob.js';
import { ExplicitEventContextManager } from '../universal/context/ExplicitEventContextManager.js';
import { assertEventName, cloneSafe, deepFreeze, timeout } from '../universal/support/safe.js';

/** Browser-safe dispatcher with the same exact → wildcard → pattern → any plan. */
export class BrowserEventDispatcher {
  constructor(options = {}) {
    this.profile = options.profile || 'compat';
    this.normalizeDot = options.normalizeDot === true;
    this.errorPolicy = options.errorPolicy || 'isolate';
    this.closed = false;
    this.accepting = true;
    this.registry = new ListenerRegistry({
      maxListenersPerEvent: options.maxListenersPerEvent ?? options.listeners?.maxPerEvent ?? 5_000,
      maxListenersTotal: options.maxListenersTotal ?? options.listeners?.maxTotal ?? 0,
      maxPatternListeners: options.maxPatternListeners ?? options.listeners?.maxPatterns ?? 5_000,
      maxListenersPerPattern: options.maxListenersPerPattern ?? options.listeners?.maxPerPattern ?? 5_000,
      maxAnyListeners: options.maxAnyListeners ?? options.listeners?.maxAny ?? 5_000,
      planCacheMax: options.planCacheMax ?? options.listeners?.planCacheMax ?? 1_024,
    });
    this._registry = this.registry;
    this._listeners = this.registry.exact;
    this._patternListeners = this.registry.patterns;
    this._anyListeners = this.registry.any;
    this.contexts = options.contexts || new ExplicitEventContextManager(options.context || {});
    this.historyLimit = Math.max(0, Number(options.historyLimit ?? options.history?.maxEntriesPerEvent) || 0);
    this.history = new Map();
    this.historyEventLimit = Math.max(0, Number(options.historyEventLimit ?? options.history?.maxEventNames) || 1_024);
    this.maxHistoryPayloadBytes = Math.max(0, Number(options.maxHistoryPayloadBytes ?? options.history?.maxPayloadBytes) || 256 * 1024);
    this.pending = new Set();
    this.statsValue = { dispatches: 0, asyncDispatches: 0, listenersInvoked: 0, errors: 0, promisesObserved: 0, historyRecorded: 0 };
  }

  emit(event, ...args) { return this.dispatch(event, ...args); }
  addListener(event, listener, options) { return this.on(event, listener, options); }
  removeListener(event, listener) { return this.off(event, listener); }
  eventNames() { return [...this.registry.exact.keys()]; }
  listeners(event) { return (this.registry.exact.get(this._name(event)) || []).filter((entry) => entry.active).map((entry) => entry.fn); }
  listenerCount(event = null) { if (event == null) return this.registry.total; const name = this._name(event); return name === '*' ? this.registry.any.length : (this.registry.exact.get(name) || []).filter((entry) => entry.active).length; }
  removeAllListeners(event = null) { this.registry.clear(event == null ? null : this._name(event)); return this; }

  createContext(meta = {}) { return this.contexts.create(meta); }
  getContext() { return this.contexts.get(); }
  getContextId() { return this.contexts.id(); }
  run(context, operation) { return this.contexts.run(context, operation); }
  runIfMissing(meta, operation) { return this.contexts.runIfMissing(meta, operation); }
  enter(context) { return this.contexts.enter(context); }
  bind(operation) { return this.contexts.bind(operation); }
  childContext(meta = {}) { return this.contexts.child(meta); }

  subscribe(event, listener, options = {}) { this._assertOpen(); const name = this._name(event); const { handle } = this.registry.addExact(name, listener, options); this._bindSignal(handle, options.signal); if (options.replay) this.replay(name, listener, typeof options.replay === 'object' ? options.replay : {}); return handle; }
  on(event, listener, options = {}) { this.subscribe(event, listener, options); return this; }
  once(event, listener, options = {}) { this.subscribe(event, listener, { ...options, once: true }); return this; }
  subscribePattern(pattern, listener, options = {}) { this._assertOpen(); const { handle } = this.registry.addPattern(this._name(pattern), listener, options); this._bindSignal(handle, options.signal); return handle; }
  onPattern(pattern, listener, options = {}) { this.subscribePattern(pattern, listener, options); return this; }
  subscribeAny(listener, options = {}) { this._assertOpen(); const { handle } = this.registry.addAny(listener, options); this._bindSignal(handle, options.signal); return handle; }
  onAny(listener, options = {}) { this.subscribeAny(listener, options); return this; }
  off(event, listener) { return this.registry.removeExact(this._name(event), listener); }
  offPattern(pattern, listener) { return this.registry.removePattern(this._name(pattern), listener); }
  offAny(listener) { return this.registry.removeAny(listener); }
  subscribeTo(event) { return new SubscriptionBuilder(this, 'exact', this._name(event)); }
  subscribeToPattern(pattern) { return new SubscriptionBuilder(this, 'pattern', this._name(pattern)); }
  subscribeToAny() { return new SubscriptionBuilder(this, 'any', '*'); }
  scope(owner) { return new ListenerScope(this, owner); }
  removeOwner(owner) { return this.registry.removeOwner(owner); }
  removeTag(tag) { return this.registry.removeTag(tag); }
  listenerManifest() { return this.registry.manifest(); }
  hasListeners(event) { const name = this._name(event); return this.registry.hasPotential(name, computeWildcardEvents(name)); }
  willDispatchTo(event) { const name = this._name(event); return this.registry.willDispatchTo(name, computeWildcardEvents(name)); }
  inspect(event) { const name = this._name(event); const plan = this.registry.plan(name, computeWildcardEvents(name)); return deepFreeze({ eventName: name, exactStages: plan.exactStages.map((stage) => ({ eventName: stage.eventName, listeners: stage.entries.map((entry) => this.registry.describeEntry(entry)) })), patterns: plan.patterns.map((entry) => this.registry.describeEntry(entry)), any: plan.any.map((entry) => this.registry.describeEntry(entry)) }); }

  dispatch(event, ...args) {
    this._assertDispatch();
    const name = this._name(event);
    const plan = this.registry.plan(name, computeWildcardEvents(name));
    this._record(name, args);
    this.statsValue.dispatches++;
    for (const stage of plan.exactStages) for (const entry of stage.entries) this._invokeSync(entry, args, name, false);
    for (const entry of plan.patterns) this._invokeSync(entry, [name, ...args], name, true);
    for (const entry of plan.any) this._invokeSync(entry, [name, ...args], name, true);
    return undefined;
  }

  async dispatchAsync(event, ...args) {
    this._assertDispatch();
    const name = this._name(event);
    const plan = this.registry.plan(name, computeWildcardEvents(name));
    this._record(name, args);
    this.statsValue.asyncDispatches++;
    for (const stage of plan.exactStages) for (const entry of stage.entries) await this._invokeAsync(entry, args, name, false);
    for (const entry of plan.patterns) await this._invokeAsync(entry, [name, ...args], name, true);
    for (const entry of plan.any) await this._invokeAsync(entry, [name, ...args], name, true);
    return undefined;
  }

  async dispatchParallel(event, ...args) {
    this._assertDispatch();
    const name = this._name(event); const plan = this.registry.plan(name, computeWildcardEvents(name)); this._record(name, args);
    const tasks = [];
    for (const stage of plan.exactStages) for (const entry of stage.entries) tasks.push(this._invokeAsync(entry, args, name, false));
    for (const entry of plan.patterns) tasks.push(this._invokeAsync(entry, [name, ...args], name, true));
    for (const entry of plan.any) tasks.push(this._invokeAsync(entry, [name, ...args], name, true));
    return Promise.allSettled(tasks);
  }

  dispatchDeferred(event, ...args) { const context = this.getContext(); queueMicrotask(() => { try { this.run(context, () => this.dispatch(event, ...args)); } catch (error) { this._handleError(error, event, null); } }); return true; }

  waitFor(event, options = {}) {
    const name = this._name(event); const timeoutMs = Math.max(0, Number(options.timeoutMs ?? options.timeout) || 0);
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); handle?.dispose?.(); options.signal?.removeEventListener?.('abort', aborted); };
      const aborted = () => { cleanup(); reject(options.signal.reason || Object.assign(new Error('Event wait aborted.'), { code: 'EVENT_ABORTED' })); };
      const handle = this.subscribe(name, (...args) => { cleanup(); try { resolve(options.map ? options.map(...args) : args.length <= 1 ? args[0] : args); } catch (error) { reject(error); } }, { once: true });
      if (timeoutMs) timer = setTimeout(() => { cleanup(); reject(Object.assign(new Error(`Timed out waiting for '${name}'.`), { code: 'EVENT_WAIT_TIMEOUT', timeoutMs })); }, timeoutMs);
      if (options.signal) { if (options.signal.aborted) aborted(); else options.signal.addEventListener('abort', aborted, { once: true }); }
    });
  }

  iterate(event, options = {}) {
    const queue = []; const waiters = []; const maxItems = Math.max(1, Number(options.maxItems) || 1_000); let closed = false;
    const handle = this.subscribe(event, (...args) => { const value = args.length <= 1 ? args[0] : args; const waiter = waiters.shift(); if (waiter) waiter.resolve({ value, done: false }); else { if (queue.length >= maxItems) queue.shift(); queue.push(value); } });
    const close = () => { if (closed) return; closed = true; handle.dispose(); for (const waiter of waiters.splice(0)) waiter.resolve({ value: undefined, done: true }); };
    options.signal?.addEventListener?.('abort', close, { once: true });
    return { [Symbol.asyncIterator]() { return this; }, next() { if (queue.length) return Promise.resolve({ value: queue.shift(), done: false }); if (closed) return Promise.resolve({ value: undefined, done: true }); return new Promise((resolve, reject) => waiters.push({ resolve, reject })); }, return() { close(); return Promise.resolve({ value: undefined, done: true }); }, close };
  }

  getHistory(event, options = {}) { const values = (this.history.get(this._name(event)) || []).slice(); return options.limit ? values.slice(-Math.max(1, Number(options.limit))) : values; }
  getHistoryAll() { return Object.fromEntries([...this.history].map(([name, values]) => [name, values.slice()])); }
  clearHistory(event = null) { if (event == null) { const count = this.history.size; this.history.clear(); return count; } return this.history.delete(this._name(event)); }
  replay(event, listener, options = {}) { const entries = this.getHistory(event, options); for (const record of entries) { try { const value = listener(...record.args); if (value?.then) this._observe(value, event, null); } catch (error) { this._handleError(error, event, null); } } return entries.length; }
  freezeRegistrations() { this.registry.freeze(); return this; }
  unfreezeRegistrations() { this.registry.unfreeze(); return this; }
  registrationsFrozen() { return this.registry.registrationFrozen; }
  health() { return deepFreeze({ ok: !this.closed, ready: this.accepting && !this.closed, state: this.closed ? 'closed' : this.accepting ? 'ready' : 'draining', listeners: this.registry.total, pending: this.pending.size, stats: { ...this.statsValue } }); }
  metrics() { return deepFreeze({ ...this.statsValue }); }
  stats() { return this.health(); }
  snapshot() { return deepFreeze({ ...this.health(), context: this.contexts.snapshot(), history: { events: this.history.size, limit: this.historyLimit }, registrationsFrozen: this.registrationsFrozen() }); }
  async flush() { await Promise.allSettled([...this.pending]); return this.snapshot(); }
  async drain() { this.accepting = false; return this.flush(); }
  async close() { if (this.closed) return this.snapshot(); this.accepting = false; await this.flush(); this.registry.clear(); this.history.clear(); this.closed = true; return this.snapshot(); }
  async [Symbol.asyncDispose]() { await this.close(); }

  _name(event) { return assertEventName(normalizeEventName(String(event), this.normalizeDot)); }
  _assertOpen() { if (this.closed || !this.accepting) throw Object.assign(new Error('Browser event dispatcher is closed.'), { code: 'EVENT_CLOSED' }); }
  _assertDispatch() { if (this.closed) throw Object.assign(new Error('Browser event dispatcher is closed.'), { code: 'EVENT_CLOSED' }); }
  _bindSignal(handle, signal) { if (!signal) return; if (signal.aborted) handle.dispose(); else signal.addEventListener('abort', () => handle.dispose(), { once: true }); }
  _claim(entry) { return entry.once ? this.registry.claimOnce(entry) : entry.active; }
  _invokeSync(entry, args, eventName) { if (!entry.active || entry.paused || !this._claim(entry)) return; this.statsValue.listenersInvoked++; try { const value = entry.fn(...args); if (value?.then) this._observe(value, eventName, entry); } catch (error) { this._handleError(error, eventName, entry); if ((entry.errorPolicy || this.errorPolicy) === 'fail-fast') throw error; } }
  async _invokeAsync(entry, args, eventName) { if (!entry.active || entry.paused || !this._claim(entry)) return; this.statsValue.listenersInvoked++; try { return await timeout(Promise.resolve(entry.fn(...args)), entry.timeoutMs, { code: 'EVENT_LISTENER_TIMEOUT' }); } catch (error) { this._handleError(error, eventName, entry); if ((entry.errorPolicy || this.errorPolicy) === 'fail-fast') throw error; return undefined; } }
  _observe(promise, eventName, entry) { this.statsValue.promisesObserved++; let tracked; tracked = Promise.resolve(promise).catch((error) => this._handleError(error, eventName, entry)).finally(() => this.pending.delete(tracked)); this.pending.add(tracked); }
  _handleError(error, eventName, entry) { this.statsValue.errors++; if (eventName !== 'listener:error' && this.hasListeners('listener:error')) { try { this.dispatch('listener:error', error, { eventName, listener: entry ? this.registry.describeEntry(entry) : null }); return; } catch {} } globalThis.console?.error?.(`[RawNode Events] listener error on '${eventName}'`, error); }
  _record(eventName, args) { if (!this.historyLimit) return; if (!this.history.has(eventName) && this.history.size >= this.historyEventLimit) this.history.delete(this.history.keys().next().value); const list = this.history.get(eventName) || []; const payload = cloneSafe(args, { maxDepth: 12, maxKeys: 2_000, maxStringBytes: this.maxHistoryPayloadBytes || 64 * 1024 }); list.push(deepFreeze({ eventName, at: Date.now(), args: payload, context: cloneSafe(this.getContext(), { maxDepth: 8, maxKeys: 256 }) })); while (list.length > this.historyLimit) list.shift(); this.history.set(eventName, list); this.statsValue.historyRecorded++; }
}

export default BrowserEventDispatcher;
