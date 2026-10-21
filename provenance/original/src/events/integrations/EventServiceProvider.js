'use strict';

// src/foundation/providers/EventServiceProvider.js

import { performance } from 'node:perf_hooks';
import { AdvancedEventDispatcher } from '../AdvancedEventDispatcher.js';
import { RedisEventBridge } from '../RedisEventBridge.js';
import { BroadcastManager } from '../broadcasting/BroadcastManager.js';
import { EventConfiguration } from '../config/EventConfiguration.js';
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
import { NodeEventFabric } from '../node/NodeEventFabric.js';
import { EventStudioManager, EventStudioServer } from '../studio/index.js';
import { importApplicationModule } from '../support/ApplicationModuleResolver.js';
import {
  RawMongoOutboxStore,
  RawMongoWorkflowStore,
  RawMongoEventStore,
  RawMongoProjectionCheckpointStore,
  RawMongoEventInbox,
  RawMongoJobStore,
  DurableEventWorker,
} from '../persistence/index.js';

function allowsBackgroundAutoStart(app) {
  const context = safeResolve(app, 'invocation.context', null) || app?.invocationContext || app?.context || null;
  if (!context) return true;
  if (context.allowBackgroundAutoStart !== undefined) return context.allowBackgroundAutoStart === true;
  if (context.allowBackgroundStart !== undefined) return context.allowBackgroundStart === true;
  if (context.registrationOnly === true) return false;
  return true;
}

const MISSING = Symbol('rawnode.events.missing');
const PROVIDER_OWNER = 'provider:events';
const PROVIDER_TAG = 'rawnode.events.provider';
const COMMAND_TAG = 'console.command';

const TRUE = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled']);
const FALSE = new Set(['0', 'false', 'no', 'n', 'off', 'disabled']);
const LISTENER_OPTION_KEYS = Object.freeze([
  'priority',
  'prepend',
  'once',
  'replay',
  'replayConsumesOnce',
  'owner',
  'tags',
  'tag',
  'timeoutMs',
  'errorPolicy',
  'meta',
  'pattern',
  'any',
  'paused',
]);
const RESERVED_CONFIGURATION_KEYS = new Set([
  'enabled',
  'provider',
  'profile',
  'global',
  'globalKey',
  'failFast',
  'strictConfig',
  'bootSummary',
  'healthCheckOnBoot',
  'doctorOnBoot',
  'doctorFailFast',
  'dynamicRegistration',
  'freezeListeners',
  'registerCommands',
  'registerAliases',
  'rollbackOnBootFailure',
  'readyTimeoutMs',
  'shutdownTimeoutMs',
  'closeTimeoutMs',
  'duplicateListeners',
  'closeListenerInstances',
  'closeExternalDispatcher',
  'closeExternalSubsystems',
  'listeners',
  'subscribers',
  'bus',
  'bridge',
  'broadcasting',
  'broadcast',
  'durable',
  'contracts',
  'codecs',
  'queue',
  'scheduler',
  'workflows',
  'sourcing',
  'lifecycle',
  'health',
  'fabric',
  'universal',
  'transports',
  'persistence',
  'studio',
  'browser',
  'security',
  'bindings',
]);

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function merge(...sources) {
  const output = {};
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (value === undefined) continue;
      if (isPlainObject(value) && isPlainObject(output[key])) output[key] = merge(output[key], value);
      else if (isPlainObject(value)) output[key] = merge(value);
      else if (Array.isArray(value)) output[key] = value.slice();
      else output[key] = value;
    }
  }
  return output;
}

function deepGet(target, key, fallback = undefined) {
  if (!target || !key) return fallback;
  let current = target;
  for (const part of String(key).split('.')) {
    if (!current || typeof current !== 'object' || !(part in current)) return fallback;
    current = current[part];
  }
  return current === undefined ? fallback : current;
}

function configGet(config, key, fallback = undefined) {
  try {
    if (typeof config?.get === 'function') {
      const value = config.get(key);
      return value === undefined ? fallback : value;
    }
  } catch {}
  return deepGet(config, key, fallback);
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function parseBoolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (TRUE.has(normalized)) return true;
  if (FALSE.has(normalized)) return false;
  return fallback;
}

function parseInteger(value, fallback, minimum = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.trunc(parsed));
}

function parseList(value, fallback = []) {
  if (Array.isArray(value)) return value.map((entry) => String(entry).trim()).filter(Boolean);
  if (typeof value !== 'string') return fallback.slice();
  const list = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return list.length ? list : fallback.slice();
}

function envString(name) {
  const value = process.env[name];
  if (value == null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function envBoolean(name) {
  const value = envString(name);
  return value === undefined ? undefined : parseBoolean(value, undefined);
}

function envInteger(name) {
  const value = envString(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function envList(name) {
  const value = envString(name);
  return value === undefined ? undefined : parseList(value, []);
}

function compactObject(value) {
  const output = {};
  for (const [key, current] of Object.entries(value || {})) {
    if (current !== undefined) output[key] = current;
  }
  return output;
}

function safeResolve(app, key, fallback = null) {
  try {
    const value = app?.resolve?.(key);
    return value === undefined || value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function hasBinding(app, key) {
  const container = app?.container || app?._container || app?.ioc || null;
  for (const target of [app, container]) {
    for (const method of ['has', 'bound', 'hasBinding', 'isBound']) {
      try {
        if (typeof target?.[method] === 'function' && target[method](key)) return true;
      } catch {}
    }
  }
  return false;
}

function bind(app, kind, key, factory) {
  const container = app?.container || app?._container || app?.ioc || null;
  if (typeof app?.[kind] === 'function') return app[kind](key, factory);
  if (typeof container?.[kind] === 'function') return container[kind](key, factory);
  if (kind === 'singleton' && typeof app?.singleton === 'function') return app.singleton(key, factory);
  if (kind === 'singleton' && typeof container?.singleton === 'function') return container.singleton(key, factory);
  if (typeof app?.bind === 'function') return app.bind(key, factory);
  if (typeof container?.bind === 'function') return container.bind(key, factory);
  throw providerError(`Application container cannot bind [${key}]`, 'EVENTS_PROVIDER_CONTAINER_BIND');
}

function bindIfAbsent(app, kind, key, factory) {
  if (hasBinding(app, key)) return false;
  bind(app, kind, key, factory);
  return true;
}

function tag(app, key, name) {
  const container = app?.container || app?._container || app?.ioc || null;
  for (const target of [app, container]) {
    try {
      if (typeof target?.tag === 'function') {
        target.tag(key, name);
        return true;
      }
    } catch {}
  }
  return false;
}

function resolveLogger(app) {
  const logger = safeResolve(app, 'logger', null);
  //if (logger && (typeof logger.info === 'function' || typeof logger.log === 'function')) return logger;
  return console;
}

function log(logger, level, ...values) {
  const method = logger?.[level] || logger?.log || console.log;
  try { method.call(logger, ...values); }
  catch { try { console.log(...values); } catch {} }
}

function providerError(message, code = 'EVENTS_PROVIDER_ERROR', details = null, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = 'EventsProviderError';
  error.code = code;
  if (details) error.details = details;
  return error;
}

function safeError(error) {
  if (!error) return null;
  return Object.freeze({
    name: error.name || 'Error',
    message: error.message || String(error),
    code: error.code || null,
    details: error.details || null,
  });
}

function cloneForPublic(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    return value;
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((entry) => cloneForPublic(entry, seen));
  if (!isPlainObject(value)) return `[${value.constructor?.name || 'Object'}]`;
  const output = {};
  for (const [key, current] of Object.entries(value)) {
    if (/^(?:password|secret|apiKey|api_key|signingKey|privateKey|accessToken|refreshToken|authorization|credential)$/i.test(key)) {
      output[key] = current ? '[redacted]' : current;
    } else output[key] = cloneForPublic(current, seen);
  }
  return output;
}

function freezePublic(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const current of Object.values(value)) freezePublic(current);
  return Object.freeze(value);
}

function freezeConfiguration(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (!Array.isArray(value) && !isPlainObject(value)) return value;
  for (const current of Object.values(value)) freezeConfiguration(current);
  return Object.freeze(value);
}

function withTimeout(operation, timeoutMs, label) {
  const promise = Promise.resolve(operation);
  if (!(timeoutMs > 0)) return promise;
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(providerError(
        `${label || 'Events operation'} timed out after ${timeoutMs}ms`,
        'EVENTS_PROVIDER_TIMEOUT',
        { timeoutMs, label },
      )), timeoutMs);
    }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function safeDispatch(events, eventName, payload, logger = null) {
  if (!events || typeof events.dispatch !== 'function') return false;
  try {
    events.dispatch(eventName, payload);
    return true;
  } catch (error) {
    if (logger) log(logger, 'warn', `[EventsServiceProvider] Could not dispatch ${eventName}:`, error?.message || error);
    return false;
  }
}

function normalizeTags(value) {
  const source = value == null ? [] : Array.isArray(value) ? value : [value];
  return Array.from(new Set(source.flat().map(String).map((entry) => entry.trim()).filter(Boolean)));
}

function isHierarchyWildcard(eventName) {
  const value = String(eventName || '');
  return value.endsWith(':*') && !value.includes('**') && !value.includes('?') && value.indexOf('*') === value.length - 1;
}

function listenerKind(eventName, options = {}) {
  if (options.any === true || eventName === '*') return 'any';
  if (options.pattern === true) return 'pattern';
  const value = String(eventName || '');
  if ((value.includes('*') || value.includes('?')) && !isHierarchyWildcard(value)) return 'pattern';
  return 'exact';
}

function configurationListenerMap(configuration) {
  if (isPlainObject(configuration.listeners)) return configuration.listeners;
  const entries = Object.entries(configuration || {}).filter(([key, value]) => (
    !RESERVED_CONFIGURATION_KEYS.has(key)
    && (Array.isArray(value) || typeof value === 'function' || typeof value === 'string')
  ));
  return Object.fromEntries(entries);
}

function normalizeDefinitionList(value) {
  if (value == null || value === false) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeProfile(value, production) {
  const profile = String(value || (production ? 'production' : 'compat')).trim().toLowerCase();
  return profile || (production ? 'production' : 'compat');
}

const BUS_OPTION_KEYS = new Set([
  'profile', 'normalizeDot', 'logEvents', 'logger',
  'maxListenersPerEvent', 'maxListenersTotal', 'maxPatternListeners',
  'maxListenersPerPattern', 'maxAnyListeners', 'planCacheMax',
  'historyLimit', 'maxHistoryEvents', 'historyMaxEventNames',
  'maxHistoryEntries', 'maxHistoryBytes', 'maxHistoryPayloadBytes',
  'historyTtlMs', 'historyAllow', 'historyDeny',
  'shutdownTimeoutMs', 'forceOnShutdownTimeout',
  'history', 'deferred', 'metrics', 'context', 'diagnostics',
  'contracts', 'broadcasting', 'security', 'dispatch', 'lifecycle',
]);

function extractBusOptions(source) {
  if (!isPlainObject(source)) return {};
  const output = isPlainObject(source.bus) ? merge(source.bus) : {};
  for (const key of BUS_OPTION_KEYS) {
    if (key === 'profile' && source.bus?.profile !== undefined) continue;
    if (source[key] !== undefined && output[key] === undefined) output[key] = source[key];
  }
  return output;
}

function applyBusEnvironment(raw, profile) {
  const history = compactObject({
    maxEntriesPerEvent: firstDefined(envInteger('EVENTS_HISTORY_PER_EVENT'), envInteger('EVENTS_HISTORY_LIMIT')),
    maxEventNames: envInteger('EVENTS_HISTORY_EVENT_NAMES'),
    maxEntriesTotal: envInteger('EVENTS_HISTORY_ENTRIES'),
    maxBytes: envInteger('EVENTS_HISTORY_BYTES'),
    maxPayloadBytes: envInteger('EVENTS_HISTORY_PAYLOAD_BYTES'),
    ttlMs: envInteger('EVENTS_HISTORY_TTL_MS'),
    clonePolicy: envString('EVENTS_HISTORY_MODE'),
    allow: envList('EVENTS_HISTORY_ALLOW'),
    deny: envList('EVENTS_HISTORY_DENY'),
  });
  const listeners = compactObject({
    maxPerEvent: envInteger('EVENTS_MAX_LISTENERS_PER_EVENT'),
    maxTotal: envInteger('EVENTS_MAX_LISTENERS_TOTAL'),
    maxPatterns: envInteger('EVENTS_MAX_PATTERNS'),
    maxPerPattern: envInteger('EVENTS_MAX_LISTENERS_PER_PATTERN'),
    maxAny: envInteger('EVENTS_MAX_ANY_LISTENERS'),
    planCacheMax: envInteger('EVENTS_PLAN_CACHE'),
  });
  const deferred = compactObject({
    maxItems: envInteger('EVENTS_DEFERRED_MAX_ITEMS'),
    maxBytes: envInteger('EVENTS_DEFERRED_MAX_BYTES'),
    maxInFlight: envInteger('EVENTS_DEFERRED_CONCURRENCY'),
    budgetMs: envInteger('EVENTS_DEFERRED_BUDGET_MS'),
    maxPerSlice: envInteger('EVENTS_DEFERRED_MAX_PER_SLICE'),
    overflow: envString('EVENTS_DEFERRED_OVERFLOW'),
  });
  const metrics = compactObject({
    enabled: envBoolean('EVENTS_METRICS'),
    prefix: envString('EVENTS_METRICS_PREFIX'),
    maxSeries: envInteger('EVENTS_METRICS_SERIES'),
    slowMs: envInteger('EVENTS_SLOW_MS'),
  });
  const diagnostics = compactObject({
    enabled: envBoolean('EVENTS_DIAGNOSTICS'),
    historyLimit: envInteger('EVENTS_DIAGNOSTICS_HISTORY'),
    maxHistoryBytes: envInteger('EVENTS_DIAGNOSTICS_BYTES'),
    publishChannel: envBoolean('EVENTS_DIAGNOSTICS_CHANNEL'),
  });
  const security = compactObject({
    strictNames: envBoolean('EVENTS_STRICT_NAMES'),
    maxEventNameBytes: envInteger('EVENTS_MAX_NAME_BYTES'),
    maxSegments: envInteger('EVENTS_MAX_SEGMENTS'),
    maxPatternBytes: envInteger('EVENTS_MAX_PATTERN_BYTES'),
    maxDispatchPayloadBytes: envInteger('EVENTS_MAX_PAYLOAD_BYTES'),
    maxContextBytes: envInteger('EVENTS_MAX_CONTEXT_BYTES'),
    blockControlChars: envBoolean('EVENTS_BLOCK_CONTROL_CHARS'),
  });
  const lifecycle = compactObject({
    shutdownTimeoutMs: envInteger('EVENTS_SHUTDOWN_TIMEOUT_MS'),
    forceOnTimeout: envBoolean('EVENTS_FORCE_SHUTDOWN_TIMEOUT'),
  });

  return merge(raw, compactObject({
    profile,
    normalizeDot: envBoolean('EVENTS_NORMALIZE_DOT'),
    logEvents: envBoolean('EVENTS_LOG'),
    listeners,
    history,
    deferred,
    metrics,
    diagnostics,
    security,
    lifecycle,
    contracts: compactObject({ autoValidate: envBoolean('EVENTS_CONTRACT_AUTO_VALIDATE') }),
  }));
}

export function normalizeEventsProviderSettings(config) {
  const environment = String(envString('APP_ENV') || envString('NODE_ENV') || 'development').toLowerCase();
  const production = environment === 'production';
  const testing = environment === 'test';

  const appEvents = configGet(config, 'app.events', {}) || {};
  const rootEvents = configGet(config, 'events', {}) || {};
  const root = merge(isPlainObject(appEvents) ? appEvents : {}, isPlainObject(rootEvents) ? rootEvents : {});
  const provider = merge(root.provider || {});
  const profile = normalizeProfile(firstDefined(envString('EVENTS_PROFILE'), root.profile, root.bus?.profile, provider.profile), production);
  const appBus = extractBusOptions(appEvents);
  const rootBus = extractBusOptions(rootEvents);
  const requestedBus = applyBusEnvironment(merge(appBus, rootBus), profile);
  const bus = new EventConfiguration({ ...requestedBus, profile }).value;

  const bridgeRedis = merge(root.bridge?.redis || {}, compactObject({
    enabled: envBoolean('EVENTS_REDIS'),
    required: envBoolean('EVENTS_REDIS_REQUIRED'),
    channel: envString('EVENTS_REDIS_CHANNEL'),
    namespace: envString('EVENTS_REDIS_NAMESPACE'),
    nodeId: envString('NODE_ID'),
    allow: envList('EVENTS_REDIS_ALLOW'),
    deny: envList('EVENTS_REDIS_DENY'),
    connectTimeoutMs: envInteger('EVENTS_REDIS_CONNECT_TIMEOUT_MS'),
    publishTimeoutMs: envInteger('EVENTS_REDIS_PUBLISH_TIMEOUT_MS'),
    allowInTests: envBoolean('EVENTS_REDIS_IN_TESTS'),
    limits: compactObject({
      maxPacketBytes: envInteger('EVENTS_REDIS_PACKET_BYTES'),
      maxEventNameBytes: envInteger('EVENTS_REDIS_NAME_BYTES'),
      maxArgs: envInteger('EVENTS_REDIS_MAX_ARGS'),
    }),
    queue: compactObject({
      maxItems: envInteger('EVENTS_REDIS_QUEUE_ITEMS'),
      maxBytes: envInteger('EVENTS_REDIS_QUEUE_BYTES'),
      overflow: envString('EVENTS_REDIS_OVERFLOW'),
      maxAttempts: envInteger('EVENTS_REDIS_QUEUE_ATTEMPTS'),
      retryDelayMs: envInteger('EVENTS_REDIS_RETRY_DELAY_MS'),
    }),
    seen: compactObject({
      maxItems: envInteger('EVENTS_REDIS_SEEN_ITEMS'),
      ttlMs: envInteger('EVENTS_REDIS_SEEN_TTL_MS'),
    }),
    circuit: compactObject({
      failureThreshold: envInteger('EVENTS_REDIS_CIRCUIT_THRESHOLD'),
      openMs: envInteger('EVENTS_REDIS_CIRCUIT_OPEN_MS'),
    }),
    protocol: compactObject({
      publishVersion: envInteger('EVENTS_REDIS_PROTOCOL_VERSION'),
      secret: envString('EVENTS_REDIS_SECRET'),
      acceptUnsignedV1: envBoolean('EVENTS_REDIS_ACCEPT_UNSIGNED_V1'),
      ttlMs: envInteger('EVENTS_REDIS_TTL_MS'),
      maxHops: envInteger('EVENTS_REDIS_MAX_HOPS'),
      maxClockSkewMs: envInteger('EVENTS_REDIS_CLOCK_SKEW_MS'),
    }),
  }));

  const broadcasting = merge(root.broadcasting || root.broadcast || {}, compactObject({
    enabled: envBoolean('EVENTS_BROADCASTING'),
    required: envBoolean('EVENTS_BROADCAST_REQUIRED'),
    auto: envBoolean('EVENTS_BROADCAST_AUTO'),
    listen: envBoolean('EVENTS_BROADCAST_LISTEN'),
    errorPolicy: envString('EVENTS_BROADCAST_ERROR_POLICY'),
    defaultChannel: envString('EVENTS_BROADCAST_CHANNEL'),
  }));

  const durable = merge(root.durable || {}, compactObject({
    enabled: envBoolean('EVENTS_DURABLE'),
    required: envBoolean('EVENTS_DURABLE_REQUIRED'),
    autoStart: envBoolean('EVENTS_DURABLE_AUTO_START'),
    storeBinding: envString('EVENTS_OUTBOX_STORE_BINDING'),
    transportBinding: envString('EVENTS_DURABLE_TRANSPORT_BINDING'),
    drainOnShutdown: envBoolean('EVENTS_OUTBOX_DRAIN_ON_SHUTDOWN'),
    allowMemoryInProduction: envBoolean('EVENTS_OUTBOX_ALLOW_MEMORY_PRODUCTION'),
    maxAttempts: envInteger('EVENTS_DURABLE_ATTEMPTS'),
    memory: compactObject({
      maxItems: envInteger('EVENTS_OUTBOX_ITEMS'),
      maxBytes: envInteger('EVENTS_OUTBOX_BYTES'),
      overflow: envString('EVENTS_OUTBOX_OVERFLOW'),
    }),
    publisher: compactObject({
      batchSize: envInteger('EVENTS_OUTBOX_BATCH'),
      concurrency: envInteger('EVENTS_OUTBOX_CONCURRENCY'),
      leaseMs: envInteger('EVENTS_OUTBOX_LEASE_MS'),
      pollMs: envInteger('EVENTS_OUTBOX_POLL_MS'),
      retryBaseMs: envInteger('EVENTS_OUTBOX_RETRY_BASE_MS'),
      retryMaxMs: envInteger('EVENTS_OUTBOX_RETRY_MAX_MS'),
    }),
  }));

  const queue = merge(root.queue || {}, compactObject({
    enabled: envBoolean('EVENTS_QUEUE'),
    required: envBoolean('EVENTS_QUEUE_REQUIRED'),
    maxItems: envInteger('EVENTS_QUEUE_ITEMS'),
    maxBytes: envInteger('EVENTS_QUEUE_BYTES'),
    concurrency: envInteger('EVENTS_QUEUE_CONCURRENCY'),
    attempts: envInteger('EVENTS_QUEUE_ATTEMPTS'),
    retryBaseMs: envInteger('EVENTS_QUEUE_RETRY_BASE_MS'),
    retryMaxMs: envInteger('EVENTS_QUEUE_RETRY_MAX_MS'),
    overflow: envString('EVENTS_QUEUE_OVERFLOW'),
    shutdownTimeoutMs: envInteger('EVENTS_QUEUE_SHUTDOWN_TIMEOUT_MS'),
  }));

  const scheduler = merge(root.scheduler || {}, compactObject({
    enabled: envBoolean('EVENTS_SCHEDULER'),
    required: envBoolean('EVENTS_SCHEDULER_REQUIRED'),
    queue: envBoolean('EVENTS_SCHEDULER_USE_QUEUE'),
  }));

  const workflows = merge(root.workflows || {}, compactObject({
    enabled: envBoolean('EVENTS_WORKFLOWS'),
    required: envBoolean('EVENTS_WORKFLOWS_REQUIRED'),
    storeBinding: envString('EVENTS_WORKFLOW_STORE_BINDING'),
    maxDefinitions: envInteger('EVENTS_WORKFLOW_DEFINITIONS'),
    maxSteps: envInteger('EVENTS_WORKFLOW_STEPS'),
    memory: compactObject({ maxItems: envInteger('EVENTS_WORKFLOW_ITEMS') }),
  }));

  const sourcing = merge(root.sourcing || {}, compactObject({
    enabled: envBoolean('EVENTS_SOURCING'),
    required: envBoolean('EVENTS_SOURCING_REQUIRED'),
    storeBinding: envString('EVENTS_STORE_BINDING'),
    checkpointBinding: envString('EVENTS_PROJECTION_CHECKPOINT_BINDING'),
    memory: compactObject({
      maxStreams: envInteger('EVENTS_STORE_STREAMS'),
      maxEvents: envInteger('EVENTS_STORE_EVENTS'),
      maxBytes: envInteger('EVENTS_STORE_BYTES'),
      maxEventBytes: envInteger('EVENTS_STORE_EVENT_BYTES'),
    }),
    projections: compactObject({
      enabled: envBoolean('EVENTS_PROJECTIONS'),
      maxProjections: envInteger('EVENTS_PROJECTION_MAX'),
      batchSize: envInteger('EVENTS_PROJECTION_BATCH'),
      budgetMs: envInteger('EVENTS_PROJECTION_BUDGET_MS'),
    }),
  }));

  const lifecycle = merge(root.lifecycle || {}, compactObject({
    enabled: envBoolean('EVENTS_CONTAINER_LIFECYCLE'),
    includeEventBindings: envBoolean('EVENTS_CONTAINER_INCLUDE_EVENT_BINDINGS'),
    exclude: envList('EVENTS_CONTAINER_EXCLUDE'),
  }));

  const health = merge(root.health || {}, compactObject({
    register: envBoolean('EVENTS_HEALTH_REGISTER'),
    required: envBoolean('EVENTS_HEALTH_REQUIRED'),
    binding: envString('EVENTS_HEALTH_BINDING'),
    name: envString('EVENTS_HEALTH_NAME'),
    critical: envBoolean('EVENTS_HEALTH_CRITICAL'),
    timeoutMs: envInteger('EVENTS_HEALTH_TIMEOUT_MS'),
  }));

  const fabric = merge(root.universal || {}, root.fabric || {}, compactObject({
    enabled: envBoolean('EVENTS_FABRIC_ENABLED'),
    autoStart: envBoolean('EVENTS_FABRIC_AUTO_START'),
    exposeGlobal: envBoolean('EVENTS_FABRIC_GLOBAL'),
    nodeId: envString('EVENTS_NODE_ID') || envString('NODE_ID'),
    application: envString('EVENTS_APPLICATION') || envString('APP_NAME'),
    defaultTransport: envString('EVENTS_DEFAULT_TRANSPORT'),
  }));
  const transports = merge(root.transports || {}, compactObject({
    redisPubSub: compactObject({ enabled: envBoolean('EVENTS_TRANSPORT_REDIS_PUBSUB'), channel: envString('EVENTS_TRANSPORT_REDIS_CHANNEL') }),
    redisStreams: compactObject({ enabled: envBoolean('EVENTS_TRANSPORT_REDIS_STREAMS'), stream: envString('EVENTS_TRANSPORT_REDIS_STREAM') }),
    websocket: compactObject({ enabled: envBoolean('EVENTS_TRANSPORT_WS') }),
    tcp: compactObject({ enabled: envBoolean('EVENTS_TRANSPORT_TCP') }),
    udp: compactObject({ enabled: envBoolean('EVENTS_TRANSPORT_UDP') }),
    ipc: compactObject({ enabled: envBoolean('EVENTS_TRANSPORT_IPC') }),
  }));
  const persistence = merge(root.persistence || {}, compactObject({
    driver: envString('EVENTS_PERSISTENCE_DRIVER'),
    database: envString('EVENTS_PERSISTENCE_DATABASE'),
    requireTransactions: envBoolean('EVENTS_PERSISTENCE_REQUIRE_TRANSACTIONS'),
    rawmongoBinding: envString('EVENTS_RAWMONGO_BINDING'),
  }));
  const studio = merge(root.studio || {}, compactObject({
    enabled: envBoolean('EVENTS_STUDIO_ENABLED'),
    readOnly: envBoolean('EVENTS_STUDIO_READ_ONLY'),
    historyLimit: envInteger('EVENTS_STUDIO_HISTORY'),
  }));
  const security = merge(root.security || {}, compactObject({
    secret: envString('EVENTS_FABRIC_SECRET'),
    keyId: envString('EVENTS_FABRIC_KEY_ID'),
  }));

  const settings = {
    enabled: envBoolean('EVENTS_ENABLED') ?? parseBoolean(firstDefined(provider.enabled, root.enabled), true),
    environment,
    production,
    testing,
    hardened: production || ['enterprise', 'production', 'strict'].includes(bus.profile),
    profile: bus.profile,
    requestedProfile: profile,
    global: envBoolean('EVENTS_GLOBAL') ?? parseBoolean(firstDefined(provider.global, root.global), true),
    globalKey: String(firstDefined(envString('EVENTS_GLOBAL_KEY'), provider.globalKey, root.globalKey, 'events')),
    failFast: envBoolean('EVENTS_FAIL_FAST') ?? parseBoolean(firstDefined(provider.failFast, root.failFast), production),
    strictConfig: envBoolean('EVENTS_STRICT_CONFIG') ?? parseBoolean(firstDefined(provider.strictConfig, root.strictConfig), production),
    bootSummary: envBoolean('EVENTS_BOOT_SUMMARY') ?? parseBoolean(firstDefined(provider.bootSummary, root.bootSummary), true),
    healthCheckOnBoot: envBoolean('EVENTS_HEALTH_CHECK_ON_BOOT') ?? parseBoolean(firstDefined(provider.healthCheckOnBoot, root.healthCheckOnBoot), production),
    doctorOnBoot: envBoolean('EVENTS_DOCTOR_ON_BOOT') ?? parseBoolean(firstDefined(provider.doctorOnBoot, root.doctorOnBoot), false),
    doctorFailFast: envBoolean('EVENTS_DOCTOR_FAIL_FAST') ?? parseBoolean(firstDefined(provider.doctorFailFast, root.doctorFailFast), production),
    registerCommands: envBoolean('EVENTS_REGISTER_COMMANDS') ?? parseBoolean(firstDefined(provider.registerCommands, root.registerCommands), true),
    registerAliases: envBoolean('EVENTS_REGISTER_ALIASES') ?? parseBoolean(firstDefined(provider.registerAliases, root.registerAliases), true),
    dynamicRegistration: envBoolean('EVENTS_DYNAMIC_REGISTRATION') ?? parseBoolean(firstDefined(provider.dynamicRegistration, root.dynamicRegistration), true),
    freezeListeners: envBoolean('EVENTS_FREEZE_LISTENERS') ?? parseBoolean(firstDefined(provider.freezeListeners, root.freezeListeners), false),
    rollbackOnBootFailure: envBoolean('EVENTS_ROLLBACK_ON_BOOT_FAILURE') ?? parseBoolean(firstDefined(provider.rollbackOnBootFailure, root.rollbackOnBootFailure), true),
    readyTimeoutMs: parseInteger(firstDefined(envInteger('EVENTS_READY_TIMEOUT_MS'), provider.readyTimeoutMs, root.readyTimeoutMs), 15_000, 1),
    shutdownTimeoutMs: parseInteger(firstDefined(envInteger('EVENTS_SHUTDOWN_TIMEOUT_MS'), provider.shutdownTimeoutMs, root.shutdownTimeoutMs, bus.lifecycle?.shutdownTimeoutMs), 30_000, 0),
    closeTimeoutMs: parseInteger(firstDefined(envInteger('EVENTS_PROVIDER_CLOSE_TIMEOUT_MS'), provider.closeTimeoutMs, root.closeTimeoutMs), 35_000, 1),
    duplicateListeners: String(firstDefined(envString('EVENTS_DUPLICATE_LISTENERS'), provider.duplicateListeners, root.duplicateListeners, 'allow')).toLowerCase(),
    closeListenerInstances: envBoolean('EVENTS_CLOSE_LISTENER_INSTANCES') ?? parseBoolean(firstDefined(provider.closeListenerInstances, root.closeListenerInstances), true),
    closeExternalDispatcher: envBoolean('EVENTS_CLOSE_EXTERNAL_DISPATCHER') ?? parseBoolean(firstDefined(provider.closeExternalDispatcher, root.closeExternalDispatcher), false),
    closeExternalSubsystems: envBoolean('EVENTS_CLOSE_EXTERNAL_SUBSYSTEMS') ?? parseBoolean(firstDefined(provider.closeExternalSubsystems, root.closeExternalSubsystems), false),
    bus,
    listeners: configurationListenerMap(root),
    subscribers: Array.isArray(root.subscribers) ? root.subscribers.slice() : [],
    contracts: merge(root.contracts || {}),
    codecs: merge(root.codecs || {}),
    lifecycle,
    bridge: { redis: bridgeRedis },
    broadcasting,
    durable,
    queue,
    scheduler,
    workflows,
    sourcing,
    health,
    fabric,
    transports,
    persistence,
    studio,
    security,
    bindings: merge(root.bindings || {}),
  };

  if (!['allow', 'skip', 'error'].includes(settings.duplicateListeners)) {
    throw providerError(
      `Invalid EVENTS_DUPLICATE_LISTENERS policy: ${settings.duplicateListeners}`,
      'EVENTS_PROVIDER_DUPLICATE_POLICY',
    );
  }
  if (!settings.globalKey || ['__proto__', 'prototype', 'constructor'].includes(settings.globalKey)) {
    throw providerError('EVENTS_GLOBAL_KEY must be a non-empty safe global property name', 'EVENTS_PROVIDER_GLOBAL_KEY');
  }
  for (const [name, section] of [
    ['bridge.redis', settings.bridge.redis],
    ['broadcasting', settings.broadcasting],
    ['durable', settings.durable],
    ['queue', settings.queue],
    ['scheduler', settings.scheduler],
    ['workflows', settings.workflows],
    ['sourcing', settings.sourcing],
  ]) {
    if (section?.required === true && section?.enabled !== true) {
      throw providerError(
        `Events subsystem [${name}] is required but disabled`,
        'EVENTS_PROVIDER_REQUIRED_DISABLED',
        { subsystem: name },
      );
    }
  }

  return freezeConfiguration(settings);
}

function publicSettings(settings) {
  return freezePublic(cloneForPublic(settings));
}

/* -------------------------------------------------------------------------- */
/* Provider status command                                                    */
/* -------------------------------------------------------------------------- */

export class EventsProviderStatusCommand {
  constructor(app) {
    this.app = app;
    this.signature = 'events:provider:status';
    this.description = 'Inspect the RawNode Events provider lifecycle, registration report, health, and bindings.';
  }

  async handle(options = {}) {
    const manager = safeResolve(this.app, 'events.manager');
    if (!manager) return { ok: false, state: 'missing', reason: 'events-manager-unavailable' };
    return options.doctor === true ? manager.doctor() : manager.snapshot();
  }
}

/* -------------------------------------------------------------------------- */
/* Manager                                                                    */
/* -------------------------------------------------------------------------- */

export class RawNodeEventsManager {
  constructor(app, logger, settings) {
    this.app = app;
    this.logger = logger || console;
    this.settings = settings;

    this.state = settings.enabled ? 'registered' : 'disabled';
    this.registeredAt = Date.now();
    this.bootStartedAt = null;
    this.readyAt = null;
    this.closedAt = null;
    this.lastError = null;
    this.lastHealth = null;
    this.lastDoctor = null;
    this.registrationReport = this._newReport();

    this._events = null;
    this._schemas = null;
    this._codecs = null;
    this._bridge = null;
    this._broadcast = null;
    this._outboxStore = null;
    this._outbox = null;
    this._outboxPublisher = null;
    this._queue = null;
    this._scheduler = null;
    this._workflowStore = null;
    this._workflows = null;
    this._eventStore = null;
    this._projectionCheckpoints = null;
    this._projections = null;
    this._fabric = null;
    this._inbox = null;
    this._jobStore = null;
    this._durableWorker = null;
    this._studio = null;
    this._studioServer = null;

    this._scope = null;
    this._listenerInstances = new Map();
    this._ownedListenerInstances = new Set();
    this._lifecycleCleanups = [];
    this._definitionCleanups = [];
    this._registrationSignatures = new Set();
    this._listenerIdentityIds = new WeakMap();
    this._listenerIdentitySequence = 0;
    this._ownedBindings = new Set();
    this._healthCleanup = null;
    this._bootPromise = null;
    this._closePromise = null;
    this._globalInstalled = false;
    this._previousGlobal = MISSING;
    this._forwardingContainerLifecycle = false;
    this._backgroundSuppressed = false;
  }

  markOwnedBinding(key, owned = true) {
    const name = String(key);
    if (owned) this._ownedBindings.add(name);
    else this._ownedBindings.delete(name);
    return this;
  }

  ownsBinding(key) {
    return this._ownedBindings.has(String(key));
  }

  _shouldCloseBinding(key) {
    return this.ownsBinding(key) || this.settings.closeExternalSubsystems === true;
  }

  _newReport() {
    return {
      provider: 'EventsServiceProvider',
      profile: this.settings?.profile || null,
      state: this.state || 'registered',
      startedAt: null,
      completedAt: null,
      durationMs: 0,
      loaded: [],
      skipped: [],
      failed: [],
      subscribers: [],
      contracts: [],
      codecs: [],
      broadcasts: [],
      queueHandlers: [],
      workflows: [],
      projections: [],
      schedules: [],
      subsystems: [],
      bridge: { enabled: false, started: false, skipped: false, reason: null, state: null },
      health: null,
      warnings: [],
    };
  }

  schemas() {
    if (!this._schemas) this._schemas = new EventSchemaRegistry(this.settings.contracts || {});
    return this._schemas;
  }

  codecs() {
    if (!this._codecs) this._codecs = new EventCodecRegistry(this.settings.codecs || {});
    return this._codecs;
  }

  dispatcher() {
    if (this._events) return this._events;
    const schemas = safeResolve(this.app, 'events.schemas', null) || this.schemas();
    const codecs = safeResolve(this.app, 'events.codecs', null) || this.codecs();
    this._events = new AdvancedEventDispatcher({
      ...this.settings.bus,
      logger: this.logger,
      schemaRegistry: schemas,
      codecRegistry: codecs,
      health: this.settings.health || {},
    });
    this._installGlobal(this._events);
    return this._events;
  }

  bridge() {
    if (!this._bridge) {
      this._bridge = new RedisEventBridge(this.app, {
        ...this.settings.bridge.redis,
        dispatcher: this._events || safeResolve(this.app, 'events', null),
        logger: this.logger,
      });
    }
    return this._bridge;
  }

  broadcastManager() {
    if (!this._broadcast) {
      this._broadcast = new BroadcastManager(this._events || safeResolve(this.app, 'events', null), this.settings.broadcasting || {});
    }
    return this._broadcast;
  }

  outboxStore() {
    if (this._outboxStore) return this._outboxStore;
    const alternate = this.settings.durable?.storeBinding;
    if (alternate && alternate !== 'events.outbox.store') {
      const resolved = safeResolve(this.app, alternate, null);
      if (resolved) return (this._outboxStore = resolved);
    }
    const source = this._rawMongoSource();
    if (source && this._useRawMongo(this.settings.durable)) {
      this._outboxStore = new RawMongoOutboxStore(source, {
        ...(this.settings.durable || {}),
        ...(this.settings.persistence || {}),
        ...(this.settings.persistence?.outbox || {}),
      });
      return this._outboxStore;
    }
    this._outboxStore = new MemoryOutboxStore(this.settings.durable?.memory || this.settings.durable || {});
    return this._outboxStore;
  }

  outbox() {
    if (!this._outbox) {
      this._outbox = new EventOutbox({
        ...(this.settings.durable || {}),
        store: safeResolve(this.app, 'events.outbox.store', null) || this.outboxStore(),
        dispatcher: this._events || safeResolve(this.app, 'events', null),
        schemaRegistry: safeResolve(this.app, 'events.schemas', null) || this.schemas(),
      });
    }
    return this._outbox;
  }

  outboxPublisher() {
    if (this._outboxPublisher) return this._outboxPublisher;
    const transportBinding = this.settings.durable?.transportBinding || 'events.durable.transport';
    const transport = safeResolve(this.app, transportBinding, null);
    if (!transport) return null;
    this._outboxPublisher = new OutboxPublisher(
      safeResolve(this.app, 'events.outbox.store', null) || this.outboxStore(),
      transport,
      this.settings.durable?.publisher || {},
    );
    return this._outboxPublisher;
  }

  queue() {
    if (this._queue) return this._queue;
    const queue = new EventJobQueue(this.settings.queue || {});
    queue.register('dispatch', async (payload, context) => {
      const events = this._events || safeResolve(this.app, 'events', null);
      if (!events) throw providerError('Events dispatcher is unavailable', 'EVENTS_PROVIDER_DISPATCHER_MISSING');
      const inheritedContext = payload?.context || context?.context || null;
      return events.run(inheritedContext, () => events.dispatchAsync(payload.eventName, ...(payload.args || [])));
    });
    this._queue = queue;
    return queue;
  }

  scheduler() {
    if (!this._scheduler) {
      this._scheduler = new EventScheduler({
        ...(this.settings.scheduler || {}),
        dispatcher: this._events || safeResolve(this.app, 'events', null),
        queue: this.settings.scheduler?.queue === true
          ? (safeResolve(this.app, 'events.queue', null) || this.queue())
          : null,
      });
    }
    return this._scheduler;
  }

  workflowStore() {
    if (this._workflowStore) return this._workflowStore;
    const alternate = this.settings.workflows?.storeBinding;
    if (alternate && alternate !== 'events.workflows.store') {
      const resolved = safeResolve(this.app, alternate, null);
      if (resolved) return (this._workflowStore = resolved);
    }
    const source = this._rawMongoSource();
    if (source && this._useRawMongo(this.settings.workflows)) {
      this._workflowStore = new RawMongoWorkflowStore(source, {
        ...(this.settings.workflows || {}),
        ...(this.settings.persistence || {}),
        ...(this.settings.persistence?.workflows || {}),
      });
      return this._workflowStore;
    }
    this._workflowStore = new MemoryWorkflowStore(this.settings.workflows?.memory || {});
    return this._workflowStore;
  }

  workflows() {
    if (!this._workflows) {
      this._workflows = new WorkflowEngine({
        ...(this.settings.workflows || {}),
        dispatcher: this._events || safeResolve(this.app, 'events', null),
        store: safeResolve(this.app, 'events.workflows.store', null) || this.workflowStore(),
      });
    }
    return this._workflows;
  }

  eventStore() {
    if (this._eventStore) return this._eventStore;
    const alternate = this.settings.sourcing?.storeBinding;
    if (alternate && alternate !== 'events.store') {
      const resolved = safeResolve(this.app, alternate, null);
      if (resolved) return (this._eventStore = resolved);
    }
    const source = this._rawMongoSource();
    if (source && this._useRawMongo(this.settings.sourcing)) {
      this._eventStore = new RawMongoEventStore(source, {
        ...(this.settings.sourcing || {}),
        ...(this.settings.persistence || {}),
        ...(this.settings.persistence?.eventStore || {}),
      });
      return this._eventStore;
    }
    this._eventStore = new MemoryEventStore(this.settings.sourcing?.memory || this.settings.sourcing || {});
    return this._eventStore;
  }

  projectionCheckpoints() {
    if (this._projectionCheckpoints) return this._projectionCheckpoints;
    const alternate = this.settings.sourcing?.checkpointBinding;
    if (alternate && alternate !== 'events.projections.checkpoints') {
      const resolved = safeResolve(this.app, alternate, null);
      if (resolved) return (this._projectionCheckpoints = resolved);
    }
    const source = this._rawMongoSource();
    if (source && this._useRawMongo(this.settings.sourcing)) {
      this._projectionCheckpoints = new RawMongoProjectionCheckpointStore(source, {
        ...(this.settings.sourcing?.projections || {}),
        ...(this.settings.persistence || {}),
        ...(this.settings.persistence?.projections || {}),
      });
      return this._projectionCheckpoints;
    }
    this._projectionCheckpoints = new MemoryProjectionCheckpointStore();
    return this._projectionCheckpoints;
  }

  projections() {
    if (!this._projections) {
      this._projections = new ProjectionManager(
        safeResolve(this.app, 'events.store', null) || this.eventStore(),
        {
          ...(this.settings.sourcing?.projections || {}),
          checkpoints: safeResolve(this.app, 'events.projections.checkpoints', null) || this.projectionCheckpoints(),
        },
      );
    }
    return this._projections;
  }

  _resolveBinding(...names) {
    for (const name of names.flat().filter(Boolean)) {
      const resolved = safeResolve(this.app, name, null);
      if (resolved != null) return resolved;
    }
    return null;
  }

  _rawMongoSource() {
    const configured = this.settings.persistence?.rawmongoBinding
      || this.settings.bindings?.rawmongo
      || this.settings.bindings?.database;
    return this._resolveBinding(
      configured,
      'rawmongo',
      'database',
      'db',
      'mongo',
      'database.connection',
    );
  }

  _useRawMongo(section = null) {
    const configured = String(
      section?.driver
      || this.settings.persistence?.driver
      || 'memory',
    ).trim().toLowerCase();
    if (configured === 'rawmongo' || configured === 'mongo' || configured === 'database') return true;
    if (configured === 'auto') return !!this._rawMongoSource();
    return false;
  }

  inbox() {
    if (this._inbox) return this._inbox;
    const alternate = this.settings.persistence?.inboxBinding;
    if (alternate && alternate !== 'events.inbox') {
      const resolved = safeResolve(this.app, alternate, null);
      if (resolved) return (this._inbox = resolved);
    }
    const source = this._rawMongoSource();
    if (source && this._useRawMongo(this.settings.persistence?.inbox)) {
      this._inbox = new RawMongoEventInbox(source, {
        ...(this.settings.persistence || {}),
        ...(this.settings.persistence?.inbox || {}),
      });
      return this._inbox;
    }
    return null;
  }

  jobStore() {
    if (this._jobStore) return this._jobStore;
    const alternate = this.settings.persistence?.jobsBinding || this.settings.queue?.storeBinding;
    if (alternate && alternate !== 'events.jobs.store') {
      const resolved = safeResolve(this.app, alternate, null);
      if (resolved) return (this._jobStore = resolved);
    }
    const source = this._rawMongoSource();
    if (source && this._useRawMongo(this.settings.persistence?.jobs || this.settings.queue)) {
      this._jobStore = new RawMongoJobStore(source, {
        ...(this.settings.queue || {}),
        ...(this.settings.persistence || {}),
        ...(this.settings.persistence?.jobs || {}),
      });
      return this._jobStore;
    }
    return null;
  }

  durableWorker() {
    if (this._durableWorker) return this._durableWorker;
    const store = safeResolve(this.app, 'events.jobs.store', null) || this.jobStore();
    if (!store) return null;
    const worker = new DurableEventWorker(store, {
      ...(this.settings.queue?.worker || {}),
      concurrency: this.settings.queue?.worker?.concurrency || this.settings.queue?.concurrency,
    });
    worker.register('dispatch', async (payload, context) => {
      const events = this._events || safeResolve(this.app, 'events', null);
      if (!events) throw providerError('Events dispatcher is unavailable', 'EVENTS_PROVIDER_DISPATCHER_MISSING');
      const inheritedContext = payload?.context || context?.job?.context || null;
      return events.run(inheritedContext, () => events.dispatchAsync(payload.eventName, ...(payload.args || [])));
    });
    this._durableWorker = worker;
    return worker;
  }

  studio() {
    if (this._studio) return this._studio;
    this._studio = new EventStudioManager({
      app: this.app,
      manager: this,
      fabric: this._fabric || null,
      readOnly: this.settings.studio?.readOnly !== false,
      allowMutations: this.settings.studio?.mutations === true,
      historyLimit: this.settings.studio?.historyLimit,
      authorize: this._resolveBinding(this.settings.studio?.authorizeBinding, 'events.studio.authorizer'),
      audit: this._resolveBinding(this.settings.studio?.auditBinding, 'security.audit'),
    });
    return this._studio;
  }

  studioServer() {
    if (this._studioServer) return this._studioServer;
    const options = this.settings.studio?.server || {};
    this._studioServer = new EventStudioServer({
      studio: safeResolve(this.app, 'events.studio', null) || this.studio(),
      host: options.host,
      port: options.port,
      token: options.token,
      maxBodyBytes: options.maxBodyBytes,
    });
    return this._studioServer;
  }

  fabric() {
    if (this._fabric) return this._fabric;
    const configuration = this.settings.fabric || {};
    const transports = this.settings.transports || {};
    const redisPubSub = transports.redisPubSub || transports.redis || {};
    const redisStreams = transports.redisStreams || {};
    const redisEnabled = redisPubSub.enabled === true || redisStreams.enabled === true;
    const websocketOptions = transports.websocket || transports.ws || {};
    const tcpOptions = transports.tcp || {};
    const udpOptions = transports.udp || {};
    const ipcOptions = transports.ipc || {};

    const dispatcher = this._events || safeResolve(this.app, 'events', null) || this.dispatcher();
    const fabric = new NodeEventFabric({
      dispatcher,
      profile: configuration.profile || this.settings.profile,
      compatibilityOverrides: configuration.compatibilityOverrides,
      application: configuration.application || this.settings.bindings?.application || process.env.APP_NAME || null,
      nodeId: configuration.nodeId || process.env.RAWNODE_NODE_ID || process.env.NODE_ID || null,
      exposeGlobal: configuration.exposeGlobal === true,
      globalKey: configuration.globalKey || this.settings.globalKey,
      defaultTransport: configuration.defaultTransport,
      definitions: configuration.definitions || this.settings.contracts?.fabric,
      eventDefinitions: configuration.eventDefinitions,
      resourceGovernor: configuration.resources || this.settings.persistence?.resources,
      metrics: configuration.metrics,
      flightRecorder: configuration.flightRecorder || this.settings.studio?.flightRecorder,
      middlewareOptions: configuration.middleware,
      authorization: configuration.authorization,
      authenticator: this._resolveBinding(configuration.authenticatorBinding, 'events.authenticator'),
      tenantResolver: this._resolveBinding(configuration.tenantResolverBinding, 'tenant.resolver', 'tenancy.resolver'),
      security: {
        ...(this.settings.security || {}),
        ...(configuration.security || {}),
      },
      queue: this.settings.queue?.enabled === true
        ? (safeResolve(this.app, 'events.queue', null) || this.queue())
        : null,
      outbox: this.settings.durable?.enabled === true
        ? (safeResolve(this.app, 'events.outbox', null) || this.outbox())
        : null,
      eventStore: this.settings.sourcing?.enabled === true
        ? (safeResolve(this.app, 'events.store', null) || this.eventStore())
        : null,
      redis: redisEnabled
        ? this._resolveBinding(
            transports.redisBinding,
            this.settings.bindings?.redis,
            'redis',
            'redis.client',
          )
        : null,
      redisPubSub: redisPubSub.enabled === true ? redisPubSub : false,
      redisStreams: redisStreams.enabled === true ? redisStreams : false,
      websocket: websocketOptions.enabled === true
        ? this._resolveBinding(
            websocketOptions.binding,
            this.settings.bindings?.websocket,
            'ws',
            'websocket',
            'websocket.server',
          )
        : null,
      websocketTransport: websocketOptions,
      tcp: tcpOptions.enabled === true
        ? this._resolveBinding(tcpOptions.binding, this.settings.bindings?.tcp, 'tcp', 'tcp.server')
        : null,
      tcpTransport: tcpOptions,
      udp: udpOptions.enabled === true
        ? this._resolveBinding(udpOptions.binding, this.settings.bindings?.udp, 'udp', 'udp.server')
        : null,
      udpTransport: udpOptions,
      ipc: ipcOptions.enabled === true ? (ipcOptions.endpoint || true) : false,
      routerOptions: configuration.router,
      requestOptions: configuration.requests,
      seen: configuration.seen,
    });

    this._fabric = fabric;
    return fabric;
  }

  boot(context = {}) {
    if (this.state === 'ready' || this.state === 'degraded' || this.state === 'disabled') {
      return Promise.resolve(this.registrationReport);
    }
    if (this.state === 'closing' || this.state === 'closed') {
      return Promise.reject(providerError(
        `RawNode Events provider cannot boot from state [${this.state}]`,
        'EVENTS_PROVIDER_CLOSED',
        { state: this.state },
      ));
    }
    if (this._bootPromise) return this._bootPromise;
    this._bootPromise = this._boot(context).finally(() => { this._bootPromise = null; });
    return this._bootPromise;
  }

  async _boot(context = {}) {
    const startBackground = context.startBackground ?? allowsBackgroundAutoStart(this.app);
    this._backgroundSuppressed = !startBackground;
    if (!this.settings.enabled) {
      this.state = 'disabled';
      //if (this.settings.bootSummary) log(this.logger, 'info', '[EventsServiceProvider] disabled by EVENTS_ENABLED=false.');
      return this.registrationReport;
    }

    const started = performance.now();
    this.state = 'booting';
    this.bootStartedAt = Date.now();
    this.registrationReport = this._newReport();
    this._registrationSignatures.clear();
    this.registrationReport.state = 'booting';
    this.registrationReport.startedAt = this.bootStartedAt;

    const events = safeResolve(this.app, 'events', null) || this.dispatcher();
    this._events = events;
    this._assertDispatcher(events);
    this._installGlobal(events);
    this._scope = typeof events.scope === 'function' ? events.scope(PROVIDER_OWNER) : null;
    safeDispatch(events, 'events:provider:booting', {
      profile: this.settings.profile,
      environment: this.settings.environment,
    }, this.logger);

    try {
      await this._registerContracts();
      await this._registerCodecs();
      await this._registerListeners();
      if (startBackground) await this._registerSubscribers();
      else this.registrationReport.skipped.push({ subsystem: 'subscribers', reason: 'console-invocation-policy' });
      this._forwardContainerLifecycle();
      await this._configureBroadcasting({ startBackground });
      await this._configureBridge({ startBackground });
      await this._configureFabric({ startBackground });
      await this._configureStudio({ startBackground });
      await this._configureDurable({ startBackground });
      if (startBackground) await this._configureEnterpriseSubsystems();
      else this.registrationReport.skipped.push({ subsystem: 'enterprise-background', reason: 'console-invocation-policy' });
      this._registerHealthCheck();

      if (this.settings.freezeListeners === true || (this.settings.production && this.settings.dynamicRegistration === false)) {
        events.freezeRegistrations?.({ contracts: true, codecs: true });
      }

      this.lastHealth = this.health();
      this.registrationReport.health = this.lastHealth;
      if (this.settings.healthCheckOnBoot && this.lastHealth.ok === false) {
        const error = providerError(
          `RawNode Events health check failed: ${this.lastHealth.reasons.join(', ') || 'unknown reason'}`,
          'EVENTS_PROVIDER_HEALTH_FAILED',
          this.lastHealth,
        );
        if (this.settings.failFast) throw error;
        this.registrationReport.warnings.push({ code: error.code, message: error.message });
      }

      if (this.settings.doctorOnBoot) {
        this.lastDoctor = await this.doctor();
        if (!this.lastDoctor.ok && this.settings.doctorFailFast) {
          throw providerError('RawNode Events doctor reported critical findings', 'EVENTS_PROVIDER_DOCTOR_FAILED', this.lastDoctor);
        }
      }

      this.state = this.health().ok ? 'ready' : 'degraded';
      this.readyAt = Date.now();
      this.registrationReport.state = this.state;
      this.registrationReport.completedAt = this.readyAt;
      this.registrationReport.durationMs = performance.now() - started;

      const readyPayload = {
        state: this.state,
        profile: this.settings.profile,
        listeners: this.registrationReport,
        bridge: this._bridge?.snapshot?.() || null,
        health: this.health(),
      };
      safeDispatch(events, 'events:ready', readyPayload, this.logger);
      safeDispatch(events, 'events:provider:ready', readyPayload, this.logger);

      if (this.settings.bootSummary) this._logBootSummary();
      return this.registrationReport;
    } catch (error) {
      this.lastError = error;
      this.state = 'failed';
      this.registrationReport.state = 'failed';
      this.registrationReport.completedAt = Date.now();
      this.registrationReport.durationMs = performance.now() - started;
      this.registrationReport.failed.push({ phase: 'provider:boot', error: safeError(error) });
      safeDispatch(events, 'events:provider:failed', {
        profile: this.settings.profile,
        error: safeError(error),
        report: this.registrationReport,
      }, this.logger);
      if (this.settings.rollbackOnBootFailure) await this._rollbackBoot();
      throw error;
    }
  }

  async close(options = {}) {
    if (this.state === 'closed') return this.snapshot();
    if (this._closePromise) return this._closePromise;
    this._closePromise = this._close(options).finally(() => { this._closePromise = null; });
    return this._closePromise;
  }

  async _close(options) {
    if (this._bootPromise) {
      try { await this._bootPromise; } catch {}
    }
    const previousState = this.state;
    this.state = 'closing';
    const events = this._events;
    if (events && previousState !== 'failed') {
      safeDispatch(events, 'events:provider:tearing-down', {
        state: previousState,
        shutdownTimeoutMs: this.settings.shutdownTimeoutMs,
      }, this.logger);
    }

    try { await this._healthCleanup?.(); } catch {}
    this._healthCleanup = null;

    for (const cleanup of this._lifecycleCleanups.splice(0).reverse()) {
      try { await cleanup(); } catch (error) { log(this.logger, 'warn', '[EventsServiceProvider] lifecycle cleanup failed:', error?.message || error); }
    }
    for (const cleanup of this._definitionCleanups.splice(0).reverse()) {
      try { await cleanup(); } catch (error) { log(this.logger, 'warn', '[EventsServiceProvider] definition cleanup failed:', error?.message || error); }
    }
    try { this._scope?.dispose?.(); } catch {}
    this._scope = null;

    if (this._studioServer && this._shouldCloseBinding('events.studio.server')) {
      try { await this._studioServer.close?.(); }
      catch (error) { log(this.logger, 'warn', '[EventsServiceProvider] Event Studio shutdown failed:', error?.message || error); }
    }

    if (this._durableWorker && this._shouldCloseBinding('events.jobs.worker')) {
      try {
        await withTimeout(
          this._durableWorker.close?.(),
          this.settings.shutdownTimeoutMs,
          'Events durable job worker shutdown',
        );
      } catch (error) {
        log(this.logger, 'warn', '[EventsServiceProvider] durable job worker shutdown failed:', error?.message || error);
      }
    }

    if (this._outboxPublisher && this._shouldCloseBinding('events.outbox.publisher')) {
      try {
        await withTimeout(
          this._outboxPublisher.close?.({ drain: options.drainOutbox ?? this.settings.durable?.drainOnShutdown === true }),
          this.settings.shutdownTimeoutMs,
          'Events outbox publisher shutdown',
        );
      } catch (error) {
        log(this.logger, 'warn', '[EventsServiceProvider] outbox publisher shutdown failed:', error?.message || error);
      }
    }

    if (this._fabric && this._shouldCloseBinding('events.fabric')) {
      try {
        await withTimeout(
          this._fabric.close?.({ closeDispatcher: false, reason: 'provider-shutdown' }),
          this.settings.shutdownTimeoutMs,
          'Universal Event Fabric shutdown',
        );
      } catch (error) {
        log(this.logger, 'warn', '[EventsServiceProvider] Universal Event Fabric shutdown failed:', error?.message || error);
      }
    }

    const closeDispatcher = this.ownsBinding('events') || this.settings.closeExternalDispatcher === true;
    if (events?.close && closeDispatcher) {
      try {
        await withTimeout(events.close({
          timeoutMs: this.settings.shutdownTimeoutMs,
          forceOnTimeout: true,
          closeBridge: this._shouldCloseBinding('events.bridge.redis'),
          closeBroadcasting: this._shouldCloseBinding('events.broadcast'),
          closeSubsystems: true,
        }), this.settings.closeTimeoutMs, 'Events dispatcher shutdown');
      } catch (error) {
        this.lastError = error;
        log(this.logger, 'warn', '[EventsServiceProvider] dispatcher shutdown failed:', error?.message || error);
        await this._closeDetachedComponents();
      }
    } else {
      this._events?.removeOwner?.(PROVIDER_OWNER);
      this._events?.removeOwner?.('events:config');
      await this._closeDetachedComponents();
    }

    if (this.settings.closeListenerInstances) await this._closeOwnedListenerInstances();
    this._restoreGlobal();
    this.state = 'closed';
    this.closedAt = Date.now();
    return this.snapshot();
  }

  async _rollbackBoot() {
    try { await this._healthCleanup?.(); } catch {}
    this._healthCleanup = null;
    for (const cleanup of this._lifecycleCleanups.splice(0).reverse()) { try { await cleanup(); } catch {} }
    for (const cleanup of this._definitionCleanups.splice(0).reverse()) { try { await cleanup(); } catch {} }
    try { this._scope?.dispose?.(); } catch {}
    this._scope = null;
    if (this._shouldCloseBinding('events.studio.server')) { try { await this._studioServer?.close?.(); } catch {} }
    if (this._shouldCloseBinding('events.jobs.worker')) { try { await this._durableWorker?.close?.(); } catch {} }
    if (this._shouldCloseBinding('events.outbox.publisher')) { try { await this._outboxPublisher?.close?.(); } catch {} }
    if (this._shouldCloseBinding('events.fabric')) { try { await this._fabric?.close?.({ closeDispatcher: false, reason: 'boot-rollback' }); } catch {} }
    if (this._shouldCloseBinding('events.broadcast')) { try { await this._broadcast?.close?.(); } catch {} }
    if (this._shouldCloseBinding('events.bridge.redis')) { try { await this._bridge?.close?.(); } catch {} }
    if (this.settings.closeListenerInstances) await this._closeOwnedListenerInstances();
    this._restoreGlobal();
  }

  async _closeDetachedComponents() {
    const components = [
      ['events.studio.server', this._studioServer],
      ['events.jobs.worker', this._durableWorker],
      ['events.fabric', this._fabric],
      ['events.scheduler', this._scheduler],
      ['events.queue', this._queue],
      ['events.workflows', this._workflows],
      ['events.store', this._eventStore],
      ['events.projections', this._projections],
      ['events.broadcast', this._broadcast],
      ['events.bridge.redis', this._bridge],
      ['events.outbox', this._outbox],
      ['events.outbox.publisher', this._outboxPublisher],
    ];
    const closed = new Set();
    for (const [binding, component] of components) {
      if (!component || closed.has(component) || !this._shouldCloseBinding(binding)) continue;
      closed.add(component);
      try {
        const operation = component.close?.() ?? component.stop?.() ?? component.dispose?.();
        if (operation && typeof operation.then === 'function') await operation;
      } catch {}
    }
  }

  _assertDispatcher(events) {
    for (const method of ['dispatch', 'dispatchAsync', 'subscribe', 'subscribePattern', 'subscribeAny', 'close']) {
      if (typeof events?.[method] !== 'function') {
        throw providerError(
          `The [events] binding does not implement ${method}()`,
          'EVENTS_PROVIDER_INVALID_DISPATCHER',
          { method },
        );
      }
    }
  }

  _installGlobal(events) {
    if (!this.settings.global || !events || this._globalInstalled) return;
    const key = this.settings.globalKey || 'events';
    this._previousGlobal = Object.prototype.hasOwnProperty.call(globalThis, key) ? globalThis[key] : MISSING;
    globalThis[key] = events;
    this._globalInstalled = true;
  }

  _restoreGlobal() {
    if (!this._globalInstalled) return;
    const key = this.settings.globalKey || 'events';
    if (globalThis[key] === this._events) {
      if (this._previousGlobal === MISSING) delete globalThis[key];
      else globalThis[key] = this._previousGlobal;
    }
    this._globalInstalled = false;
    this._previousGlobal = MISSING;
  }

  async _registerContracts() {
    const registry = safeResolve(this.app, 'events.schemas', null) || this.schemas();
    const definitions = this.settings.contracts?.definitions || this.settings.contracts?.events || {};
    for (const [eventName, rawVersions] of Object.entries(definitions || {})) {
      const versions = this._normalizeVersionDefinitions(rawVersions);
      for (const entry of versions) {
        try {
          const definition = await this._resolveDefinitionValue(entry.definition);
          registry.register(eventName, entry.version, definition, { replace: entry.replace === true });
          this.registrationReport.contracts.push({ eventName, version: entry.version });
        } catch (error) {
          this._recordFailure('contract', { eventName, version: entry.version }, error);
        }
      }
    }
  }

  _normalizeVersionDefinitions(value) {
    if (Array.isArray(value)) {
      return value.map((entry, index) => isPlainObject(entry)
        ? { version: parseInteger(entry.version, index + 1, 1), definition: entry.definition ?? entry.schema ?? entry, replace: entry.replace }
        : { version: index + 1, definition: entry });
    }
    if (isPlainObject(value) && ('version' in value || 'validate' in value || 'schema' in value || 'upcast' in value)) {
      return [{ version: parseInteger(value.version, 1, 1), definition: value.definition ?? value, replace: value.replace }];
    }
    if (isPlainObject(value)) {
      return Object.entries(value).map(([version, definition]) => ({ version: parseInteger(version, 1, 1), definition }));
    }
    return [{ version: 1, definition: value }];
  }

  async _registerCodecs() {
    const registry = safeResolve(this.app, 'events.codecs', null) || this.codecs();
    const definitions = this.settings.codecs?.definitions || this.settings.codecs?.codecs || {};
    for (const [name, raw] of Object.entries(definitions || {})) {
      try {
        const options = isPlainObject(raw) ? raw : {};
        const codec = await this._resolveDefinitionValue(options.codec ?? options.use ?? raw);
        registry.register(name, codec, { replace: options.replace === true });
        if (options.default === true) registry.use(name);
        this.registrationReport.codecs.push({ name, default: options.default === true });
      } catch (error) {
        this._recordFailure('codec', { name }, error);
      }
    }
  }

  async _registerListeners() {
    const map = this.settings.listeners || {};
    for (const [eventName, rawDefinitions] of Object.entries(map)) {
      for (const definition of normalizeDefinitionList(rawDefinitions)) {
        try {
          const resolved = await this._coerceListener(definition);
          if (resolved.skip) {
            this.registrationReport.skipped.push({ eventName, definition: this._safeDefinition(definition), reason: resolved.reason });
            continue;
          }
          if (typeof resolved.handler !== 'function') {
            const required = resolved.required === true || definition?.required === true;
            if (required || this.settings.failFast || this.settings.strictConfig) {
              throw providerError(
                `Configured listener for [${eventName}] did not resolve to a callable handler`,
                'EVENTS_PROVIDER_LISTENER_UNRESOLVABLE',
                { eventName, definition: this._safeDefinition(definition), required },
              );
            }
            this.registrationReport.skipped.push({ eventName, definition: this._safeDefinition(definition), reason: 'unresolvable' });
            continue;
          }
          const kind = listenerKind(eventName, resolved.options);
          const options = {
            owner: resolved.options.owner || 'events:config',
            ...resolved.options,
            tags: normalizeTags([...(normalizeTags(resolved.options.tags || resolved.options.tag)), `event:${eventName}`, PROVIDER_TAG]),
          };
          const signature = this._listenerSignature(eventName, resolved.identity, options);
          if (this._registrationSignatures.has(signature)) {
            if (this.settings.duplicateListeners === 'skip') {
              this.registrationReport.skipped.push({ eventName, definition: this._safeDefinition(definition), reason: 'duplicate' });
              continue;
            }
            if (this.settings.duplicateListeners === 'error') {
              throw providerError(`Duplicate configured listener for ${eventName}`, 'EVENTS_PROVIDER_LISTENER_DUPLICATE', { eventName, signature });
            }
          }
          const handle = this._subscribe(kind, eventName, resolved.handler, options);
          this._registrationSignatures.add(signature);
          this.registrationReport.loaded.push({
            eventName,
            kind,
            listenerId: handle?.id || null,
            owner: options.owner,
            priority: Number(options.priority) || 0,
            once: options.once === true,
            tags: options.tags,
          });
        } catch (error) {
          this._recordFailure('listener', { eventName, definition: this._safeDefinition(definition) }, error);
        }
      }
    }
  }

  async _registerSubscribers() {
    for (const rawDefinition of this.settings.subscribers || []) {
      try {
        const target = isPlainObject(rawDefinition)
          ? rawDefinition.subscriber ?? rawDefinition.use ?? rawDefinition.listener
          : rawDefinition;
        const Subscriber = await this._resolveDefinitionValue(target);
        if (typeof Subscriber !== 'function' && (!Subscriber || typeof Subscriber !== 'object')) {
          throw providerError('Subscriber definition did not resolve to a class or object', 'EVENTS_PROVIDER_SUBSCRIBER_INVALID');
        }
        const instance = typeof Subscriber === 'function'
          ? this._instance(Subscriber, { transient: rawDefinition?.transient === true })
          : Subscriber;
        const mapping = Subscriber?.getSubscribedEvents?.() || instance?.getSubscribedEvents?.();

        if (!mapping && typeof instance?.subscribe === 'function') {
          const cleanup = await instance.subscribe(this._events, this._scope);
          if (typeof cleanup === 'function') this._definitionCleanups.push(cleanup);
          this.registrationReport.subscribers.push({ subscriber: instance.constructor?.name || '[Subscriber]', custom: true });
          continue;
        }
        if (!mapping || typeof mapping !== 'object') {
          this.registrationReport.skipped.push({ subscriber: this._safeDefinition(rawDefinition), reason: 'missing-getSubscribedEvents' });
          continue;
        }

        for (const [eventName, rawEventDefinition] of Object.entries(mapping)) {
          for (const eventDefinition of this._normalizeSubscriberEventDefinitions(rawEventDefinition)) {
            const method = eventDefinition.method || eventDefinition.handle || 'handle';
            const handler = typeof method === 'function' ? method.bind(instance) : instance?.[method]?.bind(instance);
            if (typeof handler !== 'function') {
              throw providerError(
                `Subscriber method missing: ${instance?.constructor?.name || 'Subscriber'}.${String(method)}`,
                'EVENTS_PROVIDER_SUBSCRIBER_METHOD',
              );
            }
            const kind = listenerKind(eventName, eventDefinition);
            const options = {
              ...eventDefinition,
              owner: eventDefinition.owner || `subscriber:${instance.constructor?.name || 'anonymous'}`,
              tags: normalizeTags([...(normalizeTags(eventDefinition.tags || eventDefinition.tag)), 'subscriber', PROVIDER_TAG]),
            };
            delete options.method;
            delete options.handle;
            const handle = this._subscribe(kind, eventName, handler, options);
            this.registrationReport.subscribers.push({
              subscriber: instance.constructor?.name || '[Subscriber]',
              eventName,
              method: typeof method === 'function' ? method.name || '[Function]' : method,
              listenerId: handle?.id || null,
              kind,
            });
          }
        }
      } catch (error) {
        this._recordFailure('subscriber', { subscriber: this._safeDefinition(rawDefinition) }, error);
      }
    }
  }

  _normalizeSubscriberEventDefinitions(value) {
    if (typeof value === 'string' || typeof value === 'function') return [{ method: value }];
    if (Array.isArray(value)) {
      if (value.length && (typeof value[0] === 'string' || typeof value[0] === 'function') && !Array.isArray(value[0])) {
        return [{ method: value[0], priority: value[1] }];
      }
      return value.flatMap((entry) => this._normalizeSubscriberEventDefinitions(entry));
    }
    return isPlainObject(value) ? [{ ...value }] : [{ method: 'handle' }];
  }

  async _configureBroadcasting({ startBackground = true } = {}) {
    const configuration = this.settings.broadcasting || {};
    if (configuration.enabled !== true) return;
    const manager = safeResolve(this.app, 'events.broadcast', null) || this.broadcastManager();
    this._broadcast = manager;
    await this._registerBroadcastTransports(manager, configuration.transports || configuration.adapters || {});
    this._events.setBroadcastManager?.(manager, { auto: configuration.auto === true });
    if (configuration.listen === true && configuration.auto !== true && startBackground) manager.start(this._events);
    else if (configuration.listen === true && !startBackground) {
      this.registrationReport.skipped.push({ subsystem: 'broadcast-listener', reason: 'console-invocation-policy' });
    } else if (configuration.listen === true && configuration.auto === true) {
      this.registrationReport.warnings.push({
        code: 'EVENTS_BROADCAST_DOUBLE_MODE',
        message: 'broadcasting.auto and broadcasting.listen were both enabled; listen mode was suppressed to prevent duplicate delivery.',
      });
    }
    this.registrationReport.subsystems.push({ name: 'broadcasting', binding: 'events.broadcast', required: configuration.required === true });
  }

  async _registerBroadcastTransports(manager, definitions) {
    const entries = definitions instanceof Map ? Array.from(definitions.entries()) : Object.entries(definitions || {});
    for (const [name, raw] of entries) {
      try {
        const options = isPlainObject(raw) ? { ...raw } : {};
        const source = options.transport ?? options.adapter ?? options.use ?? options.binding ?? raw;
        let transport = null;
        if (options.binding || (typeof source === 'string' && hasBinding(this.app, source))) transport = safeResolve(this.app, options.binding || source, null);
        if (!transport) transport = await this._resolveDefinitionValue(source);
        if (!transport) throw providerError(`Broadcast transport could not be resolved: ${name}`, 'EVENTS_PROVIDER_BROADCAST_MISSING');
        for (const key of ['transport', 'adapter', 'use', 'binding', 'required']) delete options[key];
        manager.register(name, transport, options);
        this.registrationReport.broadcasts.push({ name, type: transport.constructor?.name || typeof transport });
      } catch (error) {
        this._recordFailure('broadcast', { name }, error, raw?.required === true);
      }
    }
  }

  async _configureBridge({ startBackground = true } = {}) {
    const configuration = this.settings.bridge?.redis || {};
    this.registrationReport.bridge.enabled = configuration.enabled === true;
    if (configuration.enabled !== true) return;
    if (!startBackground) {
      this.registrationReport.bridge.skipped = true;
      this.registrationReport.bridge.reason = 'console-invocation-policy';
      this.registrationReport.skipped.push({ subsystem: 'redis-bridge', reason: 'console-invocation-policy' });
      return;
    }
    if (this.settings.testing && configuration.allowInTests !== true) {
      this.registrationReport.bridge.skipped = true;
      this.registrationReport.bridge.reason = 'test-environment';
      this.registrationReport.skipped.push({ subsystem: 'redis-bridge', reason: 'test-environment' });
      return;
    }
    try {
      const bridge = safeResolve(this.app, 'events.bridge.redis', null) || this.bridge();
      this._bridge = bridge;
      await withTimeout(bridge.start(configuration), this.settings.readyTimeoutMs, 'Redis event bridge startup');
      this.registrationReport.bridge.started = true;
      this.registrationReport.bridge.state = bridge.state || bridge.snapshot?.().state || 'ready';
      this.registrationReport.subsystems.push({ name: 'redis-bridge', binding: 'events.bridge.redis', required: configuration.required === true });
    } catch (error) {
      this.registrationReport.bridge.state = 'failed';
      this.registrationReport.bridge.reason = error?.message || 'startup-failed';
      this._recordFailure('bridge', { name: 'redis' }, error, configuration.required === true);
    }
  }

  async _configureFabric({ startBackground = true } = {}) {
    const configuration = this.settings.fabric || {};
    if (configuration.enabled !== true) return;
    try {
      const fabric = safeResolve(this.app, 'events.fabric', null) || this.fabric();
      this._fabric = fabric;
      if (startBackground && configuration.autoStart !== false) {
        await withTimeout(
          fabric.start({ startTransports: true, app: this.app, manager: this }),
          this.settings.readyTimeoutMs,
          'Universal Event Fabric startup',
        );
      } else if (configuration.autoStart !== false) {
        this.registrationReport.skipped.push({ subsystem: 'universal-event-fabric', reason: 'console-invocation-policy' });
      }
      this.registrationReport.subsystems.push({
        name: 'universal-event-fabric',
        binding: 'events.fabric',
        required: configuration.required === true,
      });
    } catch (error) {
      this._recordFailure(
        'fabric',
        { name: 'universal-event-fabric' },
        error,
        configuration.required === true,
      );
    }
  }

  async _configureStudio({ startBackground = true } = {}) {
    const configuration = this.settings.studio || {};
    if (configuration.enabled !== true) return;
    try {
      const studio = safeResolve(this.app, 'events.studio', null) || this.studio();
      this._studio = studio;
      if (configuration.server?.enabled === true && startBackground) {
        const server = safeResolve(this.app, 'events.studio.server', null) || this.studioServer();
        this._studioServer = server;
        await server.start({
          allowRemote: configuration.server.allowRemote === true,
          assertTransportStartAllowed: this._resolveBinding('runtime.start.guard')?.assertAllowed,
        });
      } else if (configuration.server?.enabled === true) {
        this.registrationReport.skipped.push({ subsystem: 'events-studio-server', reason: 'console-invocation-policy' });
      }
      this.registrationReport.subsystems.push({ name: 'events-studio', binding: 'events.studio', required: configuration.required === true });
    } catch (error) {
      this._recordFailure('studio', { name: 'events-studio' }, error, configuration.required === true);
    }
  }

  async _configureDurable({ startBackground = true } = {}) {
    const configuration = this.settings.durable || {};
    if (configuration.enabled !== true) return;
    try {
      const outbox = safeResolve(this.app, 'events.outbox', null) || this.outbox();
      this._outbox = outbox;
      this._events.setOutbox?.(outbox);
      const publisher = safeResolve(this.app, 'events.outbox.publisher', null) || this.outboxPublisher();
      this._outboxPublisher = publisher;
      if (!publisher) {
        const error = providerError(
          `Durable events are enabled but transport binding [${configuration.transportBinding || 'events.durable.transport'}] is unavailable`,
          'EVENTS_PROVIDER_DURABLE_TRANSPORT_MISSING',
        );
        this._recordFailure('durable', { name: 'outbox-publisher' }, error, configuration.required === true);
        return;
      }
      if (configuration.autoStart !== false && startBackground) publisher.start();
      else if (configuration.autoStart !== false) {
        this.registrationReport.skipped.push({ subsystem: 'outbox-publisher', reason: 'console-invocation-policy' });
      }
      if (!this._events.subsystem?.('outbox-publisher')) {
        this._events.registerSubsystem?.('outbox-publisher', publisher, {
          required: configuration.required === true,
          closeOnShutdown: false,
          meta: { binding: 'events.outbox.publisher' },
        });
      }
      this.registrationReport.subsystems.push({ name: 'outbox-publisher', binding: 'events.outbox.publisher', required: configuration.required === true });
    } catch (error) {
      this._recordFailure('durable', { name: 'outbox' }, error, configuration.required === true);
    }
  }

  async _configureEnterpriseSubsystems() {
    if (this.settings.queue?.enabled === true) {
      const queue = await this._attachSubsystem('queue', 'events.queue', this.settings.queue);
      this._queue = queue || this._queue;
      if (queue) await this._registerQueueHandlers(queue, this.settings.queue.handlers || {});
    }
    if (this.settings.queue?.worker?.enabled === true || this.settings.persistence?.jobs?.enabled === true) {
      try {
        const worker = safeResolve(this.app, 'events.jobs.worker', null) || this.durableWorker();
        if (!worker) {
          throw providerError(
            'Persistent event jobs require a configured RawMongo job store.',
            'EVENTS_PROVIDER_JOB_STORE_MISSING',
          );
        }
        this._durableWorker = worker;
        await this._registerDurableJobHandlers(worker, this.settings.queue?.handlers || {});
        if (this.settings.queue?.worker?.autoStart !== false) await worker.start();
        this.registrationReport.subsystems.push({
          name: 'durable-jobs',
          binding: 'events.jobs.worker',
          required: this.settings.queue?.worker?.required === true,
        });
      } catch (error) {
        this._recordFailure(
          'subsystem',
          { name: 'durable-jobs', binding: 'events.jobs.worker' },
          error,
          this.settings.queue?.worker?.required === true,
        );
      }
    }
    if (this.settings.scheduler?.enabled === true) {
      const scheduler = await this._attachSubsystem('scheduler', 'events.scheduler', this.settings.scheduler);
      this._scheduler = scheduler || this._scheduler;
      if (scheduler) await this._registerSchedules(scheduler, this.settings.scheduler.tasks || this.settings.scheduler.schedules || {});
    }
    if (this.settings.workflows?.enabled === true) {
      const workflows = await this._attachSubsystem('workflows', 'events.workflows', this.settings.workflows);
      this._workflows = workflows || this._workflows;
      if (workflows) await this._registerWorkflows(workflows, this.settings.workflows.definitions || {});
    }
    if (this.settings.sourcing?.enabled === true) {
      this._eventStore = await this._attachSubsystem('event-store', 'events.store', this.settings.sourcing) || this._eventStore;
      if (this.settings.sourcing?.projections?.enabled !== false) {
        const projections = await this._attachSubsystem('projections', 'events.projections', this.settings.sourcing.projections || {});
        this._projections = projections || this._projections;
        if (projections) await this._registerProjections(projections, this.settings.sourcing.projections?.definitions || {});
      }
    }
  }

  async _attachSubsystem(name, binding, options = {}) {
    try {
      const subsystem = safeResolve(this.app, binding, null);
      if (!subsystem) throw providerError(`Required event subsystem binding is unavailable: ${binding}`, 'EVENTS_PROVIDER_SUBSYSTEM_MISSING', { name, binding });
      if (!this._events.subsystem?.(name)) {
        this._events.registerSubsystem?.(name, subsystem, {
          required: options.required === true,
          closeOnShutdown: options.closeOnShutdown !== undefined
            ? options.closeOnShutdown !== false
            : this._shouldCloseBinding(binding),
          meta: { binding, owned: this.ownsBinding(binding), ...(options.meta || {}) },
        });
      }
      this.registrationReport.subsystems.push({ name, binding, required: options.required === true });
      return subsystem;
    } catch (error) {
      this._recordFailure('subsystem', { name, binding }, error, options.required === true);
      return null;
    }
  }

  async _registerDurableJobHandlers(worker, definitions) {
    for (const [name, raw] of Object.entries(definitions || {})) {
      try {
        const options = isPlainObject(raw) ? raw : {};
        const handler = await this._resolveCallable(options.handler ?? options.use ?? raw);
        worker.register(name, handler, { replace: options.replace === true });
      } catch (error) {
        this._recordFailure('durable-job-handler', { name }, error, raw?.required === true);
      }
    }
  }

  async _registerQueueHandlers(queue, definitions) {
    for (const [name, raw] of Object.entries(definitions || {})) {
      try {
        const options = isPlainObject(raw) ? raw : {};
        const handler = await this._resolveCallable(options.handler ?? options.use ?? raw);
        queue.register(name, handler, { replace: options.replace === true });
        this.registrationReport.queueHandlers.push({ name });
      } catch (error) {
        this._recordFailure('queue-handler', { name }, error);
      }
    }
  }

  async _registerSchedules(scheduler, definitions) {
    const entries = Array.isArray(definitions)
      ? definitions.map((definition, index) => [definition?.name || `schedule-${index + 1}`, definition])
      : Object.entries(definitions || {});
    for (const [name, raw] of entries) {
      try {
        const definition = isPlainObject(raw) ? { ...raw, name: raw.name || name } : { name, task: raw };
        let handle;
        if (definition.eventName || definition.event) {
          handle = scheduler.event(definition.eventName || definition.event, definition.args || [], definition);
        } else {
          const task = await this._resolveCallable(definition.task || definition.handler || definition.use);
          if (definition.cron) handle = scheduler.cron(definition.cron, task, definition);
          else if (definition.at) handle = scheduler.at(definition.at, task, definition);
          else handle = scheduler.every(definition.everyMs || definition.intervalMs, task, definition);
        }
        this.registrationReport.schedules.push({ name: definition.name, id: handle?.id || null });
      } catch (error) {
        this._recordFailure('schedule', { name }, error, raw?.required === true);
      }
    }
  }

  async _registerWorkflows(workflows, definitions) {
    for (const [name, raw] of Object.entries(definitions || {})) {
      try {
        const definition = Array.isArray(raw) ? { steps: raw } : raw;
        if (!isPlainObject(definition)) {
          throw providerError(
            `Workflow [${name}] must be an object or an array of steps`,
            'EVENTS_PROVIDER_WORKFLOW_INVALID',
          );
        }
        const steps = [];
        for (const [index, stepRaw] of (definition.steps || []).entries()) {
          const step = typeof stepRaw === 'function' || typeof stepRaw === 'string'
            ? { name: `step-${index + 1}`, run: stepRaw }
            : { ...stepRaw };
          step.run = await this._resolveCallable(step.run || step.handle || step.use);
          if (step.compensate) step.compensate = await this._resolveCallable(step.compensate);
          steps.push(step);
        }
        workflows.define(name, steps, {
          version: definition.version,
          replace: definition.replace === true,
          compensateOnFailure: definition.compensateOnFailure,
        });
        this.registrationReport.workflows.push({ name, steps: steps.length });
      } catch (error) {
        this._recordFailure('workflow', { name }, error, raw?.required === true);
      }
    }
  }

  async _registerProjections(projections, definitions) {
    for (const [name, raw] of Object.entries(definitions || {})) {
      try {
        const definition = typeof raw === 'function' ? { handlers: raw } : raw;
        const source = definition.handlers || definition.events || definition;
        let handlers;
        if (typeof source === 'function' || typeof source === 'string') handlers = await this._resolveCallable(source);
        else {
          handlers = {};
          for (const [eventName, handlerDefinition] of Object.entries(source || {})) {
            if (['reset', 'replace', 'required'].includes(eventName)) continue;
            handlers[eventName] = await this._resolveCallable(handlerDefinition);
          }
        }
        const reset = definition.reset ? await this._resolveCallable(definition.reset) : null;
        projections.register(name, handlers, { replace: definition.replace === true, reset });
        this.registrationReport.projections.push({ name, handlers: typeof handlers === 'function' ? 1 : Object.keys(handlers).length });
      } catch (error) {
        this._recordFailure('projection', { name }, error, raw?.required === true);
      }
    }
  }

  _forwardContainerLifecycle() {
    const options = this.settings.lifecycle || {};
    if (options.enabled === false) return;
    const container = this.app?.container || this.app;
    if (!container) return;

    const shouldForward = (serviceName) => {
      const name = String(serviceName ?? '');
      if (!name) return true;
      if (options.includeEventBindings !== true && (name === 'events' || name.startsWith('events.'))) return false;
      const deny = Array.isArray(options.exclude) ? options.exclude : [];
      return !deny.some((entry) => entry === name || (entry.endsWith('*') && name.startsWith(entry.slice(0, -1))));
    };
    const forward = (eventName, payloadFactory) => (...args) => {
      if (this._forwardingContainerLifecycle) return;
      const serviceName = args[0];
      if (!shouldForward(serviceName)) return;
      this._forwardingContainerLifecycle = true;
      try { safeDispatch(this._events, eventName, payloadFactory(...args), this.logger); }
      finally { this._forwardingContainerLifecycle = false; }
    };
    const attachEmitter = (eventName, listener) => {
      if (typeof container.on !== 'function') return false;
      container.on(eventName, listener);
      this._lifecycleCleanups.push(() => container.off?.(eventName, listener) || container.removeListener?.(eventName, listener));
      return true;
    };
    const attachHook = (method, listener) => {
      if (typeof container?.[method] !== 'function') return false;
      const cleanup = container[method](listener);
      if (typeof cleanup === 'function') this._lifecycleCleanups.push(cleanup);
      return true;
    };

    attachEmitter('bound', forward('container:bound', (serviceName, scope) => ({ serviceName, scope })));
    if (!attachHook('onAllResolving', forward('container:resolving', (serviceName) => ({ serviceName })))) {
      attachEmitter('resolving', forward('container:resolving', (serviceName) => ({ serviceName })));
    }
    if (!attachHook('onAllResolved', forward('container:resolved', (serviceName) => ({ serviceName })))) {
      attachEmitter('resolved', forward('container:resolved', (serviceName) => ({ serviceName })));
    }
    if (!attachHook('onAllFailed', forward('container:failed', (serviceName, error) => ({ serviceName, error })))) {
      attachEmitter('failed', forward('container:failed', (serviceName, error) => ({ serviceName, error })));
    }
  }

  _registerHealthCheck() {
    if (this._healthCleanup || this.settings.health?.register === false) return;
    const health = safeResolve(this.app, this.settings.health?.binding || 'health', null)
      || safeResolve(this.app, 'health.manager', null)
      || safeResolve(this.app, 'health.registry', null);
    if (!health) {
      if (this.settings.health?.required === true) {
        throw providerError(
          `Required health registry binding [${this.settings.health?.binding || 'health'}] is unavailable`,
          'EVENTS_PROVIDER_HEALTH_REGISTRY_MISSING',
        );
      }
      return;
    }

    const name = this.settings.health?.name || 'events';
    const check = () => this.health();
    let cleanup = null;
    try {
      if (typeof health.register === 'function') {
        const result = health.register(name, check, {
          critical: this.settings.health?.critical ?? this.settings.production,
          timeoutMs: this.settings.health?.timeoutMs || this.settings.readyTimeoutMs,
          tags: ['events', 'infrastructure'],
        });
        if (typeof result === 'function') cleanup = result;
        else cleanup = () => health.unregister?.(name) ?? health.remove?.(name);
      } else if (typeof health.add === 'function') {
        const result = health.add(name, check);
        if (typeof result === 'function') cleanup = result;
        else cleanup = () => health.remove?.(name);
      } else if (typeof health.check === 'function' && typeof health.set === 'function') {
        health.set(name, check);
        cleanup = () => health.delete?.(name);
      }
    } catch (error) {
      this.registrationReport.warnings.push({
        code: 'EVENTS_HEALTH_REGISTRATION_FAILED',
        message: error?.message || String(error),
      });
      if (this.settings.health?.required === true) throw error;
    }
    this._healthCleanup = cleanup;
  }

  _subscribe(kind, eventName, handler, options) {
    if (this._scope) {
      if (kind === 'any') return this._scope.any(handler, options);
      if (kind === 'pattern') return this._scope.pattern(eventName, handler, options);
      return this._scope.subscribe(eventName, handler, options);
    }
    if (kind === 'any') return this._events.subscribeAny(handler, options);
    if (kind === 'pattern') return this._events.subscribePattern(eventName, handler, options);
    return this._events.subscribe(eventName, handler, options);
  }

  async _coerceListener(definition) {
    let target = definition;
    let method = null;
    const options = {};
    let identity = null;
    let required = false;

    if (isPlainObject(definition)) {
      if (definition.enabled === false) return { skip: true, reason: 'disabled' };
      if (!this._environmentMatches(definition)) return { skip: true, reason: 'environment' };
      if (definition.when !== undefined) {
        const result = typeof definition.when === 'function'
          ? await definition.when({ app: this.app, config: this.settings, environment: this.settings.environment })
          : definition.when;
        if (!result) return { skip: true, reason: 'condition' };
      }
      if (definition.unless !== undefined) {
        const result = typeof definition.unless === 'function'
          ? await definition.unless({ app: this.app, config: this.settings, environment: this.settings.environment })
          : definition.unless;
        if (result) return { skip: true, reason: 'condition' };
      }
      target = definition.listener ?? definition.use ?? definition.handler ?? definition.binding ?? definition.module;
      method = definition.method || null;
      required = definition.required === true;
      for (const key of LISTENER_OPTION_KEYS) if (definition[key] !== undefined) options[key] = definition[key];
      if (definition.binding) target = `binding:${definition.binding}`;
      if (definition.export) options.exportName = definition.export;
      options.transient = definition.transient === true || definition.singleton === false;
      options.owned = definition.owned === true;
    }

    const parsed = typeof target === 'string' ? this._parseReference(target) : null;
    identity = parsed ? `${parsed.spec}${parsed.exportName ? `#${parsed.exportName}` : ''}${parsed.method ? `@${parsed.method}` : ''}` : target;
    if (parsed) method ||= parsed.method;
    const resolved = await this._resolveDefinitionValue(target, { exportName: options.exportName || parsed?.exportName });

    if (typeof resolved === 'function') {
      const selected = method || 'handle';
      if (resolved.prototype && typeof resolved.prototype[selected] === 'function') {
        const instance = this._instance(resolved, { transient: options.transient });
        return { handler: instance[selected].bind(instance), options, identity: identity || resolved, required };
      }
      return { handler: resolved, options, identity: identity || resolved, required };
    }
    if (resolved && typeof resolved === 'object') {
      const selected = method || 'handle';
      if (typeof resolved[selected] === 'function') {
        if (options.owned) this._ownedListenerInstances.add(resolved);
        return { handler: resolved[selected].bind(resolved), options, identity: identity || resolved, required };
      }
    }
    return { handler: null, options, identity, required };
  }

  _environmentMatches(definition) {
    const only = normalizeTags(definition.environments || definition.environment || definition.onlyEnvironments);
    const except = normalizeTags(definition.exceptEnvironments || definition.exceptEnvironment);
    if (only.length && !only.includes(this.settings.environment)) return false;
    if (except.includes(this.settings.environment)) return false;
    return true;
  }

  async _resolveCallable(definition) {
    const value = await this._resolveDefinitionValue(definition);
    if (typeof value === 'function') {
      if (value.prototype && typeof value.prototype.handle === 'function') {
        const instance = this._instance(value);
        return instance.handle.bind(instance);
      }
      return value;
    }
    if (value && typeof value.handle === 'function') return value.handle.bind(value);
    throw providerError('Definition did not resolve to a callable value', 'EVENTS_PROVIDER_CALLABLE_INVALID', { definition: this._safeDefinition(definition) });
  }

  async _resolveDefinitionValue(definition, options = {}) {
    if (definition == null) return null;
    if (typeof definition !== 'string') return definition;
    const parsed = this._parseReference(definition);
    const exportName = options.exportName || parsed.exportName;
    if (parsed.binding) return safeResolve(this.app, parsed.binding, null);
    if (hasBinding(this.app, parsed.spec) && !parsed.spec.startsWith('#') && !parsed.spec.includes('/') && !parsed.spec.startsWith('.')) {
      return safeResolve(this.app, parsed.spec, null);
    }
    const module = await this._import(parsed.spec);
    if (exportName) return module?.[exportName] ?? null;
    if (module?.default !== undefined) return module.default;
    const keys = Object.keys(module || {}).filter((key) => key !== 'default');
    return keys.length === 1 ? module[keys[0]] : null;
  }

  _parseReference(input) {
    let spec = String(input || '').trim();
    if (spec.startsWith('binding:')) return { spec, binding: spec.slice('binding:'.length), method: null, exportName: null };
    let method = null;
    let exportName = null;

    const at = spec.lastIndexOf('@');
    if (at > spec.lastIndexOf('/')) {
      method = spec.slice(at + 1);
      spec = spec.slice(0, at);
    } else {
      const dot = spec.lastIndexOf('.');
      if (dot > spec.lastIndexOf('/') && !/\.(?:js|mjs|cjs|json)$/.test(spec)) {
        method = spec.slice(dot + 1);
        spec = spec.slice(0, dot);
      }
    }

    const hash = spec.indexOf('#', 1);
    if (hash > 0) {
      exportName = spec.slice(hash + 1);
      spec = spec.slice(0, hash);
    }
    if (spec.startsWith('@listeners/')) {
      const name = spec.slice('@listeners/'.length);
      spec = `#app/Listeners/${name}${/\.(?:js|mjs|cjs)$/.test(name) ? '' : '.js'}`;
    }
    return { spec, binding: null, method, exportName };
  }

  async _import(spec) {
    if (!spec) throw providerError('Module reference is empty', 'EVENTS_PROVIDER_IMPORT_EMPTY');
    try {
      return await importApplicationModule(this.app, spec);
    } catch (error) {
      throw providerError(
        `Unable to import configured Events module [${spec}] from the application package scope`,
        'EVENTS_PROVIDER_IMPORT_FAILED',
        {
          specifier: spec,
          applicationRoot: error?.details?.applicationRoot || null,
          resolution: error?.details || null,
        },
        error,
      );
    }
  }

  _instance(Class, options = {}) {
    if (!options.transient && this._listenerInstances.has(Class)) return this._listenerInstances.get(Class);
    let instance = null;
    let owned = false;
    try {
      instance = this.app?.make?.(Class);
      if (instance) owned = true;
    } catch {}
    if (!instance) {
      try {
        instance = this.app?.container?.make?.(Class);
        if (instance) owned = true;
      } catch {}
    }
    if (!instance) {
      const dependencies = Array.isArray(Class.dependencies)
        ? Class.dependencies.map((key) => safeResolve(this.app, key, null))
        : [];
      instance = new Class(...dependencies);
      owned = true;
    }
    if (instance && typeof instance === 'object' && !instance.app) {
      try { instance.app = this.app; } catch {}
    }
    if (!options.transient) this._listenerInstances.set(Class, instance);
    if (owned) this._ownedListenerInstances.add(instance);
    return instance;
  }

  async _closeOwnedListenerInstances() {
    const instances = Array.from(this._ownedListenerInstances).reverse();
    this._ownedListenerInstances.clear();
    this._listenerInstances.clear();
    for (const instance of instances) {
      try {
        const operation = instance?.close?.() ?? instance?.stop?.() ?? instance?.dispose?.();
        if (operation && typeof operation.then === 'function') await operation;
      } catch (error) {
        log(this.logger, 'warn', '[EventsServiceProvider] listener instance cleanup failed:', error?.message || error);
      }
    }
  }

  _listenerSignature(eventName, identity, options) {
    let source;
    if (typeof identity === 'string') source = identity;
    else if ((typeof identity === 'function' || (identity && typeof identity === 'object'))) {
      let id = this._listenerIdentityIds.get(identity);
      if (!id) {
        id = ++this._listenerIdentitySequence;
        this._listenerIdentityIds.set(identity, id);
      }
      const label = typeof identity === 'function' ? identity.name : identity.constructor?.name;
      source = `${typeof identity === 'function' ? 'fn' : 'obj'}:${label || 'anonymous'}#${id}`;
    } else source = String(identity);
    return `${eventName}|${source}|${options.owner || ''}|${options.once === true ? 'once' : 'many'}|${Number(options.priority) || 0}`;
  }

  _recordFailure(phase, details, error, required = false) {
    const record = { phase, ...details, error: safeError(error), required: required === true };
    this.registrationReport.failed.push(record);
    log(this.logger, required ? 'error' : 'warn', `[EventsServiceProvider] ${phase} failed:`, error?.message || error);
    if (required || this.settings.failFast) throw error;
    return record;
  }

  _safeDefinition(definition) {
    if (typeof definition === 'function') return definition.name || '[Function]';
    if (typeof definition === 'string') return definition;
    return cloneForPublic(definition);
  }

  _logBootSummary() {
    const report = this.registrationReport;
    log(
      this.logger,
      this.state === 'ready' ? 'info' : 'warn',
      `[EventsServiceProvider] ${this.state}: profile=${this.settings.profile}, `
        + `listeners=${report.loaded.length}, subscribers=${report.subscribers.length}, `
        + `subsystems=${report.subsystems.length}, failed=${report.failed.length}, `
        + `duration=${report.durationMs.toFixed(2)}ms`,
    );
  }

  health() {
    if (!this.settings.enabled) {
      return Object.freeze({ ok: true, ready: true, state: 'disabled', reasons: Object.freeze([]), checkedAt: Date.now() });
    }
    const reasons = [];
    const events = this._events;
    const dispatcher = events?.health?.() || null;
    if (!events) reasons.push('dispatcher_missing');
    if (dispatcher?.ok === false) reasons.push(...(dispatcher.reasons || ['dispatcher_unhealthy']));
    if (this.state === 'failed') reasons.push('provider_failed');
    if (this.state === 'closing' || this.state === 'closed') reasons.push(`provider_${this.state}`);
    if (this.registrationReport.failed.some((entry) => entry.required)) reasons.push('required_registration_failed');
    if (!this._backgroundSuppressed && this.settings.bridge?.redis?.required === true && !this._bridge?.ready) reasons.push('required_bridge_not_ready');
    if (!this._backgroundSuppressed && this.settings.durable?.required === true && !this._outboxPublisher) reasons.push('required_durable_publisher_missing');
    if (!this._backgroundSuppressed && this.settings.fabric?.required === true && this._fabric?.health?.().ready !== true) reasons.push('required_fabric_not_ready');
    if (this.settings.persistence?.required === true && !this._rawMongoSource()) reasons.push('required_persistence_source_missing');
    if (!this._backgroundSuppressed && this.settings.queue?.worker?.required === true && !this._durableWorker?.snapshot?.().running) reasons.push('required_durable_worker_not_ready');
    const result = Object.freeze({
      ok: reasons.length === 0,
      ready: reasons.length === 0 && ['ready', 'degraded', 'booting', 'registered'].includes(this.state),
      state: this.state,
      reasons: Object.freeze(Array.from(new Set(reasons))),
      dispatcher,
      fabric: this._fabric?.health?.() || null,
      bridge: this._bridge?.health?.() || null,
      durableWorker: this._durableWorker?.snapshot?.() || null,
      persistence: Object.freeze({
        driver: this.settings.persistence?.driver || 'memory',
        rawmongoAvailable: !!this._rawMongoSource(),
        outbox: this._outboxStore?.snapshot?.() || null,
        inbox: this._inbox?.snapshot?.() || null,
        jobs: this._jobStore?.snapshot?.() || null,
      }),
      registration: Object.freeze({
        loaded: this.registrationReport.loaded.length,
        subscribers: this.registrationReport.subscribers.length,
        failed: this.registrationReport.failed.length,
        requiredFailed: this.registrationReport.failed.filter((entry) => entry.required).length,
      }),
      checkedAt: Date.now(),
    });
    this.lastHealth = result;
    return result;
  }

  async doctor() {
    const findings = [];
    const config = this.settings;
    const events = this._events;
    const bus = events?.configuration?.value || config.bus;

    if (config.hardened && bus.listeners?.maxTotal === 0) {
      findings.push({ level: 'error', code: 'EVENTS_UNBOUNDED_LISTENERS', message: 'Production listener total is unbounded.' });
    }
    if (config.hardened && bus.history?.maxEntriesPerEvent > 0 && bus.history?.maxEventNames === 0) {
      findings.push({ level: 'error', code: 'EVENTS_UNBOUNDED_HISTORY_NAMES', message: 'Production replay history has no event-name ceiling.' });
    }
    if (config.hardened && bus.history?.clonePolicy === 'reference' && bus.history?.maxEntriesPerEvent > 0) {
      findings.push({ level: 'warning', code: 'EVENTS_REFERENCE_HISTORY', message: 'Production replay history retains mutable references.' });
    }
    if (config.hardened && config.dynamicRegistration && !events?.registrationsFrozen?.()) {
      findings.push({ level: 'warning', code: 'EVENTS_DYNAMIC_REGISTRATION', message: 'Listener registration remains mutable in production.' });
    }
    if (config.bridge?.redis?.enabled && Number(config.bridge.redis.protocol?.publishVersion || 2) >= 2 && !config.bridge.redis.protocol?.secret) {
      findings.push({ level: config.bridge.redis.required ? 'error' : 'warning', code: 'EVENTS_BRIDGE_UNSIGNED', message: 'Redis bridge protocol v2 has no signing secret.' });
    }
    if (config.durable?.enabled && !this._outboxPublisher) {
      findings.push({ level: config.durable.required ? 'error' : 'warning', code: 'EVENTS_DURABLE_TRANSPORT_MISSING', message: 'Durable events are enabled without a publisher transport.' });
    }
    if (config.hardened && config.durable?.enabled && this._outboxStore instanceof MemoryOutboxStore && config.durable.allowMemoryInProduction !== true) {
      findings.push({ level: 'warning', code: 'EVENTS_MEMORY_OUTBOX', message: 'The production outbox is memory-backed and will not survive process loss.' });
    }
    if (config.fabric?.enabled === true && !this._fabric) {
      findings.push({ level: config.fabric?.required === true ? 'error' : 'warning', code: 'EVENTS_FABRIC_NOT_CREATED', message: 'Universal Event Fabric is enabled but has not been created.' });
    }
    if (config.hardened && config.fabric?.enabled === true && this._fabric && this._fabric.transports?.all?.().some((transport) => transport.capabilities?.().remote === true) && !this._fabric.cryptoProvider) {
      findings.push({ level: 'error', code: 'EVENTS_REMOTE_UNSIGNED', message: 'Remote Event Fabric transports are enabled without a signing key.' });
    }
    if (config.hardened && config.fabric?.enabled === true && this._fabric?.profile?.allowUnknownEvents === false && this._fabric?.definitions?.size === 0) {
      findings.push({ level: 'warning', code: 'EVENTS_DEFINITION_REGISTRY_EMPTY', message: 'The hardened Event Fabric rejects unknown events but has no registered event definitions.' });
    }
    if (config.persistence?.driver === 'rawmongo' && !this._rawMongoSource()) {
      findings.push({ level: config.persistence?.required === true ? 'error' : 'warning', code: 'EVENTS_RAWMONGO_UNAVAILABLE', message: 'RawMongo event persistence is configured but no RawMongo binding is available.' });
    }
    if (config.hardened && config.persistence?.driver === 'memory' && (config.durable?.enabled || config.sourcing?.enabled || config.workflows?.enabled)) {
      findings.push({ level: 'warning', code: 'EVENTS_MEMORY_PERSISTENCE', message: 'A durable subsystem is configured with process-local memory persistence.' });
    }
    if (config.queue?.worker?.enabled === true && !this._jobStore) {
      findings.push({ level: config.queue?.worker?.required === true ? 'error' : 'warning', code: 'EVENTS_JOB_STORE_MISSING', message: 'The durable event worker is enabled without a persistent job store.' });
    }
    for (const failure of this.registrationReport.failed) {
      findings.push({
        level: failure.required ? 'error' : 'warning',
        code: 'EVENTS_REGISTRATION_FAILURE',
        message: `${failure.phase || 'registration'} failed: ${failure.error?.message || 'unknown error'}`,
      });
    }

    const health = this.health();
    const result = Object.freeze({
      ok: health.ok && !findings.some((finding) => finding.level === 'error'),
      state: this.state,
      health,
      findings: Object.freeze(findings),
      snapshot: this.snapshot(),
    });
    this.lastDoctor = result;
    return result;
  }

  metrics() { return this._events?.metrics?.() || null; }
  prometheus(prefix) { return this._events?.prometheus?.(prefix) || ''; }
  registration() { return freezePublic(cloneForPublic(this.registrationReport)); }

  snapshot() {
    return Object.freeze({
      state: this.state,
      enabled: this.settings.enabled,
      profile: this.settings.profile,
      environment: this.settings.environment,
      registeredAt: this.registeredAt,
      bootStartedAt: this.bootStartedAt,
      readyAt: this.readyAt,
      closedAt: this.closedAt,
      lastError: safeError(this.lastError),
      health: this.health(),
      registration: this.registration(),
      events: this._events?.snapshot?.() || null,
      fabric: this._fabric?.snapshot?.() || null,
      definitions: this._fabric?.definitions?.snapshot?.() || null,
      transports: this._fabric?.transports?.snapshot?.() || null,
      resources: this._fabric?.resources?.snapshot?.() || null,
      flightRecorder: this._fabric?.flightRecorder?.snapshot?.() || null,
      studio: this._studio ? { readOnly: this._studio.readOnly, allowMutations: this._studio.allowMutations, server: this._studioServer?.address?.() || null } : null,
      bridge: this._bridge?.snapshot?.() || null,
      broadcasting: this._broadcast?.snapshot?.() || null,
      outbox: this._outbox?.snapshot?.() || null,
      outboxPublisher: this._outboxPublisher?.snapshot?.() || null,
      inbox: this._inbox?.snapshot?.() || null,
      queue: this._queue?.snapshot?.() || null,
      jobStore: this._jobStore?.snapshot?.() || null,
      durableWorker: this._durableWorker?.snapshot?.() || null,
      scheduler: this._scheduler?.snapshot?.() || null,
      workflows: this._workflows?.snapshot?.() || null,
      eventStore: this._eventStore?.snapshot?.() || null,
      projections: this._projections?.snapshot?.() || null,
    });
  }

  async [Symbol.asyncDispose]() { await this.close(); }
}

/* -------------------------------------------------------------------------- */
/* Service provider                                                           */
/* -------------------------------------------------------------------------- */

export class EventsServiceProvider {
  static priority = 2;
  static dependencies = ['app'];

  constructor(app) {
    this.app = app;
    this.manager = null;
    this.settings = null;
    this._registered = false;
  }

  register() {
    if (this._registered) return this;
    const app = this.app;
    const config = safeResolve(app, 'config', {});
    const settings = normalizeEventsProviderSettings(config);
    const logger = resolveLogger(app);

    let manager = hasBinding(app, 'events.manager') ? safeResolve(app, 'events.manager', null) : null;
    if (manager && !(manager instanceof RawNodeEventsManager)) {
      const valid = typeof manager.boot === 'function' && typeof manager.close === 'function' && typeof manager.dispatcher === 'function';
      if (!valid) {
        throw providerError(
          'Existing [events.manager] binding does not implement the RawNode events manager contract',
          'EVENTS_PROVIDER_MANAGER_CONFLICT',
        );
      }
    }
    if (!manager) manager = new RawNodeEventsManager(app, logger, settings);
    this.manager = manager;
    this.settings = settings;

    const registerBinding = (key, factory, kind = 'singleton') => {
      const created = bindIfAbsent(app, kind, key, factory);
      manager.markOwnedBinding?.(key, created);
      return created;
    };

    registerBinding('events.manager', () => manager);
    registerBinding('events.settings', () => publicSettings(settings));
    registerBinding('events.config', () => publicSettings(settings));

    registerBinding('events.schemas', () => manager.schemas());
    registerBinding('events.codecs', () => manager.codecs());
    registerBinding('events', () => manager.dispatcher());

    if (settings.registerAliases) {
      registerBinding('event', () => safeResolve(app, 'events', null) || manager.dispatcher());
      registerBinding('event.bus', () => safeResolve(app, 'events', null) || manager.dispatcher());
      registerBinding('event.dispatcher', () => safeResolve(app, 'events', null) || manager.dispatcher());
    }

    registerBinding('events.fabric', () => manager.fabric());
    registerBinding('events.definitions', () => manager.fabric().definitions);
    registerBinding('events.transports', () => manager.fabric().transports);
    registerBinding('events.transport.router', () => manager.fabric().router);
    registerBinding('events.resources', () => manager.fabric().resources);
    registerBinding('events.middleware', () => manager.fabric().middleware);
    registerBinding('events.gateway', () => manager.fabric().gateway);
    registerBinding('events.channels', () => manager.fabric().authorizer);
    registerBinding('events.flight-recorder', () => manager.fabric().flightRecorder);
    registerBinding('events.requests', () => manager.fabric().requests);
    registerBinding('events.studio', () => manager.studio());
    registerBinding('events.studio.server', () => manager.studioServer());
    registerBinding('events.durable.transport', () => manager.fabric().outboxPublisherTransport());

    registerBinding('events.bridge.redis', () => manager.bridge());
    registerBinding('events.broadcast', () => manager.broadcastManager());
    registerBinding('events.outbox.store', () => manager.outboxStore());
    registerBinding('events.outbox', () => manager.outbox());
    registerBinding('events.outbox.publisher', () => manager.outboxPublisher());
    registerBinding('events.queue', () => manager.queue());
    registerBinding('events.inbox', () => manager.inbox());
    registerBinding('events.jobs.store', () => manager.jobStore());
    registerBinding('events.jobs.worker', () => manager.durableWorker());
    registerBinding('events.scheduler', () => manager.scheduler());
    registerBinding('events.workflows.store', () => manager.workflowStore());
    registerBinding('events.workflows', () => manager.workflows());
    registerBinding('events.store', () => manager.eventStore());
    registerBinding('events.projections.checkpoints', () => manager.projectionCheckpoints());
    registerBinding('events.projections', () => manager.projections());

    registerBinding('events.health', () => () => manager.health());
    registerBinding('events.inspect', () => (eventName) => safeResolve(app, 'events')?.inspect?.(eventName));
    registerBinding('events.metrics', () => () => manager.metrics());
    registerBinding('events.prometheus', () => (prefix) => manager.prometheus(prefix));
    registerBinding('events.registration', () => () => manager.registration());
    registerBinding('events.doctor', () => () => manager.doctor());
    registerBinding('events.factory', () => (options = {}) => new AdvancedEventDispatcher({ ...settings.bus, ...options, logger }));
    registerBinding('events.fabric.factory', () => (options = {}) => new NodeEventFabric({
      dispatcher: options.dispatcher || new AdvancedEventDispatcher({ ...settings.bus, ...(options.bus || {}), logger }),
      profile: options.profile || settings.profile,
      ...options,
    }));
    registerBinding('events.publish', () => (eventOrOperation, payload, options) => manager.fabric().publish(eventOrOperation, payload, options));
    registerBinding('events.request', () => (eventOrOperation, payload, options) => manager.fabric().request(eventOrOperation, payload, options));
    registerBinding('events.inbound', () => (envelope, context) => manager.fabric().inbound(envelope, context));

    if (settings.registerCommands) this._registerCommands(registerBinding);
    this._bindHelpers();
    this._registered = true;
    return this;
  }

  _registerCommands(registerBinding = null) {
    const add = registerBinding || ((key, factory) => {
      const created = bindIfAbsent(this.app, 'singleton', key, factory);
      this.manager?.markOwnedBinding?.(key, created);
      return created;
    });
    for (const [key, Command] of EVENT_COMMANDS || []) {
      add(key, () => new Command(this.app));
      tag(this.app, key, COMMAND_TAG);
    }
    const key = 'command.events.provider.status';
    add(key, () => new EventsProviderStatusCommand(this.app));
    tag(this.app, key, COMMAND_TAG);
  }

  _bindHelpers() {
    const app = this.app;
    if (typeof app.events !== 'function') app.events = () => app.resolve('events');
    if (typeof app.event !== 'function') app.event = (eventOrName, ...args) => app.resolve('events').dispatch(eventOrName, ...args);
    if (typeof app.dispatch !== 'function') app.dispatch = (eventOrName, ...args) => app.resolve('events').dispatch(eventOrName, ...args);
    if (typeof app.dispatchAsync !== 'function') app.dispatchAsync = (eventOrName, ...args) => app.resolve('events').dispatchAsync(eventOrName, ...args);
    if (typeof app.dispatchDeferred !== 'function') app.dispatchDeferred = (eventOrName, ...args) => app.resolve('events').dispatchDeferred(eventOrName, ...args);
    if (typeof app.eventFabric !== 'function') app.eventFabric = () => app.resolve('events.fabric');
    if (typeof app.eventOperation !== 'function') app.eventOperation = (eventName, payload) => app.resolve('events.fabric').event(eventName, payload);
    if (typeof app.publishEvent !== 'function') app.publishEvent = (eventOrOperation, payload, options) => app.resolve('events.fabric').publish(eventOrOperation, payload, options);
    if (typeof app.requestEvent !== 'function') app.requestEvent = (eventOrOperation, payload, options) => app.resolve('events.fabric').request(eventOrOperation, payload, options);
    if (typeof app.handleEventRequest !== 'function') app.handleEventRequest = (eventName, handler, options) => app.resolve('events.fabric').handleRequest(eventName, handler, options);
    if (typeof app.defineEvent !== 'function') app.defineEvent = (definition, options) => app.resolve('events.fabric').define(definition, options);
    if (typeof app.eventHealth !== 'function') app.eventHealth = () => this.manager.health();
  }

  async boot(context = {}) {
    if (!this._registered) this.register();
    return this.manager.boot(context);
  }

  async teardown() {
    return this.manager?.close?.();
  }

  async tearDown() {
    return this.teardown();
  }
}

/** Existing applications import the singular provider name. */
export class EventServiceProvider extends EventsServiceProvider {}

/** Explicit RawNode-prefixed alias for package and framework integrations. */
export const RawNodeEventsServiceProvider = EventsServiceProvider;

export default EventServiceProvider;
