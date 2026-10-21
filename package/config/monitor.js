'use strict';

const TRUE = new Set(['1', 'true', 'yes', 'y', 'on', 'enabled']);
const FALSE = new Set(['0', 'false', 'no', 'n', 'off', 'disabled']);

function string(name, fallback = undefined) {
  const value = process.env[name];
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}
function bool(name, fallback = false) {
  const value = string(name);
  if (value === undefined) return fallback;
  const normalized = value.toLowerCase();
  if (TRUE.has(normalized)) return true;
  if (FALSE.has(normalized)) return false;
  return fallback;
}
function integer(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}
function number(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
function csv(name, fallback = []) {
  const value = string(name);
  return value === undefined ? [...fallback] : value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

const environment = string('APP_ENV', string('NODE_ENV', 'development'));
const production = ['production', 'prod'].includes(String(environment).toLowerCase());
const profile = string('MONITOR_PROFILE', production ? 'production' : 'enterprise');

export default {
  enabled: bool('MONITOR_ENABLED', true),
  profile,
  service: string('MONITOR_SERVICE', string('APP_NAME', 'rawnode')),
  environment,
  version: string('MONITOR_SERVICE_VERSION', string('APP_VERSION')),
  instanceId: string('MONITOR_INSTANCE_ID'),
  region: string('MONITOR_REGION'),
  zone: string('MONITOR_ZONE'),
  bootSummary: bool('MONITOR_BOOT_SUMMARY', !production),
  failFast: bool('MONITOR_FAIL_FAST', production),
  collectionIntervalMs: integer('MONITOR_COLLECTION_INTERVAL_MS', 10_000),
  resourceIntervalMs: integer('MONITOR_RESOURCE_INTERVAL_MS', 15_000),
  shutdownTimeoutMs: integer('MONITOR_SHUTDOWN_TIMEOUT_MS', 15_000),
  flushTimeoutMs: integer('MONITOR_FLUSH_TIMEOUT_MS', 10_000),

  metrics: {
    enabled: bool('MONITOR_METRICS_ENABLED', true),
    prefix: string('MONITOR_METRICS_PREFIX', 'rawnode'),
    maxInstruments: integer('MONITOR_METRICS_MAX_INSTRUMENTS', 10_000),
    maxSeries: integer('MONITOR_METRICS_MAX_SERIES', 100_000),
    maxSeriesPerInstrument: integer('MONITOR_METRICS_MAX_SERIES_PER_INSTRUMENT', 2_000),
    maxLabels: integer('MONITOR_METRICS_MAX_LABELS', 24),
    maxLabelValueBytes: integer('MONITOR_METRICS_MAX_LABEL_VALUE_BYTES', 256),
    historyLimit: integer('MONITOR_METRICS_HISTORY', 720),
    exemplars: bool('MONITOR_METRICS_EXEMPLARS', true),
  },

  tracing: {
    enabled: bool('MONITOR_TRACING_ENABLED', true),
    sampleRate: number('MONITOR_TRACE_SAMPLE_RATE', production ? 0.05 : 1),
    parentBased: bool('MONITOR_TRACE_PARENT_BASED', true),
    maxAttributes: integer('MONITOR_TRACE_MAX_ATTRIBUTES', 64),
    maxAttributeBytes: integer('MONITOR_TRACE_MAX_ATTRIBUTE_BYTES', 4_096),
    maxEvents: integer('MONITOR_TRACE_MAX_EVENTS', 64),
    maxLinks: integer('MONITOR_TRACE_MAX_LINKS', 16),
    maxSpansInMemory: integer('MONITOR_TRACE_MAX_SPANS', 20_000),
    maxTraceAgeMs: integer('MONITOR_TRACE_MAX_AGE_MS', 15 * 60_000),
    captureStack: bool('MONITOR_TRACE_CAPTURE_STACK', !production),
    propagateBaggage: bool('MONITOR_TRACE_PROPAGATE_BAGGAGE', true),
  },

  pipeline: {
    maxItems: integer('MONITOR_PIPELINE_MAX_ITEMS', 50_000),
    maxBytes: integer('MONITOR_PIPELINE_MAX_BYTES', 64 * 1024 * 1024),
    maxWaiters: integer('MONITOR_PIPELINE_MAX_WAITERS', 100_000),
    batchSize: integer('MONITOR_PIPELINE_BATCH_SIZE', 512),
    flushIntervalMs: integer('MONITOR_PIPELINE_FLUSH_INTERVAL_MS', 500),
    budgetMs: number('MONITOR_PIPELINE_BUDGET_MS', 8),
    overflow: string('MONITOR_PIPELINE_OVERFLOW', 'drop-oldest'),
    maxSignalBytes: integer('MONITOR_PIPELINE_MAX_SIGNAL_BYTES', 2 * 1024 * 1024),
    maxInFlightBatches: integer('MONITOR_PIPELINE_MAX_IN_FLIGHT', 2),
    deliveryAttempts: integer('MONITOR_PIPELINE_DELIVERY_ATTEMPTS', 3),
    retryBaseMs: integer('MONITOR_PIPELINE_RETRY_BASE_MS', 50),
    retryMaxMs: integer('MONITOR_PIPELINE_RETRY_MAX_MS', 2_000),
    failureHistoryLimit: integer('MONITOR_PIPELINE_FAILURE_HISTORY', 256),
  },

  health: {
    enabled: bool('MONITOR_HEALTH_ENABLED', true),
    timeoutMs: integer('MONITOR_HEALTH_TIMEOUT_MS', 5_000),
    concurrency: integer('MONITOR_HEALTH_CONCURRENCY', 16),
    historyLimit: integer('MONITOR_HEALTH_HISTORY', 256),
    cacheTtlMs: integer('MONITOR_HEALTH_CACHE_TTL_MS', 1_000),
  },

  resources: {
    enabled: bool('MONITOR_RESOURCES_ENABLED', true),
    autoDiscover: bool('MONITOR_RESOURCES_AUTO_DISCOVER', true),
    intervalMs: integer('MONITOR_RESOURCES_INTERVAL_MS', 15_000),
    timeoutMs: integer('MONITOR_RESOURCES_TIMEOUT_MS', 5_000),
    maxPayloadBytes: integer('MONITOR_RESOURCES_MAX_PAYLOAD_BYTES', 512 * 1024),
    include: csv('MONITOR_RESOURCES_INCLUDE'),
    exclude: csv('MONITOR_RESOURCES_EXCLUDE'),
    required: csv('MONITOR_RESOURCES_REQUIRED'),
  },

  storage: {
    enabled: bool('MONITOR_STORAGE_ENABLED', production),
    driver: string('MONITOR_STORAGE_DRIVER', production ? 'rawmongo' : 'memory'),
    drivers: csv('MONITOR_STORAGE_DRIVERS'),
    queryStore: string('MONITOR_STORAGE_QUERY_STORE'),
    path: string('MONITOR_STORAGE_PATH', 'storage/framework/monitor'),
    maxMemoryItems: integer('MONITOR_STORAGE_MAX_MEMORY_ITEMS', 50_000),
    maxMemoryBytes: integer('MONITOR_STORAGE_MAX_MEMORY_BYTES', 128 * 1024 * 1024),
    maxFileBytes: integer('MONITOR_STORAGE_MAX_FILE_BYTES', 128 * 1024 * 1024),
    maxReadBytes: integer('MONITOR_STORAGE_MAX_READ_BYTES', 64 * 1024 * 1024),
    maxLineBytes: integer('MONITOR_STORAGE_MAX_LINE_BYTES', 2 * 1024 * 1024),
    retentionMs: integer('MONITOR_STORAGE_RETENTION_MS', 30 * 24 * 60 * 60_000),
    flushIntervalMs: integer('MONITOR_STORAGE_FLUSH_INTERVAL_MS', 1_000),
    collectionPrefix: string('MONITOR_STORAGE_COLLECTION_PREFIX', 'monitor_'),
    required: bool('MONITOR_STORAGE_REQUIRED', production),
  },

  exporters: {
    enabled: bool('MONITOR_EXPORTERS_ENABLED', true),
    failFast: bool('MONITOR_EXPORTERS_FAIL_FAST', false),
    prometheus: { enabled: bool('MONITOR_PROMETHEUS_ENABLED', true), prefix: string('MONITOR_PROMETHEUS_PREFIX', 'rawnode') },
    http: {
      enabled: bool('MONITOR_HTTP_EXPORT_ENABLED', false),
      url: string('MONITOR_HTTP_EXPORT_URL'),
      timeoutMs: integer('MONITOR_HTTP_EXPORT_TIMEOUT_MS', 10_000),
      compression: bool('MONITOR_HTTP_EXPORT_COMPRESSION', true),
      compressionThresholdBytes: integer('MONITOR_HTTP_EXPORT_COMPRESSION_THRESHOLD_BYTES', 1_024),
      maxAttempts: integer('MONITOR_HTTP_EXPORT_MAX_ATTEMPTS', 3),
      retryBaseMs: integer('MONITOR_HTTP_EXPORT_RETRY_BASE_MS', 100),
      retryMaxMs: integer('MONITOR_HTTP_EXPORT_RETRY_MAX_MS', 5_000),
      maxPayloadBytes: integer('MONITOR_HTTP_EXPORT_MAX_PAYLOAD_BYTES', 8 * 1024 * 1024),
      maxResponseBytes: integer('MONITOR_HTTP_EXPORT_MAX_RESPONSE_BYTES', 64 * 1024),
      maxBatchSignals: integer('MONITOR_HTTP_EXPORT_MAX_BATCH_SIGNALS', 256),
      rejectUnauthorized: bool('MONITOR_HTTP_EXPORT_TLS_VERIFY', true),
      secret: string('MONITOR_HTTP_EXPORT_SECRET'),
      required: bool('MONITOR_HTTP_EXPORT_REQUIRED', false),
    },
    otlp: {
      enabled: bool('MONITOR_OTLP_ENABLED', false),
      url: string('MONITOR_OTLP_URL'),
      timeoutMs: integer('MONITOR_OTLP_TIMEOUT_MS', 10_000),
      compression: bool('MONITOR_OTLP_COMPRESSION', true),
      maxAttempts: integer('MONITOR_OTLP_MAX_ATTEMPTS', 3),
      retryBaseMs: integer('MONITOR_OTLP_RETRY_BASE_MS', 100),
      retryMaxMs: integer('MONITOR_OTLP_RETRY_MAX_MS', 5_000),
      maxPayloadBytes: integer('MONITOR_OTLP_MAX_PAYLOAD_BYTES', 8 * 1024 * 1024),
      maxResponseBytes: integer('MONITOR_OTLP_MAX_RESPONSE_BYTES', 64 * 1024),
      maxBatchSignals: integer('MONITOR_OTLP_MAX_BATCH_SIGNALS', 256),
      rejectUnauthorized: bool('MONITOR_OTLP_TLS_VERIFY', true),
      headers: {},
      required: bool('MONITOR_OTLP_REQUIRED', false),
    },
    statsd: {
      enabled: bool('MONITOR_STATSD_ENABLED', false),
      host: string('MONITOR_STATSD_HOST', '127.0.0.1'),
      port: integer('MONITOR_STATSD_PORT', 8125),
      prefix: string('MONITOR_STATSD_PREFIX', 'rawnode'),
      maxPacketBytes: integer('MONITOR_STATSD_MAX_PACKET_BYTES', 8_192),
    },
  },

  alerts: {
    enabled: bool('MONITOR_ALERTS_ENABLED', true),
    intervalMs: integer('MONITOR_ALERTS_INTERVAL_MS', 15_000),
    concurrency: integer('MONITOR_ALERTS_CONCURRENCY', 8),
    historyLimit: integer('MONITOR_ALERTS_HISTORY', 5_000),
    defaultPendingForMs: integer('MONITOR_ALERT_PENDING_MS', 0),
    defaultResolveAfterMs: integer('MONITOR_ALERT_RESOLVE_MS', 0),
    defaultCooldownMs: integer('MONITOR_ALERT_COOLDOWN_MS', 5 * 60_000),
    autoIncidentSeverities: csv('MONITOR_ALERT_INCIDENT_SEVERITIES', ['critical']),
  },

  slo: {
    enabled: bool('MONITOR_SLO_ENABLED', true),
    intervalMs: integer('MONITOR_SLO_INTERVAL_MS', 60_000),
    historyLimit: integer('MONITOR_SLO_HISTORY', 44_640),
  },

  incidents: {
    enabled: bool('MONITOR_INCIDENTS_ENABLED', true),
    maxOpen: integer('MONITOR_INCIDENTS_MAX_OPEN', 10_000),
    historyLimit: integer('MONITOR_INCIDENTS_HISTORY', 20_000),
    captureDiagnostics: bool('MONITOR_INCIDENTS_CAPTURE_DIAGNOSTICS', true),
    diagnosticsTimeoutMs: integer('MONITOR_INCIDENTS_DIAGNOSTICS_TIMEOUT_MS', 10_000),
    path: string('MONITOR_INCIDENTS_PATH', 'storage/framework/monitor/incidents'),
  },

  system: {
    enabled: bool('MONITOR_SYSTEM_ENABLED', true),
    eventLoopResolutionMs: integer('MONITOR_EVENT_LOOP_RESOLUTION_MS', 20),
    gc: bool('MONITOR_GC_ENABLED', true),
    activeResources: bool('MONITOR_ACTIVE_RESOURCES_ENABLED', true),
    resourceUsage: bool('MONITOR_RESOURCE_USAGE_ENABLED', true),
  },

  analysis: {
    enabled: bool('MONITOR_ANALYSIS_ENABLED', true),
    defaults: bool('MONITOR_ANALYSIS_DEFAULTS', true),
    maxRules: integer('MONITOR_ANALYSIS_MAX_RULES', 1_000),
    maxSeries: integer('MONITOR_ANALYSIS_MAX_SERIES', 10_000),
    baselineSamples: integer('MONITOR_ANALYSIS_BASELINE_SAMPLES', 256),
    warmupSamples: integer('MONITOR_ANALYSIS_WARMUP_SAMPLES', 20),
    alpha: number('MONITOR_ANALYSIS_ALPHA', 0.2),
    cooldownMs: integer('MONITOR_ANALYSIS_COOLDOWN_MS', 5 * 60_000),
    emitRecoveries: bool('MONITOR_ANALYSIS_RECOVERIES', true),
    correlationWindowMs: integer('MONITOR_CORRELATION_WINDOW_MS', 15 * 60_000),
    correlationMaxCandidates: integer('MONITOR_CORRELATION_MAX_CANDIDATES', 10_000),
    rules: [],
    leakRules: [],
  },

  synthetics: {
    enabled: bool('MONITOR_SYNTHETICS_ENABLED', false),
    concurrency: integer('MONITOR_SYNTHETICS_CONCURRENCY', 8),
    maxChecks: integer('MONITOR_SYNTHETICS_MAX_CHECKS', 10_000),
    intervalMs: integer('MONITOR_SYNTHETICS_INTERVAL_MS', 60_000),
    timeoutMs: integer('MONITOR_SYNTHETICS_TIMEOUT_MS', 10_000),
    historyLimit: integer('MONITOR_SYNTHETICS_HISTORY', 5_000),
    maxResponseBytes: integer('MONITOR_SYNTHETICS_MAX_RESPONSE_BYTES', 256 * 1024),
    checks: [],
  },

  plugins: {
    enabled: bool('MONITOR_PLUGINS_ENABLED', true),
    maxPlugins: integer('MONITOR_PLUGINS_MAX', 1_000),
    errorPolicy: string('MONITOR_PLUGINS_ERROR_POLICY', 'isolate'),
    maxPendingHooks: integer('MONITOR_PLUGINS_MAX_PENDING_HOOKS', 10_000),
    maxPendingBytes: integer('MONITOR_PLUGINS_MAX_PENDING_BYTES', 16 * 1024 * 1024),
    maxHookBytes: integer('MONITOR_PLUGINS_MAX_HOOK_BYTES', 1024 * 1024),
    hookBatchSize: integer('MONITOR_PLUGINS_HOOK_BATCH_SIZE', 128),
    hookBudgetMs: number('MONITOR_PLUGINS_HOOK_BUDGET_MS', 4),
    hookOverflow: string('MONITOR_PLUGINS_HOOK_OVERFLOW', 'drop-oldest'),
  },

  security: {
    redact: bool('MONITOR_REDACT', true),
    secretKeys: csv('MONITOR_SECRET_KEYS'),
    hashTenantIds: bool('MONITOR_HASH_TENANT_IDS', false),
    hashUserIds: bool('MONITOR_HASH_USER_IDS', false),
    maxDepth: integer('MONITOR_MAX_DEPTH', 16),
    maxKeys: integer('MONITOR_MAX_KEYS', 4_096),
    maxArrayItems: integer('MONITOR_MAX_ARRAY_ITEMS', 10_000),
    maxStringBytes: integer('MONITOR_MAX_STRING_BYTES', 64 * 1024),
    maxPayloadBytes: integer('MONITOR_MAX_PAYLOAD_BYTES', 2 * 1024 * 1024),
    ingestSecret: string('MONITOR_INGEST_SECRET'),
    allowRemoteIngest: bool('MONITOR_REMOTE_INGEST', false),
    allowedOrigins: csv('MONITOR_ALLOWED_ORIGINS'),
  },

  studio: {
    enabled: bool('MONITOR_STUDIO_ENABLED', !production),
    prefix: string('MONITOR_STUDIO_PREFIX', '/__rawnode/monitor'),
    production: bool('MONITOR_STUDIO_PRODUCTION', false),
    token: string('MONITOR_STUDIO_TOKEN'),
    localOnly: bool('MONITOR_STUDIO_LOCAL_ONLY', true),
    pollIntervalMs: integer('MONITOR_STUDIO_POLL_INTERVAL_MS', 3_000),
    maxQueryLimit: integer('MONITOR_STUDIO_MAX_QUERY_LIMIT', 1_000),
    registerRoutes: bool('MONITOR_STUDIO_REGISTER_ROUTES', true),
    streamMaxBytes: integer('MONITOR_STUDIO_STREAM_MAX_BYTES', 1024 * 1024),
    eventQueueItems: integer('MONITOR_STUDIO_EVENT_QUEUE_ITEMS', 2_000),
    eventQueueBytes: integer('MONITOR_STUDIO_EVENT_QUEUE_BYTES', 2 * 1024 * 1024),
    eventMaxBytes: integer('MONITOR_STUDIO_EVENT_MAX_BYTES', 64 * 1024),
    eventBatchSize: integer('MONITOR_STUDIO_EVENT_BATCH_SIZE', 100),
    eventBudgetMs: number('MONITOR_STUDIO_EVENT_BUDGET_MS', 4),
    rateLimit: {
      capacity: integer('MONITOR_STUDIO_RATE_CAPACITY', 120),
      refillPerSecond: number('MONITOR_STUDIO_RATE_REFILL', 20),
      maxKeys: integer('MONITOR_STUDIO_RATE_MAX_KEYS', 10_000),
      idleTtlMs: integer('MONITOR_STUDIO_RATE_IDLE_TTL_MS', 5 * 60_000),
    },
  },

  integrations: {
    logger: bool('MONITOR_INTEGRATE_LOGGER', true),
    events: bool('MONITOR_INTEGRATE_EVENTS', true),
    pm: bool('MONITOR_INTEGRATE_PM', true),
    http: {
      enabled: bool('MONITOR_INTEGRATE_HTTP', true),
      autoRegister: bool('MONITOR_HTTP_AUTO_REGISTER', true),
      exposeTraceId: bool('MONITOR_HTTP_EXPOSE_TRACE_ID', false),
      propagateResponseTrace: bool('MONITOR_HTTP_PROPAGATE_RESPONSE_TRACE', false),
      trustProxy: bool('MONITOR_HTTP_TRUST_PROXY', false),
      captureUserAgent: bool('MONITOR_HTTP_CAPTURE_USER_AGENT', false),
      exclude: csv('MONITOR_HTTP_EXCLUDE', ['/favicon.ico']),
    },
    websocket: bool('MONITOR_INTEGRATE_WEBSOCKET', true),
    tcp: bool('MONITOR_INTEGRATE_TCP', true),
    udp: bool('MONITOR_INTEGRATE_UDP', true),
    unified: bool('MONITOR_INTEGRATE_UNIFIED', true),
    rawmongo: bool('MONITOR_INTEGRATE_RAWMONGO', true),
    redis: bool('MONITOR_INTEGRATE_REDIS', true),
  },

  cluster: {
    enabled: bool('MONITOR_CLUSTER_ENABLED', false),
    mode: string('MONITOR_CLUSTER_MODE', 'standalone'),
    heartbeatMs: integer('MONITOR_CLUSTER_HEARTBEAT_MS', 10_000),
    leaseMs: integer('MONITOR_CLUSTER_LEASE_MS', 30_000),
    channel: string('MONITOR_CLUSTER_CHANNEL', 'rawnode:monitor:cluster'),
    secret: string('MONITOR_CLUSTER_SECRET'),
  },
};
