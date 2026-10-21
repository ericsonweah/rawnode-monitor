'use strict';

import { EventConfigurationError } from '../errors/EventError.js';

const PROFILES = Object.freeze({
  compat: Object.freeze({
    listeners: { maxPerEvent: 5000, maxTotal: 0, maxPatterns: 5000, maxPerPattern: 5000, maxAny: 5000, planCacheMax: 1024 },
    history: { maxEntriesPerEvent: 0, maxEventNames: 0, maxEntriesTotal: 0, maxBytes: 0, maxPayloadBytes: 0, ttlMs: 0, clonePolicy: 'reference' },
    deferred: { maxItems: 0, maxBytes: 0, maxInFlight: 1, budgetMs: 4, maxPerSlice: 256, overflow: 'reject', awaitTasks: false },
    metrics: { enabled: false, maxSeries: 2048, slowMs: 0, prefix: 'rawnode_events' },
    context: { enabled: true },
    diagnostics: { enabled: false, historyLimit: 0, maxHistoryBytes: 0, publishChannel: true },
    contracts: { autoValidate: false },
    broadcasting: { enabled: false, auto: false, errorPolicy: 'isolate', defaultChannel: 'global' },
    security: {
      strictNames: false,
      maxEventNameBytes: 0,
      maxSegments: 0,
      maxPatternBytes: 0,
      maxDispatchPayloadBytes: 0,
      maxContextBytes: 0,
      blockControlChars: false,
      namespaceAllow: null,
      namespaceDeny: null,
    },
    dispatch: { errorPolicy: 'isolate' },
    lifecycle: { shutdownTimeoutMs: 0, forceOnTimeout: false },
  }),
  production: Object.freeze({
    listeners: { maxPerEvent: 5000, maxTotal: 100_000, maxPatterns: 10_000, maxPerPattern: 1000, maxAny: 1000, planCacheMax: 4096 },
    history: { maxEntriesPerEvent: 0, maxEventNames: 1024, maxEntriesTotal: 100_000, maxBytes: 64 * 1024 * 1024, maxPayloadBytes: 256 * 1024, ttlMs: 60 * 60 * 1000, clonePolicy: 'shallow' },
    deferred: { maxItems: 100_000, maxBytes: 64 * 1024 * 1024, maxInFlight: 32, budgetMs: 4, maxPerSlice: 256, overflow: 'drop-oldest', awaitTasks: false },
    metrics: { enabled: true, maxSeries: 2048, slowMs: 25, prefix: 'rawnode_events' },
    context: { enabled: true },
    diagnostics: { enabled: false, historyLimit: 256, maxHistoryBytes: 4 * 1024 * 1024, publishChannel: true },
    contracts: { autoValidate: false },
    broadcasting: { enabled: false, auto: false, errorPolicy: 'isolate', defaultChannel: 'global' },
    security: {
      strictNames: true,
      maxEventNameBytes: 512,
      maxSegments: 32,
      maxPatternBytes: 4096,
      maxDispatchPayloadBytes: 16 * 1024 * 1024,
      maxContextBytes: 64 * 1024,
      blockControlChars: true,
      namespaceAllow: null,
      namespaceDeny: null,
    },
    dispatch: { errorPolicy: 'isolate' },
    lifecycle: { shutdownTimeoutMs: 30_000, forceOnTimeout: true },
  }),
});

const ENUMS = Object.freeze({
  'history.clonePolicy': new Set(['reference', 'shallow', 'serialized']),
  'deferred.overflow': new Set(['reject', 'drop-newest', 'drop-oldest', 'coalesce']),
  'dispatch.errorPolicy': new Set(['isolate', 'collect', 'fail-fast']),
});

function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function number(value, fallback, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}
function merge(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(object(override))) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object'
      ? merge(base[key], value)
      : value;
  }
  return output;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  Object.freeze(value);
  return value;
}

export class EventConfiguration {
  constructor(options = {}) {
    const requestedProfile = String(options.profile || 'compat').toLowerCase();
    const profile = requestedProfile === 'enterprise' || requestedProfile === 'strict'
      ? 'production'
      : requestedProfile;
    if (!PROFILES[profile]) throw new EventConfigurationError(`Unknown events profile: ${profile}`);
    const selected = merge(PROFILES[profile], options);

    selected.profile = profile;
    selected.normalizeDot = options.normalizeDot === true;
    selected.logEvents = options.logEvents === true;
    selected.logger = options.logger || console;

    selected.listeners = merge(selected.listeners, object(options.listeners));
    selected.listeners.maxPerEvent = number(options.maxListenersPerEvent ?? selected.listeners.maxPerEvent, selected.listeners.maxPerEvent);
    selected.listeners.maxTotal = number(options.maxListenersTotal ?? selected.listeners.maxTotal, selected.listeners.maxTotal);
    selected.listeners.maxPatterns = number(options.maxPatternListeners ?? selected.listeners.maxPatterns, selected.listeners.maxPatterns);
    selected.listeners.maxPerPattern = number(options.maxListenersPerPattern ?? selected.listeners.maxPerPattern, selected.listeners.maxPerPattern);
    selected.listeners.maxAny = number(options.maxAnyListeners ?? selected.listeners.maxAny, selected.listeners.maxAny);
    selected.listeners.planCacheMax = number(options.planCacheMax ?? selected.listeners.planCacheMax, selected.listeners.planCacheMax);

    selected.history = merge(selected.history, object(options.history));
    selected.history.maxEntriesPerEvent = number(options.historyLimit ?? selected.history.maxEntriesPerEvent, selected.history.maxEntriesPerEvent);
    selected.history.maxEventNames = number(options.maxHistoryEvents ?? options.historyMaxEventNames ?? selected.history.maxEventNames, selected.history.maxEventNames);
    selected.history.maxEntriesTotal = number(options.maxHistoryEntries ?? selected.history.maxEntriesTotal, selected.history.maxEntriesTotal);
    selected.history.maxBytes = number(options.maxHistoryBytes ?? selected.history.maxBytes, selected.history.maxBytes);
    selected.history.maxPayloadBytes = number(options.maxHistoryPayloadBytes ?? selected.history.maxPayloadBytes, selected.history.maxPayloadBytes);
    selected.history.ttlMs = number(options.historyTtlMs ?? selected.history.ttlMs, selected.history.ttlMs);
    selected.history.allow = options.historyAllow ?? selected.history.allow ?? null;
    selected.history.deny = options.historyDeny ?? selected.history.deny ?? null;

    selected.metrics = merge(selected.metrics, object(options.metrics));
    if (options.metrics === true) selected.metrics.enabled = true;
    selected.metrics.enabled = selected.metrics.enabled === true;
    selected.metrics.slowMs = number(selected.metrics.slowMs, 0);
    selected.metrics.maxSeries = Math.max(1, number(selected.metrics.maxSeries, 2048, 1));

    selected.context = merge(selected.context, object(options.context));
    selected.diagnostics = merge(selected.diagnostics, object(options.diagnostics));
    selected.contracts = merge(selected.contracts, object(options.contracts));
    selected.broadcasting = merge(selected.broadcasting, object(options.broadcasting));
    selected.deferred = merge(selected.deferred, object(options.deferred));
    selected.security = merge(selected.security, object(options.security));
    selected.dispatch = merge(selected.dispatch, object(options.dispatch));
    selected.lifecycle = merge(selected.lifecycle, object(options.lifecycle));
    selected.lifecycle.shutdownTimeoutMs = number(options.shutdownTimeoutMs ?? selected.lifecycle.shutdownTimeoutMs, selected.lifecycle.shutdownTimeoutMs);
    selected.lifecycle.forceOnTimeout = options.forceOnShutdownTimeout ?? selected.lifecycle.forceOnTimeout;

    this._validate(selected);
    this.value = deepFreeze(selected);
  }

  _validate(value) {
    for (const [path, accepted] of Object.entries(ENUMS)) {
      const current = path.split('.').reduce((target, key) => target?.[key], value);
      if (!accepted.has(current)) throw new EventConfigurationError(`Invalid ${path}: ${current}`, { code: 'EVENT_CONFIGURATION_ENUM' });
    }
    for (const [name, current] of Object.entries(value.listeners)) {
      if (name.startsWith('max') || name.endsWith('Max')) {
        if (!Number.isFinite(Number(current)) || Number(current) < 0) throw new EventConfigurationError(`listeners.${name} must be non-negative`);
      }
    }
    if (value.history.maxEntriesPerEvent > 0 && value.history.maxEventNames === 0 && value.profile === 'production') {
      throw new EventConfigurationError('Production history requires a positive maxEventNames bound');
    }
  }

  get(path, fallback = undefined) {
    const value = String(path).split('.').reduce((target, key) => target?.[key], this.value);
    return value === undefined ? fallback : value;
  }

  toJSON() { return this.value; }
  static profiles() { return Object.keys(PROFILES); }
}

export default EventConfiguration;
