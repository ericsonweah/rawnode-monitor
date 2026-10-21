'use strict';

// src/events/AdvancedEventDispatcher.js
// Compatibility-preserving enterprise event dispatcher for RawNode.

import { performance } from 'node:perf_hooks';

import { EventConfiguration } from './config/EventConfiguration.js';
import { ListenerRegistry } from './core/ListenerRegistry.js';
import { SubscriptionBuilder } from './core/SubscriptionBuilder.js';
import { ListenerScope } from './core/ListenerScope.js';
import { DispatchReport } from './core/DispatchReport.js';
import { AsyncEventIterator } from './core/AsyncEventIterator.js';
import { EventContextManager } from './context/EventContextManager.js';
import { shallowEventContext } from './context/EventContext.js';
import { EventJournal } from './history/EventJournal.js';
import { DeferredEventScheduler } from './scheduling/DeferredEventScheduler.js';
import { EventMetricsStore } from './observability/EventMetricsStore.js';
import { EventHealth } from './observability/EventHealth.js';
import { EventDiagnostics } from './observability/EventDiagnostics.js';
import { EventSecurityPolicy } from './security/EventSecurityPolicy.js';
import { EventSchemaRegistry } from './contracts/EventSchemaRegistry.js';
import { EventCodecRegistry } from './serialization/EventCodecRegistry.js';
import { EventOutbox } from './durable/EventOutbox.js';
import { BroadcastManager } from './broadcasting/BroadcastManager.js';
import { normalizeEventName, computeWildcardEvents } from './support/glob.js';
import { isPromiseLike, raceWithSignal, deferred, abortError } from './support/async.js';
import { estimateValueBytes } from './support/size.js';
import { createLogger } from './support/logger.js';
import { EventAdmissionError, EventClosedError } from './errors/EventError.js';

function publicListener(entry) {
  return {
    listenerId: entry.id,
    kind: entry.kind,
    eventName: entry.kind === 'exact' ? entry.key : null,
    pattern: entry.kind === 'pattern' ? entry.pattern : null,
    owner: entry.owner,
    tags: entry.tags,
    priority: entry.priority,
    once: entry.once,
    name: entry.fn.name || '(anonymous)',
  };
}

function normalizeErrorPolicy(value, fallback = 'isolate') {
  return ['isolate', 'collect', 'fail-fast'].includes(value) ? value : fallback;
}

function invokeArguments(kind, eventName, args) {
  return kind === 'exact' ? args : [eventName, ...args];
}

function parseConcurrency(value, fallback = Infinity) {
  if (value === Infinity) return Infinity;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.trunc(parsed)) : fallback;
}

export class AdvancedEventDispatcher {
  /**
   * Existing behavior remains the default through profile="compat".
   * Set profile="production" to activate conservative resource ceilings.
   */
  constructor(options = {}) {
    this.configuration = new EventConfiguration(options);
    const config = this.configuration.value;

    this._normalizeDot = config.normalizeDot;
    this._logger = createLogger(config.logger);
    this._logEvents = config.logEvents;
    this._logPayloads = options.logPayloads !== false && config.profile === 'compat';
    this._accepting = true;
    this._closed = false;

    this._registry = new ListenerRegistry({
      maxListenersPerEvent: config.listeners.maxPerEvent,
      maxListenersTotal: config.listeners.maxTotal,
      maxPatternListeners: config.listeners.maxPatterns,
      maxListenersPerPattern: config.listeners.maxPerPattern,
      maxAnyListeners: config.listeners.maxAny,
      planCacheMax: config.listeners.planCacheMax,
    });

    // Compatibility-visible storage used by current RawNode console commands.
    this._listeners = this._registry.exact;
    this._patternListeners = this._registry.patterns;
    this._anyListeners = this._registry.any;
    this._maxListenersPerEvent = config.listeners.maxPerEvent;
    Object.defineProperty(this, '_totalListeners', { enumerable: false, configurable: false, get: () => this._registry.total });
    Object.defineProperty(this, '_listenerSeq', { enumerable: false, configurable: false, get: () => this._registry.sequence });

    this._journal = new EventJournal({
      ...config.history,
      historyLimit: config.history.maxEntriesPerEvent,
      historyAllow: config.history.allow,
      historyDeny: config.history.deny,
      redact: options.historyRedact !== false,
      redactKeys: options.historyRedactKeys,
    });
    this._historyLimit = config.history.maxEntriesPerEvent;
    this._historyAllow = config.history.allow || null;
    this._historyDeny = config.history.deny || null;
    this._history = this._journal.compatibilityView;

    this._metricsStore = new EventMetricsStore(config.metrics);
    this._metricsEnabled = this._metricsStore.enabled;
    this._slowMs = Number(config.metrics.slowMs) || 0;
    this._metrics = this._metricsStore.series;

    this.diagnostics = options.diagnosticsInstance instanceof EventDiagnostics
      ? options.diagnosticsInstance
      : new EventDiagnostics({ ...config.diagnostics, ...(options.diagnostics || {}) });
    this._diagnosticsEnabled = this.diagnostics.enabled === true;

    this._contextManager = new EventContextManager(config.context);
    this._contextEnabled = this._contextManager.enabled;
    this._als = this._contextManager.storage;
    this._idFactory = this._contextManager.idFactory;

    this._scheduler = new DeferredEventScheduler({
      ...config.deferred,
      onDiagnostic: (name, payload) => this._emitDiagnostic(`deferred:${name}`, payload),
    });
    Object.defineProperty(this, '_deferredQueued', { enumerable: false, configurable: false, get: () => this._scheduler.length });

    this._pendingAsync = new Set();
    this._activeDispatches = new Set();
    this._inFlightAsync = 0;
    this._health = new EventHealth(this, options.health || {});
    this._bridge = null;
    this._broadcastManager = options.broadcastManager || (config.broadcasting.enabled
      ? new BroadcastManager(this, { ...config.broadcasting, adapters: options.broadcastAdapters || config.broadcasting.adapters })
      : null);
    this._autoBroadcast = config.broadcasting.auto === true;

    this._security = new EventSecurityPolicy(config.security);
    this._maxEventNameBytes = this._security.maxEventNameBytes;
    this._maxSegments = this._security.maxSegments;
    this._defaultErrorPolicy = normalizeErrorPolicy(config.dispatch.errorPolicy);
    this._lifecycle = config.lifecycle || { shutdownTimeoutMs: 0, forceOnTimeout: false };
    this._lastShutdown = null;

    this._schemaRegistry = options.schemaRegistry || new EventSchemaRegistry(options.schemas || {});
    this._codecRegistry = options.codecRegistry || new EventCodecRegistry(options.codecs || {});
    this._contractAutoValidate = config.contracts.autoValidate === true;
    this._subsystems = new Map();
    this._outbox = options.outbox
      ? (typeof options.outbox.enqueue === 'function'
          ? options.outbox
          : new EventOutbox({ ...options.outbox, dispatcher: this, schemaRegistry: this._schemaRegistry }))
      : null;

    // Static portion of the allocation-light string dispatch path. Dynamic
    // diagnostics subscribers are still checked on every dispatch.
    this._minimalDispatchStatic = !this._journal.enabled && !this._logEvents && !this._metricsEnabled;
  }

  // ---------------------------------------------------------------------------
  // Compatibility aliases (EventEmitter-ish)
  // ---------------------------------------------------------------------------

  emit(eventOrName, ...args) { return this.dispatch(eventOrName, ...args); }
  addListener(eventName, listener, options) { return this.on(eventName, listener, options); }
  removeListener(eventName, listener) { return this.off(eventName, listener); }

  removeAllListeners(eventName = null) {
    if (eventName == null) {
      this._registry.clear();
      return this;
    }
    const name = normalizeEventName(eventName, this._normalizeDot);
    this._registry.clear(name);
    return this;
  }

  eventNames() { return Array.from(this._listeners.keys()); }

  listeners(eventName) {
    const name = normalizeEventName(eventName, this._normalizeDot);
    return (this._listeners.get(name) || []).filter((entry) => entry.active).map((entry) => entry.fn);
  }

  listenerCount(eventName = null) {
    if (eventName == null) return this._registry.total;
    const name = normalizeEventName(eventName, this._normalizeDot);
    if (name === '*') return this._anyListeners.filter((entry) => entry.active).length;
    return (this._listeners.get(name) || []).filter((entry) => entry.active).length;
  }

  // ---------------------------------------------------------------------------
  // Context API
  // ---------------------------------------------------------------------------

  createContext(meta = {}) { return this._contextManager.create(meta); }
  getContext() { return this._contextManager.get(); }
  getContextId() { return this._contextManager.id(); }
  run(context, fn) { return this._contextManager.run(context, fn); }
  runIfMissing(meta, fn) { return this._contextManager.runIfMissing(meta, fn); }
  enter(context) { this._contextManager.enter(context); }
  bind(fn) { return this._contextManager.bind(fn); }

  childContext(meta = {}) {
    const current = this.getContext();
    return this.createContext({
      ...meta,
      parentId: meta.parentId ?? current?.id ?? null,
      causationId: meta.causationId ?? current?.id ?? null,
      correlationId: meta.correlationId ?? current?.correlationId ?? current?.id ?? null,
    });
  }

  // ---------------------------------------------------------------------------
  // Diagnostics API
  // ---------------------------------------------------------------------------

  onDiagnostic(name, listener) {
    this.diagnostics.on(name, listener);
    this._diagnosticsEnabled = true;
    return this;
  }

  onceDiagnostic(name, listener) {
    this.diagnostics.once(name, listener);
    this._diagnosticsEnabled = true;
    return this;
  }

  offDiagnostic(name, listener) {
    this.diagnostics.off(name, listener);
    this._diagnosticsEnabled = this.diagnostics.enabled === true || this.diagnostics.eventNames().length > 0;
    return this;
  }

  _diagnosticsActive(name = null) {
    if (this._diagnosticsEnabled || this.diagnostics.enabled || this.diagnostics.channel?.hasSubscribers) return true;
    if (!this.diagnostics._eventsCount) return false;
    if (name == null) return true;
    return this.diagnostics.listenerCount(String(name)) > 0 || this.diagnostics.listenerCount('*') > 0;
  }

  // ---------------------------------------------------------------------------
  // Listener API — existing fluent methods plus disposable subscriptions
  // ---------------------------------------------------------------------------

  on(eventName, listener, options = {}) {
    const name = normalizeEventName(eventName, this._normalizeDot);
    if (name === '*' || name == null) this.subscribeAny(listener, options);
    else this.subscribe(name, listener, options);
    return this;
  }

  once(eventName, listener, options = {}) { return this.on(eventName, listener, { ...options, once: true }); }

  off(eventName, listener) {
    const name = normalizeEventName(eventName, this._normalizeDot);
    if (name === '*' || name == null) this._registry.removeAny(listener);
    else this._registry.removeExact(name, listener);
    return this;
  }

  onAny(listener, options = {}) { this.subscribeAny(listener, options); return this; }
  offAny(listener) { this._registry.removeAny(listener); return this; }
  onPattern(pattern, listener, options = {}) { this.subscribePattern(pattern, listener, options); return this; }
  offPattern(pattern, listener) {
    const normalized = normalizeEventName(pattern, this._normalizeDot);
    this._registry.removePattern(normalized, listener);
    return this;
  }

  subscribe(eventName, listener, options = {}) {
    this._assertOpenForRegistration();
    const name = normalizeEventName(eventName, this._normalizeDot);
    this._validateEventName(name);
    const { entry, handle } = this._registry.addExact(name, listener, options);
    this._replayEntry(entry, options);
    return handle;
  }

  subscribePattern(pattern, listener, options = {}) {
    this._assertOpenForRegistration();
    const normalized = normalizeEventName(pattern, this._normalizeDot);
    this._validateEventName(normalized, { pattern: true });
    const { entry, handle } = this._registry.addPattern(normalized, listener, options);
    this._replayEntry(entry, options);
    return handle;
  }

  subscribeAny(listener, options = {}) {
    this._assertOpenForRegistration();
    const { entry, handle } = this._registry.addAny(listener, options);
    this._replayEntry(entry, options);
    return handle;
  }

  when(eventName) { return new SubscriptionBuilder(this, 'exact', normalizeEventName(eventName, this._normalizeDot)); }
  pattern(pattern) { return new SubscriptionBuilder(this, 'pattern', normalizeEventName(pattern, this._normalizeDot)); }
  any() { return new SubscriptionBuilder(this, 'any', '*'); }
  scope(owner) { return new ListenerScope(this, owner); }

  removeOwner(owner) { return this._registry.removeOwner(owner); }
  removeTag(tag) { return this._registry.removeTag(tag); }
  listenerManifest() { return this._registry.manifest(); }

  hasListeners(eventName) {
    const name = normalizeEventName(eventName, this._normalizeDot);
    return this._registry.hasPotential(name, computeWildcardEvents(name));
  }

  willDispatchTo(eventName) {
    const name = normalizeEventName(eventName, this._normalizeDot);
    return this._registry.willDispatchTo(name, computeWildcardEvents(name));
  }

  inspect(eventName) {
    const name = normalizeEventName(eventName, this._normalizeDot);
    const wildcardNames = computeWildcardEvents(name);
    const plan = this._registry.plan(name, wildcardNames);
    return Object.freeze({
      eventName: name,
      wildcardNames: Object.freeze(wildcardNames),
      exact: Object.freeze(plan.exactStages.map((stage) => Object.freeze({
        eventName: stage.eventName,
        listeners: Object.freeze(stage.entries.map(publicListener)),
      }))),
      patterns: Object.freeze(plan.patterns.map(publicListener)),
      any: Object.freeze(plan.any.map(publicListener)),
      total: plan.exactStages.reduce((sum, stage) => sum + stage.entries.length, 0) + plan.patterns.length + plan.any.length,
    });
  }

  // ---------------------------------------------------------------------------
  // Existing dispatch API
  // ---------------------------------------------------------------------------

  dispatch(eventOrName, ...args) {
    const diagnostics = this.diagnostics;
    const diagnosticsActive = this._diagnosticsEnabled
      || diagnostics.enabled === true
      || diagnostics.channel.hasSubscribers === true
      || diagnostics._eventsCount > 0;
    if (typeof eventOrName === 'string' && this._minimalDispatchStatic && !diagnosticsActive) {
      if (this._closed) throw new EventClosedError();
      if (!this._accepting) throw new EventAdmissionError('Event dispatcher is draining', { code: 'EVENT_DISPATCHER_DRAINING' });
      if (this._registry.total === 0 && !this._security.dispatchValidationActive) return undefined;
      this._dispatchStringMinimal(eventOrName, args);
      return undefined;
    }
    this._dispatchSyncDetailed(eventOrName, args, { report: false, errorPolicy: this._defaultErrorPolicy });
    if (this._autoBroadcast) this._observeBroadcast(eventOrName);
    return undefined;
  }

  dispatchAsync(eventOrName, ...args) {
    const diagnostics = this.diagnostics;
    const diagnosticsActive = this._diagnosticsEnabled
      || diagnostics.enabled === true
      || diagnostics.channel.hasSubscribers === true
      || diagnostics._eventsCount > 0;
    if (typeof eventOrName === 'string' && this._minimalDispatchStatic && !diagnosticsActive) {
      if (this._closed) return Promise.reject(new EventClosedError());
      if (!this._accepting) return Promise.reject(new EventAdmissionError('Event dispatcher is draining', { code: 'EVENT_DISPATCHER_DRAINING' }));
      if (this._registry.total === 0 && !this._security.dispatchValidationActive) return Promise.resolve(undefined);
      return this._trackActiveDispatch(this._dispatchStringAsyncMinimal(eventOrName, args));
    }
    return this._trackActiveDispatch(
      this._dispatchAsyncDetailed(eventOrName, args, { mode: 'sequential', report: false, errorPolicy: this._defaultErrorPolicy })
        .then(() => {
          if (this._autoBroadcast) this._observeBroadcast(eventOrName);
          return undefined;
        }),
    );
  }

  dispatchDeferred(eventOrName, ...args) {
    this.dispatchDeferredSafe(eventOrName, ...args);
    return undefined;
  }

  dispatchDeferredSafe(eventOrName, ...args) {
    return this.dispatchDeferredWith({}, eventOrName, ...args);
  }

  dispatchDeferredWith(options, eventOrName, ...args) {
    const context = this.getContext();
    const eventName = this._peekEventName(eventOrName);
    try {
      const admission = this._scheduler.schedule(
        () => context
          ? this.run(context, () => this._dispatchSyncDetailed(eventOrName, args, { report: false, errorPolicy: this._defaultErrorPolicy, allowDuringDrain: true }))
          : this._dispatchSyncDetailed(eventOrName, args, { report: false, errorPolicy: this._defaultErrorPolicy, allowDuringDrain: true }),
        {
          key: options?.key ?? (options?.coalesce ? eventName : null),
          bytes: options?.bytes ?? estimateValueBytes({ eventName, args, context: shallowEventContext(context) }),
          metadata: { eventName, context: shallowEventContext(context) },
        },
      );
      if (admission.accepted) this._metricsStore.increment('deferred_accepted_total');
      else {
        this._metricsStore.increment('deferred_rejected_total');
        this._emitDiagnostic('deferred:rejected', { eventName, admission });
      }
      return admission;
    } catch (error) {
      this._metricsStore.increment('deferred_rejected_total');
      this._emitDiagnostic('deferred:rejected', { eventName, error });
      return { accepted: false, reason: error.code || error.message, error, promise: Promise.reject(error).catch(() => undefined) };
    }
  }

  dispatchDeferredAsync(eventOrName, ...args) {
    const context = this.getContext();
    const admission = this._scheduler.schedule(
      () => context
        ? this.run(context, () => this._dispatchAsyncDetailed(eventOrName, args, { mode: 'sequential', report: false, errorPolicy: this._defaultErrorPolicy, allowDuringDrain: true }))
        : this._dispatchAsyncDetailed(eventOrName, args, { mode: 'sequential', report: false, errorPolicy: this._defaultErrorPolicy, allowDuringDrain: true }),
      {
        awaitTask: true,
        bytes: estimateValueBytes({ eventName: this._peekEventName(eventOrName), args, context: shallowEventContext(context) }),
        metadata: { eventName: this._peekEventName(eventOrName), context: shallowEventContext(context) },
      },
    );
    return admission.promise;
  }

  // ---------------------------------------------------------------------------
  // Additive dispatch modes
  // ---------------------------------------------------------------------------

  dispatchWithReport(eventOrName, ...args) {
    return this._dispatchSyncDetailed(eventOrName, args, { report: true, errorPolicy: 'collect' });
  }

  dispatchSettled(eventOrName, ...args) {
    return this._trackActiveDispatch(
      this._dispatchAsyncDetailed(eventOrName, args, { mode: 'sequential', report: true, errorPolicy: 'collect' }),
    );
  }

  dispatchParallel(eventOrName, ...args) {
    return this.dispatchParallelWith({}, eventOrName, ...args);
  }

  dispatchParallelWith(options, eventOrName, ...args) {
    return this._trackActiveDispatch(
      this._dispatchParallelDetailed(eventOrName, args, {
        ...options,
        mode: 'parallel',
        report: true,
        errorPolicy: normalizeErrorPolicy(options?.errorPolicy, 'collect'),
        concurrency: parseConcurrency(options?.concurrency, Infinity),
      }),
    );
  }

  dispatchDetailed(options, eventOrName, ...args) {
    const mode = options?.mode || 'sequential';
    if (mode === 'sync') return this._dispatchSyncDetailed(eventOrName, args, { ...options, report: true });
    if (mode === 'parallel') return this._trackActiveDispatch(this._dispatchParallelDetailed(eventOrName, args, { ...options, report: true }));
    return this._trackActiveDispatch(this._dispatchAsyncDetailed(eventOrName, args, { ...options, report: true }));
  }

  async dispatchFirst(eventOrName, ...args) {
    const report = await this._trackActiveDispatch(this._dispatchAsyncDetailed(eventOrName, args, {
      mode: 'first',
      report: true,
      errorPolicy: 'collect',
      stopPredicate: (value) => value !== undefined,
    }));
    return report.stopValue;
  }

  dispatchUntil(predicate, eventOrName, ...args) {
    if (typeof predicate !== 'function') throw new TypeError('dispatchUntil expects a predicate function');
    return this._trackActiveDispatch(this._dispatchAsyncDetailed(eventOrName, args, {
      mode: 'until',
      report: true,
      errorPolicy: 'collect',
      stopPredicate: predicate,
    }));
  }

  async dispatchAndBroadcast(eventOrName, ...args) {
    const report = await this.dispatchSettled(eventOrName, ...args);
    const broadcast = eventOrName && typeof eventOrName === 'object'
      ? await this.broadcast(eventOrName)
      : { broadcast: false, reason: 'event-object-required', deliveries: [] };
    return { dispatch: report, broadcast };
  }

  broadcast(event, options = {}) {
    if (!this._broadcastManager) return Promise.resolve({ broadcast: false, reason: 'manager-disabled', deliveries: [] });
    return this._broadcastManager.broadcast(event, this.getContext(), options);
  }

  waitFor(eventName, options = {}) {
    const completion = deferred();
    const normalized = normalizeEventName(eventName, this._normalizeDot);
    let timer = null;
    let abort = null;
    let handle = null;
    let settled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (abort) options.signal?.removeEventListener?.('abort', abort);
      handle?.dispose?.();
    };
    const finish = (method, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      method(value);
    };
    const map = (actualName, listenerArgs) => {
      const payload = options.raw
        ? { eventName: actualName, args: listenerArgs, context: shallowEventContext(this.getContext()), ts: Date.now() }
        : (typeof options.map === 'function'
            ? options.map(actualName, ...listenerArgs)
            : listenerArgs.length <= 1 ? listenerArgs[0] : listenerArgs);
      finish(completion.resolve, payload);
    };

    if (options.pattern === true) {
      handle = this.subscribePattern(normalized, (actualName, ...listenerArgs) => map(actualName, listenerArgs), { once: true, replay: options.replay, replayConsumesOnce: true });
    } else if (options.any === true || normalized === '*') {
      handle = this.subscribeAny((actualName, ...listenerArgs) => map(actualName, listenerArgs), { once: true, replay: options.replay, replayConsumesOnce: true });
    } else {
      handle = this.subscribe(normalized, (...listenerArgs) => map(normalized, listenerArgs), { once: true, replay: options.replay, replayConsumesOnce: true });
    }

    // Replay is synchronous for synchronous listeners. It may settle the wait
    // before subscribe*() returns its handle, so clean up once the handle exists.
    if (settled) {
      handle?.dispose?.();
      return completion.promise;
    }

    const timeoutMs = Math.max(0, Number(options.timeoutMs) || 0);
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        const error = new Error(`Timed out waiting for event "${normalized}" after ${timeoutMs}ms`);
        error.name = 'TimeoutError';
        error.code = 'EVENT_WAIT_TIMEOUT';
        finish(completion.reject, error);
      }, timeoutMs);
    }
    if (options.signal) {
      abort = () => finish(completion.reject, abortError(`Waiting for event "${normalized}" was aborted`));
      if (options.signal.aborted) abort();
      else options.signal.addEventListener('abort', abort, { once: true });
    }
    return completion.promise;
  }

  iterate(eventName, options = {}) {
    const normalized = normalizeEventName(eventName, this._normalizeDot);
    const iterator = new AsyncEventIterator(options);
    const push = (actualName, args) => iterator.push({
      eventName: actualName,
      args,
      context: shallowEventContext(this.getContext()),
      ts: Date.now(),
    });
    const handle = options.pattern === true
      ? this.subscribePattern(normalized, (actualName, ...args) => push(actualName, args), options.listener || {})
      : options.any === true || normalized === '*'
        ? this.subscribeAny((actualName, ...args) => push(actualName, args), options.listener || {})
        : this.subscribe(normalized, (...args) => push(normalized, args), options.listener || {});
    return iterator.attach(handle);
  }

  // ---------------------------------------------------------------------------
  // History API
  // ---------------------------------------------------------------------------

  getHistory(eventName, options = {}) {
    const name = normalizeEventName(eventName, this._normalizeDot);
    return this._journal.get(name, options);
  }

  getHistoryAll(options = {}) { return this._journal.all(options); }
  clearHistory(eventName = null) { return this._journal.clear(eventName); }

  replay(eventName, listener, options = {}) {
    if (typeof listener !== 'function') throw new TypeError('replay expects a listener function');
    const normalized = normalizeEventName(eventName, this._normalizeDot);
    const entries = options.pattern
      ? this._journal.all(options).filter((entry) => options.pattern.test ? options.pattern.test(entry.eventName) : true)
      : this._journal.get(normalized, options).map((entry) => ({ eventName: normalized, ...entry }));
    const errors = [];
    for (const entry of entries) {
      try {
        const value = options.includeEventName ? listener(entry.eventName, ...entry.args) : listener(...entry.args);
        if (isPromiseLike(value)) this._observePromise(value, entry.eventName, { id: 0, kind: 'replay', key: entry.eventName, fn: listener, tags: [], owner: null }, null, 'replay');
      } catch (error) {
        errors.push(error);
        this._handleListenerError(entry.eventName, { id: 0, kind: 'replay', key: entry.eventName, fn: listener, tags: [], owner: null }, error, { phase: 'replay' });
      }
    }
    return { replayed: entries.length, errors };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle and observability
  // ---------------------------------------------------------------------------

  async _flushInternal() {
    await this._scheduler.flush();
    while (this._activeDispatches.size || this._pendingAsync.size) {
      await Promise.allSettled([...this._activeDispatches, ...this._pendingAsync]);
    }
    return this.snapshot();
  }

  async flush(options = {}) {
    return raceWithSignal(this._flushInternal(), {
      signal: options.signal,
      timeoutMs: Math.max(0, Number(options.timeoutMs) || 0),
      unrefTimer: false,
    });
  }

  async drain(options = {}) {
    if (this._closed) return this.snapshot();
    this._accepting = false;
    await raceWithSignal(this._scheduler.drain(), {
      signal: options.signal,
      timeoutMs: Math.max(0, Number(options.timeoutMs) || 0),
      unrefTimer: false,
    });
    await this.flush(options);
    return this.snapshot();
  }

  async close(options = {}) {
    if (this._closed) return this.snapshot();
    this._accepting = false;
    const timeoutMs = Math.max(0, Number(options.timeoutMs ?? this._lifecycle.shutdownTimeoutMs) || 0);
    const forceOnTimeout = options.forceOnTimeout ?? (this._lifecycle.forceOnTimeout === true);
    let forced = options.force === true;
    let shutdownError = null;

    if (!forced) {
      try { await this.flush({ timeoutMs, signal: options.signal }); }
      catch (error) {
        shutdownError = error;
        const timedOut = error?.name === 'TimeoutError' || error?.code === 'EVENT_TIMEOUT';
        if (!timedOut || !forceOnTimeout) throw error;
        forced = true;
        this._emitDiagnostic('shutdown:timeout', { timeoutMs, error });
      }
    }

    await this._scheduler.close({ force: forced });
    if (options.closeBridge !== false && this._bridge) {
      try { await (this._bridge.close?.() || this._bridge.stop?.()); } catch (error) { this._emitDiagnostic('bridge:close-error', { error }); }
    }
    if (options.closeBroadcasting !== false && this._broadcastManager) {
      try { await this._broadcastManager.close?.(); } catch (error) { this._emitDiagnostic('broadcast:close-error', { error }); }
    }
    if (options.removeListeners !== false) this._registry.clear();
    if (options.clearHistory === true) this._journal.clear();
    if (options.closeOutbox !== false && this._outbox?.close) {
      try { await this._outbox.close(); } catch (error) { this._emitDiagnostic('outbox:close-error', { error }); }
    }
    if (options.closeSubsystems !== false) {
      for (const [name, entry] of [...this._subsystems].reverse()) {
        if (entry.closeOnShutdown === false) continue;
        const subsystem = entry.subsystem;
        try {
          let operation = null;
          if (typeof subsystem?.close === 'function') operation = subsystem.close({ force: forced, timeoutMs, signal: options.signal });
          else if (typeof subsystem?.stop === 'function') operation = subsystem.stop({ force: forced, timeoutMs, signal: options.signal });
          else if (typeof subsystem?.dispose === 'function') operation = subsystem.dispose();
          if (isPromiseLike(operation)) {
            await raceWithSignal(operation, {
              signal: options.signal,
              timeoutMs: Math.max(0, Number(options.subsystemTimeoutMs ?? timeoutMs) || 0),
              unrefTimer: false,
            });
          }
        } catch (error) {
          this._emitDiagnostic('subsystem:close-error', { name, error });
          if (entry.required === true && options.failOnSubsystemClose === true) throw error;
        }
      }
    }
    this._contextManager.close();
    this._closed = true;
    this._lastShutdown = Object.freeze({ forced, timeoutMs, error: shutdownError || null, closedAt: Date.now() });
    if (options.removeDiagnostics !== false) this.diagnostics.close?.();
    return this.snapshot();
  }

  setBridge(bridge) { this._bridge = bridge || null; return this; }
  setOutbox(outbox) { this._outbox = outbox || null; return this; }
  outbox() { return this._outbox; }
  registerSubsystem(name, subsystem, options = {}) {
    const key = String(name || '').trim();
    if (!key) throw new TypeError('Event subsystem name is required');
    if (!subsystem || (typeof subsystem !== 'object' && typeof subsystem !== 'function')) {
      throw new TypeError(`Event subsystem [${key}] must be an object or function`);
    }
    if (this._subsystems.has(key) && options.replace !== true) {
      throw new EventAdmissionError(`Event subsystem already registered: ${key}`, { code: 'EVENT_SUBSYSTEM_DUPLICATE' });
    }
    this._subsystems.set(key, Object.freeze({
      name: key,
      subsystem,
      required: options.required === true,
      closeOnShutdown: options.closeOnShutdown !== false,
      meta: options.meta && typeof options.meta === 'object' ? Object.freeze({ ...options.meta }) : null,
    }));
    return this;
  }
  unregisterSubsystem(name, options = {}) {
    const key = String(name || '').trim();
    const entry = this._subsystems.get(key);
    if (!entry) return false;
    this._subsystems.delete(key);
    if (options.close === true) {
      const result = entry.subsystem?.close?.() ?? entry.subsystem?.stop?.() ?? entry.subsystem?.dispose?.();
      if (isPromiseLike(result)) this._observePromise(result, `subsystem:${key}:close`, { id: 0, kind: 'subsystem', key, fn: () => {}, tags: [], owner: null }, null, 'subsystem-close');
    }
    return true;
  }
  subsystem(name) { return this._subsystems.get(String(name || '').trim())?.subsystem || null; }
  subsystems() {
    const output = Object.create(null);
    for (const [name, entry] of this._subsystems) {
      let snapshot = null;
      try { snapshot = entry.subsystem?.snapshot?.() ?? entry.subsystem?.health?.() ?? null; } catch (error) { snapshot = { error: { name: error.name, message: error.message, code: error.code } }; }
      output[name] = Object.freeze({ required: entry.required, closeOnShutdown: entry.closeOnShutdown, meta: entry.meta, snapshot });
    }
    return Object.freeze(output);
  }
  schemas() { return this._schemaRegistry; }
  codecs() { return this._codecRegistry; }
  registerSchema(eventName, version, definition, options) { this._schemaRegistry.register(eventName, version, definition, options); return this; }
  freezeRegistrations(options = {}) {
    this._registry.freeze();
    if (options.contracts === true) this._schemaRegistry.freeze?.();
    if (options.codecs === true) this._codecRegistry.freeze?.();
    return this;
  }
  unfreezeRegistrations(options = {}) {
    this._registry.unfreeze();
    if (options.contracts === true) this._schemaRegistry.unfreeze?.();
    if (options.codecs === true) this._codecRegistry.unfreeze?.();
    return this;
  }
  registrationsFrozen() { return this._registry.registrationFrozen === true; }

  dispatchVersioned(eventName, payload, options = {}) {
    const name = normalizeEventName(eventName, this._normalizeDot);
    const sourceVersion = Math.max(1, Number(options.version) || 1);
    const targetVersion = options.targetVersion == null ? this._schemaRegistry.latestVersion(name) : Number(options.targetVersion);
    const transformed = options.upcast === false || !targetVersion || targetVersion === sourceVersion
      ? { eventName: name, version: sourceVersion, payload }
      : this._schemaRegistry.upcast(name, sourceVersion, payload, targetVersion, { context: this.getContext() });
    if (this._schemaRegistry.has(name, transformed.version)) {
      this._schemaRegistry.validate(name, transformed.version, transformed.payload, { context: this.getContext() });
    }
    if (options.async === true) {
      return this.dispatchAsync(name, transformed.payload).then(() => transformed);
    }
    this.dispatch(name, transformed.payload);
    return transformed;
  }

  async dispatchDurable(eventOrName, ...args) {
    if (!this._outbox) throw new EventAdmissionError('Durable outbox is not configured', { code: 'EVENT_OUTBOX_DISABLED' });
    let options = {};
    if (args.length && args.at(-1)?.__eventDurableOptions === true) options = args.pop().value || {};
    const result = await this._outbox.enqueue(eventOrName, args, options);
    if (options.dispatchLocal === true) this.dispatch(eventOrName, ...args);
    return result;
  }

  durableOptions(value = {}) { return Object.freeze({ __eventDurableOptions: true, value }); }

  setBroadcastManager(manager, options = {}) {
    this._broadcastManager = manager || null;
    if (options.auto !== undefined) this._autoBroadcast = options.auto === true;
    return this;
  }
  health() { return this._health.check(); }
  metrics() { return this._metricsStore.snapshot(); }
  prometheus(prefix) { return this._metricsStore.prometheus(prefix); }
  resetMetrics() { this._metricsStore.reset(); return this; }
  queueSnapshot() { return this._scheduler.snapshot(); }
  historySnapshot() { return this._journal.snapshot(); }

  stats() {
    return Object.freeze({
      listeners: this._registry.total,
      exactEventNames: this._listeners.size,
      patterns: this._patternListeners.length,
      any: this._anyListeners.length,
      asyncInFlight: this._inFlightAsync,
      pendingAsyncListeners: this._pendingAsync.size,
      activeDispatches: this._activeDispatches.size,
      deferredQueued: this._scheduler.length,
      history: this._journal.snapshot(),
      scheduler: this._scheduler.snapshot(),
      metrics: this._metricsStore.snapshot(),
      diagnostics: this.diagnostics.snapshot?.() || null,
      contracts: this._schemaRegistry.snapshot?.() || null,
      codecs: this._codecRegistry.snapshot?.() || null,
      outbox: this._outbox?.snapshot?.() || null,
      subsystems: this.subsystems(),
      registrationsFrozen: this._registry.registrationFrozen === true,
    });
  }

  snapshot() {
    return Object.freeze({
      profile: this.configuration.value.profile,
      accepting: this._accepting,
      closed: this._closed,
      health: this.health(),
      stats: this.stats(),
      bridge: this._bridge?.snapshot?.() || null,
      broadcasting: this._broadcastManager?.snapshot?.() || null,
      shutdown: this._lastShutdown,
    });
  }

  // ---------------------------------------------------------------------------
  // Dispatch internals
  // ---------------------------------------------------------------------------

  _assertOpenForRegistration() {
    if (this._closed) throw new EventClosedError();
  }

  _assertDispatchAdmission(options = {}) {
    if (this._closed) throw new EventClosedError();
    if (!this._accepting && options.allowDuringDrain !== true) {
      throw new EventAdmissionError('Event dispatcher is draining', { code: 'EVENT_DISPATCHER_DRAINING' });
    }
  }

  _validateEventName(name, options = {}) {
    this._security.validateName(name, options);
  }

  _dispatchStringMinimal(eventName, args) {
    const name = normalizeEventName(eventName, this._normalizeDot);
    if (this._security.nameValidationActive) this._security.validateName(name);
    if (this._security.maxDispatchPayloadBytes || this._security.maxContextBytes) {
      const context = this._security.maxContextBytes ? this.getContext() : null;
      this._security.validateDispatch(name, args, context, { skipName: true });
    }

    const plan = this._registry.plan(name);
    const errorPolicy = this._defaultErrorPolicy;
    let fatal = null;

    for (let stageIndex = 0; stageIndex < plan.exactStages.length && !fatal; stageIndex++) {
      const entries = plan.exactStages[stageIndex].entries;
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (!this._claim(entry)) continue;
        try {
          const value = entry.fn(...args);
          if (isPromiseLike(value)) this._observePromise(value, name, entry, null, 'dispatch');
        } catch (error) {
          this._handleListenerError(name, entry, error, { phase: 'dispatch' });
          if (normalizeErrorPolicy(entry.errorPolicy, errorPolicy) === 'fail-fast') { fatal = error; break; }
        }
      }
    }

    if (!fatal && (plan.patterns.length || plan.any.length)) {
      const namedArgs = [name, ...args];
      for (let index = 0; index < plan.patterns.length; index++) {
        const entry = plan.patterns[index];
        if (!this._claim(entry)) continue;
        try {
          const value = entry.fn(...namedArgs);
          if (isPromiseLike(value)) this._observePromise(value, name, entry, null, 'dispatch');
        } catch (error) {
          this._handleListenerError(name, entry, error, { phase: 'dispatch' });
          if (normalizeErrorPolicy(entry.errorPolicy, errorPolicy) === 'fail-fast') { fatal = error; break; }
        }
      }
      for (let index = 0; index < plan.any.length && !fatal; index++) {
        const entry = plan.any[index];
        if (!this._claim(entry)) continue;
        try {
          const value = entry.fn(...namedArgs);
          if (isPromiseLike(value)) this._observePromise(value, name, entry, null, 'dispatch');
        } catch (error) {
          this._handleListenerError(name, entry, error, { phase: 'dispatch' });
          if (normalizeErrorPolicy(entry.errorPolicy, errorPolicy) === 'fail-fast') { fatal = error; break; }
        }
      }
    }

    if (fatal) throw fatal;
  }

  async _dispatchStringAsyncMinimal(eventName, args) {
    const name = normalizeEventName(eventName, this._normalizeDot);
    if (this._security.nameValidationActive) this._security.validateName(name);
    if (this._security.maxDispatchPayloadBytes || this._security.maxContextBytes) {
      const context = this._security.maxContextBytes ? this.getContext() : null;
      this._security.validateDispatch(name, args, context, { skipName: true });
    }

    const plan = this._registry.plan(name);
    const errorPolicy = this._defaultErrorPolicy;
    this._inFlightAsync++;
    try {
      for (let stageIndex = 0; stageIndex < plan.exactStages.length; stageIndex++) {
        const entries = plan.exactStages[stageIndex].entries;
        for (let index = 0; index < entries.length; index++) {
          const entry = entries[index];
          if (!this._claim(entry)) continue;
          try {
            const value = entry.fn(...args);
            if (entry.timeoutMs) await raceWithSignal(Promise.resolve(value), { timeoutMs: entry.timeoutMs });
            else await value;
          } catch (error) {
            this._handleListenerError(name, entry, error, { phase: 'dispatch:async' });
            if (normalizeErrorPolicy(entry.errorPolicy, errorPolicy) === 'fail-fast') throw error;
          }
        }
      }

      if (plan.patterns.length || plan.any.length) {
        const namedArgs = [name, ...args];
        for (let index = 0; index < plan.patterns.length; index++) {
          const entry = plan.patterns[index];
          if (!this._claim(entry)) continue;
          try {
            const value = entry.fn(...namedArgs);
            if (entry.timeoutMs) await raceWithSignal(Promise.resolve(value), { timeoutMs: entry.timeoutMs });
            else await value;
          } catch (error) {
            this._handleListenerError(name, entry, error, { phase: 'dispatch:async' });
            if (normalizeErrorPolicy(entry.errorPolicy, errorPolicy) === 'fail-fast') throw error;
          }
        }
        for (let index = 0; index < plan.any.length; index++) {
          const entry = plan.any[index];
          if (!this._claim(entry)) continue;
          try {
            const value = entry.fn(...namedArgs);
            if (entry.timeoutMs) await raceWithSignal(Promise.resolve(value), { timeoutMs: entry.timeoutMs });
            else await value;
          } catch (error) {
            this._handleListenerError(name, entry, error, { phase: 'dispatch:async' });
            if (normalizeErrorPolicy(entry.errorPolicy, errorPolicy) === 'fail-fast') throw error;
          }
        }
      }
    } finally {
      this._inFlightAsync = Math.max(0, this._inFlightAsync - 1);
    }
    return undefined;
  }

  _peekEventName(eventOrName) {
    if (typeof eventOrName === 'string') return normalizeEventName(eventOrName, this._normalizeDot);
    return eventOrName?.eventName || eventOrName?.name || eventOrName?.constructor?.eventName || eventOrName?.constructor?.name || 'unknown';
  }

  _resolveDispatchInput(eventOrName, args) {
    if (typeof eventOrName === 'string') {
      const name = normalizeEventName(eventOrName, this._normalizeDot);
      this._validateEventName(name);
      return { name, eventObject: null, finalArgs: args };
    }
    if (eventOrName && typeof eventOrName === 'object') {
      const nameRaw =
        (typeof eventOrName.eventName === 'string' && eventOrName.eventName) ||
        (typeof eventOrName.name === 'string' && eventOrName.name) ||
        (eventOrName.constructor && typeof eventOrName.constructor.eventName === 'string' && eventOrName.constructor.eventName) ||
        (eventOrName.constructor && eventOrName.constructor.name) ||
        null;
      if (!nameRaw) throw new TypeError('Event object must provide eventName/name or have a named constructor');
      const name = normalizeEventName(nameRaw, this._normalizeDot);
      this._validateEventName(name);
      return { name, eventObject: eventOrName, finalArgs: [eventOrName, ...args] };
    }
    throw new TypeError('dispatch expects (string eventName, ...args) or (eventObject, ...args)');
  }

  _attachContext(eventObject, context) {
    try {
      if (!Object.prototype.hasOwnProperty.call(eventObject, 'ctx')) {
        Object.defineProperty(eventObject, 'ctx', { value: context, enumerable: false, configurable: true });
      }
    } catch {}
  }

  _prepare(eventOrName, args, options = {}) {
    this._assertDispatchAdmission(options);
    const resolved = this._resolveDispatchInput(eventOrName, args);
    const context = this.getContext();
    this._security.validateDispatch(resolved.name, resolved.finalArgs, context, { skipName: true });
    if (resolved.eventObject && context) this._attachContext(resolved.eventObject, context);
    if (this._contractAutoValidate && resolved.eventObject && this._schemaRegistry.has(resolved.name, resolved.eventObject.version || 1)) {
      this._schemaRegistry.validate(resolved.name, resolved.eventObject.version || 1, resolved.eventObject.payload, { context, event: resolved.eventObject });
    }
    const needsPlan = this._registry.total > 0 || options.report === true;
    const plan = needsPlan
      ? this._registry.plan(resolved.name)
      : Object.freeze({ eventName: resolved.name, wildcardNames: Object.freeze([]), exactStages: Object.freeze([]), patterns: Object.freeze([]), any: Object.freeze([]) });
    const wildcardNames = plan.wildcardNames || computeWildcardEvents(resolved.name);
    const report = options.report
      ? new DispatchReport(resolved.name, { mode: options.mode, context: shallowEventContext(context), startedHr: performance.now() })
      : null;
    const history = this._journal.record(resolved.name, resolved.finalArgs, shallowEventContext(context));
    if (history.accepted) this._metricsStore.increment('history_recorded_total');
    else if (history.reason !== 'policy') this._metricsStore.increment('history_rejected_total');
    return { ...resolved, context, wildcardNames, plan, report, history };
  }

  _isFastNoop(prepared) {
    return this._registry.total === 0 &&
      !this._journal.enabled &&
      !this._logEvents &&
      !this._metricsEnabled &&
      !this._diagnosticsActive();
  }

  *_planInvocations(plan, eventName, args) {
    for (const stage of plan.exactStages) {
      for (const entry of stage.entries) yield { entry, args, matchedName: stage.eventName };
    }
    for (const entry of plan.patterns) yield { entry, args: [eventName, ...args], matchedName: eventName };
    for (const entry of plan.any) yield { entry, args: [eventName, ...args], matchedName: eventName };
  }

  _claim(entry) {
    if (entry.paused) return false;
    if (entry.once) return this._registry.claimOnce(entry);
    return entry.active;
  }

  _dispatchSyncDetailed(eventOrName, args, options = {}) {
    const prepared = this._prepare(eventOrName, args, { ...options, mode: options.mode || 'sync' });
    if (this._isFastNoop(prepared)) return prepared.report || undefined;

    const started = performance.now();
    const errorPolicy = normalizeErrorPolicy(options.errorPolicy, this._defaultErrorPolicy);
    let errorCount = 0;
    let invoked = 0;
    let fatal = null;

    for (const invocation of this._planInvocations(prepared.plan, prepared.name, prepared.finalArgs)) {
      const { entry } = invocation;
      if (prepared.report) prepared.report.matched++;
      if (!this._claim(entry)) { if (prepared.report) prepared.report.skipped++; continue; }
      invoked++;
      if (prepared.report) prepared.report.invoked++;

      try {
        const value = entry.fn(...invocation.args);
        if (isPromiseLike(value)) {
          const resultRecord = prepared.report ? { listenerId: entry.id, status: 'pending', value: undefined } : null;
          if (resultRecord) prepared.report.results.push(resultRecord);
          this._observePromise(value, prepared.name, entry, resultRecord, 'dispatch');
        } else if (prepared.report) {
          prepared.report.results.push({ listenerId: entry.id, status: 'fulfilled', value });
        }
      } catch (error) {
        errorCount++;
        const failure = this._handleListenerError(prepared.name, entry, error, { phase: 'dispatch' });
        prepared.report?.errors.push(failure);
        const listenerPolicy = normalizeErrorPolicy(entry.errorPolicy, errorPolicy);
        if (listenerPolicy === 'fail-fast') { fatal = error; break; }
      }
    }

    const duration = performance.now() - started;
    this._completeDispatch(prepared, duration, errorCount, invoked, options.mode || 'sync');
    if (fatal) throw fatal;
    return prepared.report || undefined;
  }

  async _dispatchAsyncDetailed(eventOrName, args, options = {}) {
    const prepared = this._prepare(eventOrName, args, { ...options, mode: options.mode || 'sequential' });
    if (this._isFastNoop(prepared)) return prepared.report || undefined;
    const started = performance.now();
    const errorPolicy = normalizeErrorPolicy(options.errorPolicy, this._defaultErrorPolicy);
    let errorCount = 0;
    let invoked = 0;
    let fatal = null;
    this._inFlightAsync++;

    try {
      for (const invocation of this._planInvocations(prepared.plan, prepared.name, prepared.finalArgs)) {
        const { entry } = invocation;
        if (prepared.report) prepared.report.matched++;
        if (!this._claim(entry)) { if (prepared.report) prepared.report.skipped++; continue; }
        invoked++;
        if (prepared.report) prepared.report.invoked++;

        try {
          const timeoutMs = entry.timeoutMs || Number(options.timeoutMs) || 0;
          const value = await raceWithSignal(Promise.resolve().then(() => entry.fn(...invocation.args)), {
            signal: options.signal,
            timeoutMs,
          });
          prepared.report?.results.push({ listenerId: entry.id, status: 'fulfilled', value });
          if (typeof options.stopPredicate === 'function' && options.stopPredicate(value, publicListener(entry), prepared.report)) {
            if (prepared.report) {
              prepared.report.stopped = true;
              prepared.report.stopValue = value;
            }
            break;
          }
        } catch (error) {
          errorCount++;
          if (error?.name === 'AbortError') prepared.report && (prepared.report.aborted = true);
          if (error?.name === 'TimeoutError') prepared.report && (prepared.report.timedOut = true);
          const failure = this._handleListenerError(prepared.name, entry, error, { phase: 'dispatch:async' });
          prepared.report?.errors.push(failure);
          const listenerPolicy = normalizeErrorPolicy(entry.errorPolicy, errorPolicy);
          if (listenerPolicy === 'fail-fast' || error?.name === 'AbortError') { fatal = error; break; }
        }
      }
    } finally {
      this._inFlightAsync = Math.max(0, this._inFlightAsync - 1);
    }

    const duration = performance.now() - started;
    this._completeDispatch(prepared, duration, errorCount, invoked, options.mode || 'sequential');
    if (fatal) throw fatal;
    return prepared.report || undefined;
  }

  async _dispatchParallelDetailed(eventOrName, args, options = {}) {
    const prepared = this._prepare(eventOrName, args, { ...options, mode: options.mode || 'parallel' });
    if (this._isFastNoop(prepared)) return prepared.report || undefined;
    const started = performance.now();
    const invocations = Array.from(this._planInvocations(prepared.plan, prepared.name, prepared.finalArgs));
    const concurrency = Math.min(invocations.length || 1, parseConcurrency(options.concurrency, Infinity));
    const errorPolicy = normalizeErrorPolicy(options.errorPolicy, 'collect');
    let cursor = 0;
    let errorCount = 0;
    let invoked = 0;
    let fatal = null;
    let stopped = false;
    this._inFlightAsync++;
    if (prepared.report) prepared.report.matched = invocations.length;

    const worker = async () => {
      while (!stopped) {
        const index = cursor++;
        if (index >= invocations.length) return;
        const invocation = invocations[index];
        const { entry } = invocation;
        if (!this._claim(entry)) { prepared.report && prepared.report.skipped++; continue; }
        invoked++;
        if (prepared.report) prepared.report.invoked++;
        try {
          const value = await raceWithSignal(Promise.resolve().then(() => entry.fn(...invocation.args)), {
            signal: options.signal,
            timeoutMs: entry.timeoutMs || Number(options.timeoutMs) || 0,
          });
          if (prepared.report) prepared.report.results[index] = { listenerId: entry.id, status: 'fulfilled', value };
        } catch (error) {
          errorCount++;
          const failure = this._handleListenerError(prepared.name, entry, error, { phase: 'dispatch:parallel' });
          if (prepared.report) {
            prepared.report.errors.push(failure);
            prepared.report.results[index] = { listenerId: entry.id, status: 'rejected', error };
            if (error?.name === 'AbortError') prepared.report.aborted = true;
            if (error?.name === 'TimeoutError') prepared.report.timedOut = true;
          }
          const listenerPolicy = normalizeErrorPolicy(entry.errorPolicy, errorPolicy);
          if (listenerPolicy === 'fail-fast' || error?.name === 'AbortError') { fatal = error; stopped = true; }
        }
      }
    };

    try { await Promise.all(Array.from({ length: Number.isFinite(concurrency) ? concurrency : invocations.length || 1 }, worker)); }
    finally { this._inFlightAsync = Math.max(0, this._inFlightAsync - 1); }

    if (prepared.report) prepared.report.results = prepared.report.results.filter(Boolean);
    const duration = performance.now() - started;
    this._completeDispatch(prepared, duration, errorCount, invoked, options.mode || 'parallel');
    if (fatal) throw fatal;
    return prepared.report || undefined;
  }

  _observePromise(value, eventName, entry, resultRecord = null, phase = 'dispatch') {
    let observed;
    observed = Promise.resolve(value)
      .then((result) => {
        if (resultRecord) { resultRecord.status = 'fulfilled'; resultRecord.value = result; }
        return result;
      }, (error) => {
        if (resultRecord) { resultRecord.status = 'rejected'; resultRecord.error = error; }
        this._handleListenerError(eventName, entry, error, { phase, async: true });
        return undefined;
      })
      .finally(() => this._pendingAsync.delete(observed));
    this._pendingAsync.add(observed);
    return observed;
  }

  _observeBroadcast(event) {
    if (!event || typeof event !== 'object' || !this._broadcastManager) return null;
    let tracked;
    tracked = Promise.resolve()
      .then(() => this.broadcast(event))
      .catch((error) => {
        this._logger.error('[EventBus] broadcast error', error);
        this._emitDiagnostic('broadcast:error', { eventName: this._peekEventName(event), error, ctx: shallowEventContext(this.getContext()) });
        return { broadcast: false, error, deliveries: [] };
      })
      .finally(() => this._pendingAsync.delete(tracked));
    this._pendingAsync.add(tracked);
    return tracked;
  }

  _trackActiveDispatch(promise) {
    let tracked;
    tracked = Promise.resolve(promise).finally(() => this._activeDispatches.delete(tracked));
    this._activeDispatches.add(tracked);
    return tracked;
  }

  _completeDispatch(prepared, duration, errorCount, invoked, mode) {
    this._metricsStore.recordDispatch(prepared.name, duration, errorCount, invoked);
    prepared.report?.complete(duration);

    if (this._logEvents) {
      const message = `[EventBus] ${prepared.name}${mode === 'sync' ? '' : ` (${mode})`} (${duration.toFixed(3)}ms, errors=${errorCount}, ctx=${prepared.context?.id ?? 'n/a'})`;
      if (this._logPayloads) this._logger.debug(message, ...prepared.finalArgs);
      else this._logger.debug(message, { args: prepared.finalArgs.length });
    }

    if (this._diagnosticsActive('dispatch')) {
      const payload = {
        eventName: prepared.name,
        mode,
        ms: duration,
        errorCount,
        invoked,
        ctx: shallowEventContext(prepared.context),
      };
      this._emitDiagnostic('dispatch', payload);
      if (this._slowMs > 0 && duration >= this._slowMs) this._emitDiagnostic('slow', { ...payload, slowMs: this._slowMs });
      if (errorCount > 0) this._emitDiagnostic('error', payload);
    }
  }

  _handleListenerError(eventName, entry, error, options = {}) {
    const context = this.getContext();
    const listener = publicListener(entry);
    this._logger.error(`[EventBus] listener error on "${entry.pattern || entry.key || eventName}" (ctx=${context?.id ?? 'n/a'})`, error);
    this._metricsStore.recordListenerError(eventName, { async: options.async === true });
    const failure = { listenerId: entry.id, listener, error, phase: options.phase || 'dispatch', async: options.async === true };
    if (this._diagnosticsActive('listener:error')) {
      this._emitDiagnostic('listener:error', {
        eventName,
        pattern: entry.pattern || null,
        listener,
        ctxId: context?.id ?? null,
        ctx: shallowEventContext(context),
        phase: failure.phase,
        async: failure.async,
        error,
      });
    }
    return failure;
  }

  _emitDiagnostic(name, payload) {
    try { this.diagnostics.emit(name, payload); }
    catch { this._metricsStore.increment('diagnostics_errors_total'); }
  }

  // ---------------------------------------------------------------------------
  // Replay internals
  // ---------------------------------------------------------------------------

  _replayEntry(entry, options) {
    if (!options || options.replay == null || !this._journal.enabled) return;
    const requested = options.replay === true ? Infinity : Math.max(0, Number(options.replay) || 0);
    if (requested === 0) return;

    let history;
    if (entry.kind === 'exact') {
      history = this._journal.get(entry.key, { limit: requested === Infinity ? 0 : requested })
        .map((item) => ({ eventName: entry.key, ...item }));
    } else if (entry.kind === 'pattern') {
      history = this._journal.all().filter((item) => {
        if (entry.prefix && !item.eventName.startsWith(entry.prefix)) return false;
        return entry.regex.test(item.eventName);
      });
      if (requested !== Infinity) history = history.slice(Math.max(0, history.length - requested));
    } else {
      history = this._journal.all({ limit: requested === Infinity ? 0 : requested });
    }

    const consumesOnce = entry.once && options.replayConsumesOnce === true;
    for (const item of history) {
      if (consumesOnce && !this._registry.claimOnce(entry)) break;
      const args = entry.kind === 'exact' ? item.args : [item.eventName, ...item.args];
      const invoke = () => {
        try {
          const value = entry.fn(...args);
          if (isPromiseLike(value)) this._observePromise(value, item.eventName, entry, null, 'replay');
        } catch (error) {
          this._handleListenerError(item.eventName, entry, error, { phase: 'replay' });
        }
      };
      if (options.replayContext === true && item.ctx) this.run(item.ctx, invoke);
      else invoke();
      if (consumesOnce) break;
    }
  }

  // Compatibility private helpers retained for integrations that used them.
  _emitExactSync(eventName, args) {
    const bucket = (this._listeners.get(eventName) || []).slice();
    let errors = 0;
    for (const entry of bucket) {
      if (!this._claim(entry)) continue;
      try {
        const value = entry.fn(...args);
        if (isPromiseLike(value)) this._observePromise(value, eventName, entry);
      } catch (error) { errors++; this._handleListenerError(eventName, entry, error); }
    }
    return errors;
  }

  async _emitExactAsync(eventName, args) {
    const bucket = (this._listeners.get(eventName) || []).slice();
    let errors = 0;
    for (const entry of bucket) {
      if (!this._claim(entry)) continue;
      try { await entry.fn(...args); }
      catch (error) { errors++; this._handleListenerError(eventName, entry, error); }
    }
    return errors;
  }
}

export default AdvancedEventDispatcher;
