'use strict';

import path from 'node:path';
import { resolveMonitorCompatibilityProfile } from '../compatibility/CompatibilityProfile.js';
import { MonitorConfigurationError } from '../errors.js';
import { bool, boundedInteger, boundedNumber, deepFreeze, isPlainObject, list, parseBytes, parseDuration } from '../support.js';

const PROFILES = new Set(['compat', 'enterprise', 'production', 'strict', 'test']);
const OVERFLOW = new Set(['drop-new', 'drop-oldest', 'reject', 'block']);
const STORAGE_DRIVERS = new Set(['memory', 'file', 'rawmongo', 'composite', 'none']);

const DEFAULTS = Object.freeze({
  enabled: true,
  profile: 'compat',
  service: 'rawnode',
  environment: 'development',
  version: null,
  instanceId: null,
  region: null,
  zone: null,
  tenant: null,
  bootSummary: true,
  failFast: null,
  collectionIntervalMs: 10_000,
  resourceIntervalMs: 15_000,
  shutdownTimeoutMs: 15_000,
  flushTimeoutMs: 10_000,
  metrics: Object.freeze({
    enabled: null,
    prefix: 'rawnode',
    maxInstruments: 10_000,
    maxSeries: 100_000,
    maxSeriesPerInstrument: 2_000,
    maxLabels: 24,
    maxLabelValueBytes: 256,
    histogramBuckets: null,
    historyLimit: 720,
    exemplars: true,
  }),
  tracing: Object.freeze({
    enabled: null,
    sampleRate: null,
    parentBased: true,
    maxAttributes: 64,
    maxAttributeBytes: 4_096,
    maxEvents: 64,
    maxLinks: 16,
    maxSpansInMemory: 20_000,
    maxTraceAgeMs: 15 * 60_000,
    captureStack: false,
    propagateBaggage: true,
  }),
  pipeline: Object.freeze({
    maxItems: 50_000,
    maxBytes: 64 * 1024 * 1024,
    maxWaiters: 100_000,
    batchSize: 512,
    flushIntervalMs: 500,
    budgetMs: 8,
    overflow: 'drop-oldest',
    maxSignalBytes: 2 * 1024 * 1024,
    maxInFlightBatches: 2,
    deliveryAttempts: 3,
    retryBaseMs: 50,
    retryMaxMs: 2_000,
    failureHistoryLimit: 256,
  }),
  health: Object.freeze({
    enabled: true,
    timeoutMs: 5_000,
    concurrency: 16,
    historyLimit: 256,
    cacheTtlMs: 1_000,
  }),
  resources: Object.freeze({
    enabled: true,
    autoDiscover: true,
    intervalMs: 15_000,
    timeoutMs: 5_000,
    maxPayloadBytes: 512 * 1024,
    include: Object.freeze([]),
    exclude: Object.freeze([]),
    required: Object.freeze([]),
  }),
  storage: Object.freeze({
    enabled: null,
    driver: 'memory',
    drivers: Object.freeze([]),
    queryStore: null,
    path: 'storage/framework/monitor',
    maxMemoryItems: 50_000,
    maxMemoryBytes: 128 * 1024 * 1024,
    maxFileBytes: 128 * 1024 * 1024,
    maxReadBytes: 64 * 1024 * 1024,
    maxLineBytes: 2 * 1024 * 1024,
    retentionMs: 30 * 24 * 60 * 60_000,
    flushIntervalMs: 1_000,
    collectionPrefix: 'monitor_',
    required: false,
  }),
  exporters: Object.freeze({
    enabled: true,
    failFast: null,
    prometheus: Object.freeze({ enabled: true, prefix: 'rawnode' }),
    http: Object.freeze({
      enabled: false,
      url: null,
      timeoutMs: 10_000,
      compression: true,
      compressionThresholdBytes: 1_024,
      maxAttempts: 3,
      retryBaseMs: 100,
      retryMaxMs: 5_000,
      maxPayloadBytes: 8 * 1024 * 1024,
      maxResponseBytes: 64 * 1024,
      maxBatchSignals: 256,
      rejectUnauthorized: true,
      required: false,
    }),
    otlp: Object.freeze({
      enabled: false,
      url: null,
      timeoutMs: 10_000,
      compression: true,
      maxAttempts: 3,
      maxPayloadBytes: 8 * 1024 * 1024,
      maxResponseBytes: 64 * 1024,
      maxBatchSignals: 256,
      rejectUnauthorized: true,
      required: false,
      headers: Object.freeze({}),
    }),
    statsd: Object.freeze({ enabled: false, host: '127.0.0.1', port: 8125, prefix: 'rawnode', maxPacketBytes: 8_192 }),
  }),
  alerts: Object.freeze({
    enabled: null,
    intervalMs: 15_000,
    concurrency: 8,
    historyLimit: 5_000,
    defaultPendingForMs: 0,
    defaultResolveAfterMs: 0,
    defaultCooldownMs: 5 * 60_000,
    autoIncidentSeverities: Object.freeze(['critical']),
  }),
  slo: Object.freeze({ enabled: null, intervalMs: 60_000, historyLimit: 44_640 }),
  incidents: Object.freeze({ enabled: null, maxOpen: 10_000, historyLimit: 20_000, captureDiagnostics: true, diagnosticsTimeoutMs: 10_000 }),
  system: Object.freeze({
    enabled: null,
    eventLoopResolutionMs: 20,
    gc: true,
    activeResources: true,
    resourceUsage: true,
  }),
  analysis: Object.freeze({
    enabled: null,
    defaults: true,
    maxRules: 1_000,
    maxSeries: 10_000,
    baselineSamples: 256,
    warmupSamples: 20,
    alpha: 0.2,
    cooldownMs: 5 * 60_000,
    emitRecoveries: true,
    rules: Object.freeze([]),
    leakRules: Object.freeze([]),
    correlationWindowMs: 15 * 60_000,
    correlationMaxCandidates: 10_000,
  }),
  synthetics: Object.freeze({
    enabled: null,
    concurrency: 8,
    maxChecks: 10_000,
    intervalMs: 60_000,
    timeoutMs: 10_000,
    historyLimit: 5_000,
    maxResponseBytes: 256 * 1024,
    checks: Object.freeze([]),
  }),
  plugins: Object.freeze({
    enabled: null,
    maxPlugins: 1_000,
    errorPolicy: 'isolate',
    maxPendingHooks: 10_000,
    maxPendingBytes: 16 * 1024 * 1024,
    maxHookBytes: 1024 * 1024,
    hookBatchSize: 128,
    hookBudgetMs: 4,
    hookOverflow: 'drop-oldest',
  }),
  security: Object.freeze({
    redact: true,
    secretKeys: Object.freeze([]),
    hashTenantIds: false,
    hashUserIds: false,
    maxDepth: 16,
    maxKeys: 4_096,
    maxArrayItems: 10_000,
    maxStringBytes: 64 * 1024,
    maxPayloadBytes: 2 * 1024 * 1024,
    ingestSecret: null,
    allowRemoteIngest: false,
    allowedOrigins: Object.freeze([]),
  }),
  studio: Object.freeze({
    enabled: null,
    prefix: '/__rawnode/monitor',
    production: false,
    token: null,
    localOnly: true,
    pollIntervalMs: 3_000,
    maxQueryLimit: 1_000,
    metricsEndpoint: '/metrics',
    registerRoutes: true,
    streamMaxBytes: 1024 * 1024,
    eventQueueItems: 2_000,
    eventQueueBytes: 2 * 1024 * 1024,
    eventMaxBytes: 64 * 1024,
    eventBatchSize: 100,
    eventBudgetMs: 4,
    rateLimit: Object.freeze({ capacity: 120, refillPerSecond: 20, maxKeys: 10_000, idleTtlMs: 5 * 60_000 }),
  }),
  integrations: Object.freeze({
    logger: true,
    events: true,
    pm: true,
    http: true,
    protocols: true,
    rawmongo: true,
    redis: true,
  }),
  cluster: Object.freeze({ enabled: false, mode: 'standalone', heartbeatMs: 10_000, leaseMs: 30_000 }),
});

function merge(base, overlay) {
  const output = { ...(isPlainObject(base) ? base : {}) };
  for (const [key, value] of Object.entries(isPlainObject(overlay) ? overlay : {})) {
    output[key] = isPlainObject(value) && isPlainObject(output[key]) ? merge(output[key], value) : value;
  }
  return output;
}

export class MonitorConfiguration {
  constructor(input = {}, options = {}) {
    const source = merge(DEFAULTS, input);
    const requested = String(source.profile || options.profile || DEFAULTS.profile).toLowerCase();
    if (!PROFILES.has(requested)) throw new MonitorConfigurationError(`Unsupported Monitor profile '${requested}'.`, { details: { supported: [...PROFILES] } });
    const profile = resolveMonitorCompatibilityProfile(requested, options.profileOverrides);
    const environment = String(source.environment || process.env.APP_ENV || process.env.NODE_ENV || 'development').toLowerCase();
    const production = environment === 'production' || environment === 'prod';
    const root = path.resolve(options.root || source.root || process.cwd());
    const overflow = String(source.pipeline?.overflow || profile.queueOverflow);
    if (!OVERFLOW.has(overflow)) throw new MonitorConfigurationError(`Unsupported monitor queue overflow policy '${overflow}'.`);
    const storageDriver = String(source.storage?.driver || 'memory').toLowerCase();
    if (!STORAGE_DRIVERS.has(storageDriver)) throw new MonitorConfigurationError(`Unsupported monitor storage driver '${storageDriver}'.`);

    this.value = deepFreeze({
      ...source,
      enabled: bool(source.enabled, true),
      profile: profile.name,
      compatibility: profile,
      root,
      service: String(source.service || process.env.APP_NAME || 'rawnode'),
      environment,
      production,
      bootSummary: bool(source.bootSummary, true),
      failFast: bool(source.failFast, profile.failFast),
      collectionIntervalMs: parseDuration(source.collectionIntervalMs, 10_000, 250, 3_600_000),
      resourceIntervalMs: parseDuration(source.resourceIntervalMs, 15_000, 250, 3_600_000),
      shutdownTimeoutMs: parseDuration(source.shutdownTimeoutMs, 15_000, 100, 600_000),
      flushTimeoutMs: parseDuration(source.flushTimeoutMs, 10_000, 100, 600_000),
      metrics: deepFreeze({
        ...source.metrics,
        enabled: bool(source.metrics?.enabled, profile.metricsEnabled),
        prefix: String(source.metrics?.prefix || 'rawnode'),
        maxInstruments: boundedInteger(source.metrics?.maxInstruments, 10_000, 1, 1_000_000),
        maxSeries: boundedInteger(source.metrics?.maxSeries, 100_000, 1, 10_000_000),
        maxSeriesPerInstrument: boundedInteger(source.metrics?.maxSeriesPerInstrument, 2_000, 1, 1_000_000),
        maxLabels: boundedInteger(source.metrics?.maxLabels, 24, 0, 256),
        maxLabelValueBytes: parseBytes(source.metrics?.maxLabelValueBytes, 256, 1, 64 * 1024),
        historyLimit: boundedInteger(source.metrics?.historyLimit, 720, 1, 1_000_000),
        exemplars: bool(source.metrics?.exemplars, true),
      }),
      tracing: deepFreeze({
        ...source.tracing,
        enabled: bool(source.tracing?.enabled, profile.tracingEnabled),
        sampleRate: boundedNumber(
          source.tracing?.sampleRate == null
            ? (production ? 0.05 : (profile.name === 'enterprise' ? 0.1 : 1))
            : source.tracing.sampleRate,
          production ? 0.05 : (profile.name === 'enterprise' ? 0.1 : 1),
          0,
          1,
        ),
        parentBased: bool(source.tracing?.parentBased, true),
        maxAttributes: boundedInteger(source.tracing?.maxAttributes, 64, 0, 4_096),
        maxAttributeBytes: parseBytes(source.tracing?.maxAttributeBytes, 4_096, 16, 1024 * 1024),
        maxEvents: boundedInteger(source.tracing?.maxEvents, 64, 0, 10_000),
        maxLinks: boundedInteger(source.tracing?.maxLinks, 16, 0, 10_000),
        maxSpansInMemory: boundedInteger(source.tracing?.maxSpansInMemory, 20_000, 1, 10_000_000),
        maxTraceAgeMs: parseDuration(source.tracing?.maxTraceAgeMs, 15 * 60_000, 1_000, 30 * 24 * 60 * 60_000),
        captureStack: bool(source.tracing?.captureStack, profile.captureErrorStacks),
        propagateBaggage: bool(source.tracing?.propagateBaggage, true),
      }),
      pipeline: deepFreeze({
        ...source.pipeline,
        maxItems: boundedInteger(source.pipeline?.maxItems, 50_000, 1, 10_000_000),
        maxBytes: parseBytes(source.pipeline?.maxBytes, 64 * 1024 * 1024, 1_024, 16 * 1024 * 1024 * 1024),
        maxWaiters: boundedInteger(source.pipeline?.maxWaiters, 100_000, 1, 10_000_000),
        batchSize: boundedInteger(source.pipeline?.batchSize, 512, 1, 100_000),
        flushIntervalMs: parseDuration(source.pipeline?.flushIntervalMs, 500, 1, 60_000),
        budgetMs: boundedNumber(source.pipeline?.budgetMs, 8, 0.25, 1_000),
        overflow,
        maxSignalBytes: parseBytes(source.pipeline?.maxSignalBytes, 2 * 1024 * 1024, 256, 256 * 1024 * 1024),
        maxInFlightBatches: boundedInteger(source.pipeline?.maxInFlightBatches, 2, 1, 64),
        deliveryAttempts: boundedInteger(source.pipeline?.deliveryAttempts, 3, 1, 100),
        retryBaseMs: parseDuration(source.pipeline?.retryBaseMs, 50, 0, 60_000),
        retryMaxMs: parseDuration(source.pipeline?.retryMaxMs, 2_000, 0, 300_000),
        failureHistoryLimit: boundedInteger(source.pipeline?.failureHistoryLimit, 256, 1, 100_000),
      }),
      health: deepFreeze({
        ...source.health,
        enabled: bool(source.health?.enabled, true),
        timeoutMs: parseDuration(source.health?.timeoutMs, 5_000, 10, 300_000),
        concurrency: boundedInteger(source.health?.concurrency, 16, 1, 1_024),
        historyLimit: boundedInteger(source.health?.historyLimit, 256, 1, 100_000),
        cacheTtlMs: parseDuration(source.health?.cacheTtlMs, 1_000, 0, 300_000),
      }),
      resources: deepFreeze({
        ...source.resources,
        enabled: bool(source.resources?.enabled, true),
        autoDiscover: bool(source.resources?.autoDiscover, true),
        intervalMs: parseDuration(source.resources?.intervalMs, source.resourceIntervalMs || 15_000, 250, 3_600_000),
        timeoutMs: parseDuration(source.resources?.timeoutMs, 5_000, 10, 300_000),
        maxPayloadBytes: parseBytes(source.resources?.maxPayloadBytes, 512 * 1024, 1_024, 64 * 1024 * 1024),
        include: Object.freeze(list(source.resources?.include)),
        exclude: Object.freeze(list(source.resources?.exclude)),
        required: Object.freeze(list(source.resources?.required)),
      }),
      storage: deepFreeze({
        ...source.storage,
        enabled: bool(source.storage?.enabled, profile.persistenceEnabled),
        driver: storageDriver,
        drivers: Object.freeze(list(source.storage?.drivers)),
        queryStore: source.storage?.queryStore ? String(source.storage.queryStore) : null,
        path: path.resolve(root, source.storage?.path || 'storage/framework/monitor'),
        maxMemoryItems: boundedInteger(source.storage?.maxMemoryItems, 50_000, 1, 10_000_000),
        maxMemoryBytes: parseBytes(source.storage?.maxMemoryBytes, 128 * 1024 * 1024, 1_024, 16 * 1024 * 1024 * 1024),
        maxFileBytes: parseBytes(source.storage?.maxFileBytes, 128 * 1024 * 1024, 1_024, 16 * 1024 * 1024 * 1024),
        maxReadBytes: parseBytes(source.storage?.maxReadBytes, 64 * 1024 * 1024, 1_024, 4 * 1024 * 1024 * 1024),
        maxLineBytes: parseBytes(source.storage?.maxLineBytes, 2 * 1024 * 1024, 1_024, 256 * 1024 * 1024),
        retentionMs: parseDuration(source.storage?.retentionMs, 30 * 24 * 60 * 60_000, 60_000, 10 * 365 * 24 * 60 * 60_000),
        flushIntervalMs: parseDuration(source.storage?.flushIntervalMs, 1_000, 1, 60_000),
        collectionPrefix: String(source.storage?.collectionPrefix || 'monitor_'),
        required: bool(source.storage?.required, false),
      }),
      exporters: normalizeExporters(source.exporters, profile),
      alerts: deepFreeze({
        ...source.alerts,
        enabled: bool(source.alerts?.enabled, profile.alertsEnabled),
        intervalMs: parseDuration(source.alerts?.intervalMs, 15_000, 250, 3_600_000),
        concurrency: boundedInteger(source.alerts?.concurrency, 8, 1, 1_024),
        historyLimit: boundedInteger(source.alerts?.historyLimit, 5_000, 1, 1_000_000),
        defaultPendingForMs: parseDuration(source.alerts?.defaultPendingForMs, 0, 0, 30 * 24 * 60 * 60_000),
        defaultResolveAfterMs: parseDuration(source.alerts?.defaultResolveAfterMs, 0, 0, 30 * 24 * 60 * 60_000),
        defaultCooldownMs: parseDuration(source.alerts?.defaultCooldownMs, 5 * 60_000, 0, 30 * 24 * 60 * 60_000),
        autoIncidentSeverities: Object.freeze(list(source.alerts?.autoIncidentSeverities, ['critical'])),
      }),
      slo: deepFreeze({ ...source.slo, enabled: bool(source.slo?.enabled, profile.sloEnabled), intervalMs: parseDuration(source.slo?.intervalMs, 60_000, 1_000, 3_600_000), historyLimit: boundedInteger(source.slo?.historyLimit, 44_640, 1, 10_000_000) }),
      incidents: deepFreeze({ ...source.incidents, enabled: bool(source.incidents?.enabled, profile.incidentsEnabled), maxOpen: boundedInteger(source.incidents?.maxOpen, 10_000, 1, 1_000_000), historyLimit: boundedInteger(source.incidents?.historyLimit, 20_000, 1, 1_000_000), captureDiagnostics: bool(source.incidents?.captureDiagnostics, true), diagnosticsTimeoutMs: parseDuration(source.incidents?.diagnosticsTimeoutMs, 10_000, 100, 300_000) }),
      system: deepFreeze({ ...source.system, enabled: bool(source.system?.enabled, profile.systemMetricsEnabled), eventLoopResolutionMs: boundedInteger(source.system?.eventLoopResolutionMs, 20, 10, 1_000), gc: bool(source.system?.gc, true), activeResources: bool(source.system?.activeResources, true), resourceUsage: bool(source.system?.resourceUsage, true) }),
      analysis: deepFreeze({
        ...source.analysis,
        enabled: bool(source.analysis?.enabled, profile.analysisEnabled),
        defaults: bool(source.analysis?.defaults, true),
        maxRules: boundedInteger(source.analysis?.maxRules, 1_000, 1, 100_000),
        maxSeries: boundedInteger(source.analysis?.maxSeries, 10_000, 1, 1_000_000),
        baselineSamples: boundedInteger(source.analysis?.baselineSamples, 256, 4, 100_000),
        warmupSamples: boundedInteger(source.analysis?.warmupSamples, 20, 2, 100_000),
        alpha: boundedNumber(source.analysis?.alpha, 0.2, 0.001, 1),
        cooldownMs: parseDuration(source.analysis?.cooldownMs, 5 * 60_000, 0, 24 * 60 * 60_000),
        emitRecoveries: bool(source.analysis?.emitRecoveries, true),
        rules: Object.freeze(Array.isArray(source.analysis?.rules) ? [...source.analysis.rules] : []),
        leakRules: Object.freeze(Array.isArray(source.analysis?.leakRules) ? [...source.analysis.leakRules] : []),
        correlationWindowMs: parseDuration(source.analysis?.correlationWindowMs, 15 * 60_000, 1_000, 30 * 24 * 60 * 60_000),
        correlationMaxCandidates: boundedInteger(source.analysis?.correlationMaxCandidates, 10_000, 10, 1_000_000),
      }),
      synthetics: deepFreeze({
        ...source.synthetics,
        enabled: bool(source.synthetics?.enabled, profile.syntheticsEnabled),
        concurrency: boundedInteger(source.synthetics?.concurrency, 8, 1, 1_024),
        maxChecks: boundedInteger(source.synthetics?.maxChecks, 10_000, 1, 100_000),
        intervalMs: parseDuration(source.synthetics?.intervalMs, 60_000, 1_000, 24 * 60 * 60_000),
        timeoutMs: parseDuration(source.synthetics?.timeoutMs, 10_000, 100, 10 * 60_000),
        historyLimit: boundedInteger(source.synthetics?.historyLimit, 5_000, 1, 1_000_000),
        maxResponseBytes: parseBytes(source.synthetics?.maxResponseBytes, 256 * 1024, 1_024, 64 * 1024 * 1024),
        checks: Object.freeze(Array.isArray(source.synthetics?.checks) ? [...source.synthetics.checks] : []),
      }),
      plugins: deepFreeze({
        ...source.plugins,
        enabled: bool(source.plugins?.enabled, profile.pluginsEnabled),
        maxPlugins: boundedInteger(source.plugins?.maxPlugins, 1_000, 1, 100_000),
        errorPolicy: ['isolate', 'propagate'].includes(String(source.plugins?.errorPolicy)) ? String(source.plugins.errorPolicy) : profile.exporterErrorPolicy,
        maxPendingHooks: boundedInteger(source.plugins?.maxPendingHooks, 10_000, 1, 1_000_000),
        maxPendingBytes: parseBytes(source.plugins?.maxPendingBytes, 16 * 1024 * 1024, 1_024, 1024 * 1024 * 1024),
        maxHookBytes: parseBytes(source.plugins?.maxHookBytes, 1024 * 1024, 256, 64 * 1024 * 1024),
        hookBatchSize: boundedInteger(source.plugins?.hookBatchSize, 128, 1, 10_000),
        hookBudgetMs: boundedNumber(source.plugins?.hookBudgetMs, 4, 0.25, 1_000),
        hookOverflow: ['drop-new', 'drop-oldest'].includes(String(source.plugins?.hookOverflow)) ? String(source.plugins.hookOverflow) : 'drop-oldest',
      }),
      security: deepFreeze({
        ...source.security,
        redact: bool(source.security?.redact, true),
        secretKeys: Object.freeze(list(source.security?.secretKeys)),
        hashTenantIds: bool(source.security?.hashTenantIds, false),
        hashUserIds: bool(source.security?.hashUserIds, false),
        maxDepth: boundedInteger(source.security?.maxDepth, 16, 1, 128),
        maxKeys: boundedInteger(source.security?.maxKeys, 4_096, 1, 1_000_000),
        maxArrayItems: boundedInteger(source.security?.maxArrayItems, 10_000, 1, 1_000_000),
        maxStringBytes: parseBytes(source.security?.maxStringBytes, 64 * 1024, 16, 16 * 1024 * 1024),
        maxPayloadBytes: parseBytes(source.security?.maxPayloadBytes, 2 * 1024 * 1024, 1_024, 256 * 1024 * 1024),
        allowRemoteIngest: bool(source.security?.allowRemoteIngest, false),
        allowedOrigins: Object.freeze(list(source.security?.allowedOrigins)),
      }),
      studio: deepFreeze({
        ...source.studio,
        enabled: bool(source.studio?.enabled, profile.studioDefaultEnabled) && (!production || bool(source.studio?.production, profile.studioProductionEnabled)),
        production: bool(source.studio?.production, false),
        prefix: normalizePrefix(source.studio?.prefix || '/__rawnode/monitor'),
        localOnly: bool(source.studio?.localOnly, true),
        pollIntervalMs: parseDuration(source.studio?.pollIntervalMs, 3_000, 500, 60_000),
        maxQueryLimit: boundedInteger(source.studio?.maxQueryLimit, 1_000, 1, 100_000),
        metricsEndpoint: normalizePrefix(source.studio?.metricsEndpoint || '/metrics'),
        registerRoutes: bool(source.studio?.registerRoutes, true),
        streamMaxBytes: parseBytes(source.studio?.streamMaxBytes, 1024 * 1024, 1_024, 64 * 1024 * 1024),
        eventQueueItems: boundedInteger(source.studio?.eventQueueItems, 2_000, 1, 1_000_000),
        eventQueueBytes: parseBytes(source.studio?.eventQueueBytes, 2 * 1024 * 1024, 1_024, 256 * 1024 * 1024),
        eventMaxBytes: parseBytes(source.studio?.eventMaxBytes, 64 * 1024, 256, 16 * 1024 * 1024),
        eventBatchSize: boundedInteger(source.studio?.eventBatchSize, 100, 1, 10_000),
        eventBudgetMs: boundedNumber(source.studio?.eventBudgetMs, 4, 0.25, 1_000),
        rateLimit: deepFreeze({
          capacity: boundedInteger(source.studio?.rateLimit?.capacity, 120, 1, 1_000_000),
          refillPerSecond: boundedNumber(source.studio?.rateLimit?.refillPerSecond, 20, 0.001, 100_000),
          maxKeys: boundedInteger(source.studio?.rateLimit?.maxKeys, 10_000, 1, 1_000_000),
          idleTtlMs: parseDuration(source.studio?.rateLimit?.idleTtlMs, 5 * 60_000, 1_000, 30 * 24 * 60 * 60_000),
        }),
      }),
      integrations: deepFreeze(merge(DEFAULTS.integrations, source.integrations)),
      cluster: deepFreeze({ ...source.cluster, enabled: bool(source.cluster?.enabled, false), mode: String(source.cluster?.mode || 'standalone'), heartbeatMs: parseDuration(source.cluster?.heartbeatMs, 10_000, 1_000, 300_000), leaseMs: parseDuration(source.cluster?.leaseMs, 30_000, 2_000, 600_000) }),
    });

    this.validate();
  }

  get(pathValue, fallback = undefined) {
    let current = this.value;
    for (const part of String(pathValue || '').split('.').filter(Boolean)) current = current?.[part];
    return current === undefined ? fallback : current;
  }

  snapshot() { return this.value; }

  validate() {
    const errors = [];
    const warnings = [];
    const value = this.value;
    if (value.production && value.studio.enabled && !value.studio.token && value.studio.localOnly === false) errors.push({ code: 'MONITOR_STUDIO_PUBLIC_UNAUTHORIZED', message: 'Production Monitor Studio requires a token, an authorizer, or localOnly=true.' });
    if (value.security.allowRemoteIngest && !value.security.ingestSecret && value.compatibility.requireSignedRemoteIngest) errors.push({ code: 'MONITOR_INGEST_SECRET_REQUIRED', message: 'Signed remote ingestion requires security.ingestSecret.' });
    if (value.pipeline.maxBytes < value.pipeline.maxSignalBytes) warnings.push({ code: 'MONITOR_SIGNAL_EXCEEDS_QUEUE', message: 'pipeline.maxSignalBytes is greater than pipeline.maxBytes.' });
    if (value.metrics.maxSeriesPerInstrument > value.metrics.maxSeries) warnings.push({ code: 'MONITOR_SERIES_LIMIT_ORDER', message: 'Per-instrument series limit exceeds the global series limit.' });
    if (errors.length && value.compatibility.strictConfiguration) throw new MonitorConfigurationError('RawNode Monitor configuration is invalid.', { details: { errors, warnings } });
    this.validation = deepFreeze({ ok: errors.length === 0, errors, warnings });
    return this.validation;
  }
}


function normalizeExporters(input, profile) {
  const source = merge(DEFAULTS.exporters, input);
  const http = source.http || {};
  const otlp = source.otlp || {};
  const statsd = source.statsd || {};
  return deepFreeze({
    ...source,
    enabled: bool(source.enabled, true),
    failFast: bool(source.failFast, profile.exporterErrorPolicy === 'propagate'),
    prometheus: deepFreeze({
      ...(source.prometheus || {}),
      enabled: bool(source.prometheus?.enabled, true),
      prefix: String(source.prometheus?.prefix || 'rawnode'),
    }),
    http: deepFreeze({
      ...http,
      enabled: bool(http.enabled, false),
      timeoutMs: parseDuration(http.timeoutMs, 10_000, 100, 300_000),
      compression: bool(http.compression, true),
      compressionThresholdBytes: parseBytes(http.compressionThresholdBytes, 1_024, 256, 16 * 1024 * 1024),
      maxAttempts: boundedInteger(http.maxAttempts, 3, 1, 100),
      retryBaseMs: parseDuration(http.retryBaseMs, 100, 0, 60_000),
      retryMaxMs: parseDuration(http.retryMaxMs, 5_000, 0, 300_000),
      maxPayloadBytes: parseBytes(http.maxPayloadBytes, 8 * 1024 * 1024, 1_024, 256 * 1024 * 1024),
      maxResponseBytes: parseBytes(http.maxResponseBytes, 64 * 1024, 1_024, 16 * 1024 * 1024),
      maxBatchSignals: boundedInteger(http.maxBatchSignals, 256, 1, 100_000),
      rejectUnauthorized: bool(http.rejectUnauthorized, true),
      required: bool(http.required, false),
    }),
    otlp: deepFreeze({
      ...otlp,
      enabled: bool(otlp.enabled, false),
      timeoutMs: parseDuration(otlp.timeoutMs, 10_000, 100, 300_000),
      compression: bool(otlp.compression, true),
      maxAttempts: boundedInteger(otlp.maxAttempts, 3, 1, 100),
      retryBaseMs: parseDuration(otlp.retryBaseMs, 100, 0, 60_000),
      retryMaxMs: parseDuration(otlp.retryMaxMs, 5_000, 0, 300_000),
      maxPayloadBytes: parseBytes(otlp.maxPayloadBytes, 8 * 1024 * 1024, 1_024, 256 * 1024 * 1024),
      maxResponseBytes: parseBytes(otlp.maxResponseBytes, 64 * 1024, 1_024, 16 * 1024 * 1024),
      maxBatchSignals: boundedInteger(otlp.maxBatchSignals, 256, 1, 100_000),
      rejectUnauthorized: bool(otlp.rejectUnauthorized, true),
      required: bool(otlp.required, false),
      headers: deepFreeze(isPlainObject(otlp.headers) ? { ...otlp.headers } : {}),
    }),
    statsd: deepFreeze({
      ...statsd,
      enabled: bool(statsd.enabled, false),
      host: String(statsd.host || '127.0.0.1'),
      port: boundedInteger(statsd.port, 8125, 1, 65_535),
      prefix: String(statsd.prefix || 'rawnode'),
      maxPacketBytes: parseBytes(statsd.maxPacketBytes, 8_192, 512, 65_507),
    }),
  });
}

function normalizePrefix(value) {
  const text = String(value || '').trim();
  if (!text) return '/';
  const output = text.startsWith('/') ? text : `/${text}`;
  return output.length > 1 && output.endsWith('/') ? output.slice(0, -1) : output;
}

export function resolveMonitorConfiguration(input = {}, options = {}) {
  return input instanceof MonitorConfiguration ? input : new MonitorConfiguration(input, options);
}

export { DEFAULTS as MONITOR_DEFAULTS };
export default MonitorConfiguration;
