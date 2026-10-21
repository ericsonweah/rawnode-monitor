'use strict';

const bool = (name, fallback = false) => {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).toLowerCase());
};
const int = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
};
const csv = (name, fallback = []) => process.env[name]
  ? String(process.env[name]).split(',').map((value) => value.trim()).filter(Boolean)
  : fallback;
const profile = process.env.EVENTS_PROFILE || (process.env.NODE_ENV === 'production' ? 'production' : 'compat');

export default {
  profile,
  global: process.env.EVENTS_GLOBAL !== 'false',
  failFast: bool('EVENTS_FAIL_FAST', process.env.NODE_ENV === 'production'),
  dynamicRegistration: process.env.EVENTS_DYNAMIC_REGISTRATION !== 'false',
  freezeListeners: bool('EVENTS_FREEZE_LISTENERS', false),

  bus: {
    normalizeDot: bool('EVENTS_NORMALIZE_DOT', false),
    logEvents: bool('EVENTS_LOG', false),
    listeners: {
      maxPerEvent: int('EVENTS_MAX_LISTENERS_PER_EVENT', 5000),
      maxTotal: int('EVENTS_MAX_LISTENERS_TOTAL', 100_000),
      maxPatterns: int('EVENTS_MAX_PATTERNS', 10_000),
      maxPerPattern: int('EVENTS_MAX_LISTENERS_PER_PATTERN', 1000),
      maxAny: int('EVENTS_MAX_ANY_LISTENERS', 1000),
      planCacheMax: int('EVENTS_PLAN_CACHE', 4096),
    },
    history: {
      maxEntriesPerEvent: int('EVENTS_HISTORY_PER_EVENT', 0),
      maxEventNames: int('EVENTS_HISTORY_EVENT_NAMES', 1024),
      maxEntriesTotal: int('EVENTS_HISTORY_ENTRIES', 100_000),
      maxBytes: int('EVENTS_HISTORY_BYTES', 64 * 1024 * 1024),
      maxPayloadBytes: int('EVENTS_HISTORY_PAYLOAD_BYTES', 256 * 1024),
      ttlMs: int('EVENTS_HISTORY_TTL_MS', 60 * 60 * 1000),
      clonePolicy: process.env.EVENTS_HISTORY_MODE || 'shallow',
      allow: csv('EVENTS_HISTORY_ALLOW', []),
      deny: csv('EVENTS_HISTORY_DENY', ['internal:**']),
    },
    deferred: {
      maxItems: int('EVENTS_DEFERRED_MAX_ITEMS', 100_000),
      maxBytes: int('EVENTS_DEFERRED_MAX_BYTES', 64 * 1024 * 1024),
      maxInFlight: int('EVENTS_DEFERRED_CONCURRENCY', 32),
      budgetMs: int('EVENTS_DEFERRED_BUDGET_MS', 4),
      maxPerSlice: int('EVENTS_DEFERRED_MAX_PER_SLICE', 256),
      overflow: process.env.EVENTS_DEFERRED_OVERFLOW || 'drop-oldest',
    },
    metrics: {
      enabled: process.env.EVENTS_METRICS !== 'false',
      prefix: process.env.EVENTS_METRICS_PREFIX || 'rawnode_events',
      maxSeries: int('EVENTS_METRICS_SERIES', 2048),
      slowMs: int('EVENTS_SLOW_MS', 25),
    },
    diagnostics: {
      enabled: bool('EVENTS_DIAGNOSTICS', false),
      historyLimit: int('EVENTS_DIAGNOSTICS_HISTORY', 256),
      maxHistoryBytes: int('EVENTS_DIAGNOSTICS_BYTES', 4 * 1024 * 1024),
      publishChannel: process.env.EVENTS_DIAGNOSTICS_CHANNEL !== 'false',
    },
    security: {
      strictNames: bool('EVENTS_STRICT_NAMES', profile === 'production' || profile === 'strict' || profile === 'enterprise'),
      maxEventNameBytes: int('EVENTS_MAX_NAME_BYTES', 512),
      maxSegments: int('EVENTS_MAX_SEGMENTS', 32),
      maxPatternBytes: int('EVENTS_MAX_PATTERN_BYTES', 4096),
      maxDispatchPayloadBytes: int('EVENTS_MAX_PAYLOAD_BYTES', 16 * 1024 * 1024),
      maxContextBytes: int('EVENTS_MAX_CONTEXT_BYTES', 64 * 1024),
      blockControlChars: process.env.EVENTS_BLOCK_CONTROL_CHARS !== 'false',
    },
    contracts: {
      autoValidate: bool('EVENTS_CONTRACT_AUTO_VALIDATE', process.env.NODE_ENV === 'production'),
    },
    lifecycle: {
      shutdownTimeoutMs: int('EVENTS_SHUTDOWN_TIMEOUT_MS', 30_000),
      forceOnTimeout: process.env.EVENTS_FORCE_SHUTDOWN_TIMEOUT !== 'false',
    },
  },

  contracts: {
    maxEvents: int('EVENTS_CONTRACT_MAX_EVENTS', 10_000),
    maxVersionsPerEvent: int('EVENTS_CONTRACT_MAX_VERSIONS', 100),
  },

  codecs: {
    maxCodecs: int('EVENTS_CODEC_MAX', 1000),
  },

  listeners: {},
  subscribers: [],

  lifecycle: { enabled: process.env.EVENTS_CONTAINER_LIFECYCLE !== 'false' },

  broadcasting: {
    enabled: bool('EVENTS_BROADCASTING', false),
    auto: bool('EVENTS_BROADCAST_AUTO', false),
    listen: bool('EVENTS_BROADCAST_LISTEN', false),
    errorPolicy: process.env.EVENTS_BROADCAST_ERROR_POLICY || 'isolate',
    defaultChannel: process.env.EVENTS_BROADCAST_CHANNEL || 'global',
  },

  bridge: {
    redis: {
      enabled: bool('EVENTS_REDIS', false),
      required: bool('EVENTS_REDIS_REQUIRED', false),
      channel: process.env.EVENTS_REDIS_CHANNEL || 'rawnode:events',
      namespace: process.env.EVENTS_REDIS_NAMESPACE || 'default',
      nodeId: process.env.NODE_ID || undefined,
      allow: csv('EVENTS_REDIS_ALLOW', []),
      deny: csv('EVENTS_REDIS_DENY', ['internal:**', 'container:**', 'http:**', 'ws:**', 'tcp:**', 'udp:**']),
      limits: { maxPacketBytes: int('EVENTS_REDIS_PACKET_BYTES', 1024 * 1024), maxArgs: int('EVENTS_REDIS_MAX_ARGS', 128) },
      queue: { maxItems: int('EVENTS_REDIS_QUEUE_ITEMS', 10_000), maxBytes: int('EVENTS_REDIS_QUEUE_BYTES', 16 * 1024 * 1024), overflow: process.env.EVENTS_REDIS_OVERFLOW || 'drop-oldest' },
      protocol: {
        publishVersion: int('EVENTS_REDIS_PROTOCOL_VERSION', 2),
        acceptedVersions: [1, 2],
        secret: process.env.EVENTS_REDIS_SECRET || undefined,
        acceptUnsignedV1: process.env.EVENTS_REDIS_ACCEPT_UNSIGNED_V1 !== 'false',
        ttlMs: int('EVENTS_REDIS_TTL_MS', 60_000),
        maxHops: int('EVENTS_REDIS_MAX_HOPS', 4),
      },
    },
  },

  durable: {
    enabled: bool('EVENTS_DURABLE', false),
    autoStart: process.env.EVENTS_DURABLE_AUTO_START !== 'false',
    maxAttempts: int('EVENTS_DURABLE_ATTEMPTS', 10),
    memory: { maxItems: int('EVENTS_OUTBOX_ITEMS', 100_000), maxBytes: int('EVENTS_OUTBOX_BYTES', 128 * 1024 * 1024), overflow: process.env.EVENTS_OUTBOX_OVERFLOW || 'reject' },
    publisher: { batchSize: int('EVENTS_OUTBOX_BATCH', 100), concurrency: int('EVENTS_OUTBOX_CONCURRENCY', 8), leaseMs: int('EVENTS_OUTBOX_LEASE_MS', 30_000), pollMs: int('EVENTS_OUTBOX_POLL_MS', 250) },
  },

  queue: {
    enabled: bool('EVENTS_QUEUE', false),
    required: bool('EVENTS_QUEUE_REQUIRED', false),
    maxItems: int('EVENTS_QUEUE_ITEMS', 100_000),
    maxBytes: int('EVENTS_QUEUE_BYTES', 64 * 1024 * 1024),
    concurrency: int('EVENTS_QUEUE_CONCURRENCY', 8),
    attempts: int('EVENTS_QUEUE_ATTEMPTS', 3),
    retryBaseMs: int('EVENTS_QUEUE_RETRY_BASE_MS', 100),
    retryMaxMs: int('EVENTS_QUEUE_RETRY_MAX_MS', 30_000),
    overflow: process.env.EVENTS_QUEUE_OVERFLOW || 'reject',
    shutdownTimeoutMs: int('EVENTS_QUEUE_SHUTDOWN_TIMEOUT_MS', 30_000),
  },

  scheduler: {
    enabled: bool('EVENTS_SCHEDULER', false),
    required: bool('EVENTS_SCHEDULER_REQUIRED', false),
    queue: bool('EVENTS_SCHEDULER_USE_QUEUE', false),
  },

  workflows: {
    enabled: bool('EVENTS_WORKFLOWS', false),
    required: bool('EVENTS_WORKFLOWS_REQUIRED', false),
    maxDefinitions: int('EVENTS_WORKFLOW_DEFINITIONS', 1000),
    maxSteps: int('EVENTS_WORKFLOW_STEPS', 1000),
    memory: { maxItems: int('EVENTS_WORKFLOW_ITEMS', 100_000) },
  },

  sourcing: {
    enabled: bool('EVENTS_SOURCING', false),
    required: bool('EVENTS_SOURCING_REQUIRED', false),
    memory: {
      maxStreams: int('EVENTS_STORE_STREAMS', 100_000),
      maxEvents: int('EVENTS_STORE_EVENTS', 1_000_000),
      maxBytes: int('EVENTS_STORE_BYTES', 256 * 1024 * 1024),
      maxEventBytes: int('EVENTS_STORE_EVENT_BYTES', 4 * 1024 * 1024),
    },
    projections: {
      enabled: process.env.EVENTS_PROJECTIONS !== 'false',
      maxProjections: int('EVENTS_PROJECTION_MAX', 1000),
      batchSize: int('EVENTS_PROJECTION_BATCH', 1000),
      budgetMs: int('EVENTS_PROJECTION_BUDGET_MS', 5),
    },
  },
};
