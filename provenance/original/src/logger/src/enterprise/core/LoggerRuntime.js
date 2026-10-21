'use strict';

import { EventEmitter } from 'node:events';
import LevelRegistry from './LevelRegistry.js';
import InternalDiagnostics from './InternalDiagnostics.js';
import DeliveryQueue from './DeliveryQueue.js';
import LoggerLifecycle from './LoggerLifecycle.js';
import TransportDispatcher from './TransportDispatcher.js';
import { COMPATIBILITY_VIEW } from './TransportAdapter.js';
import { resolveCompatibilityProfile } from '../compatibility/CompatibilityProfile.js';
import ContextManager, { globalContextManager } from '../context/ContextManager.js';
import SafeSerializer from '../serialization/SafeSerializer.js';
import TextFormatter from '../serialization/TextFormatter.js';
import ErrorNormalizer from '../records/ErrorNormalizer.js';
import RecordFactory from '../records/RecordFactory.js';
import Redactor from '../security/Redactor.js';
import ProcessorRegistry from '../processing/ProcessorRegistry.js';
import PluginManager from '../plugins/PluginManager.js';
import LoggerMetrics from '../observability/LoggerMetrics.js';

const EMPTY_CONTEXT = Object.freeze(Object.create(null));

function freezeRecord(record) {
  if (!record || typeof record !== 'object') return record;
  for (const key of ['data', 'context', 'error', 'tags']) {
    const value = record[key];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) Object.freeze(value);
  }
  return Object.freeze(record);
}

function attachLevelDefinition(record, definition) {
  if (!record || typeof record !== 'object') return record;
  try {
    Object.defineProperty(record, 'levelDefinition', {
      value: definition,
      enumerable: false,
      configurable: false,
    });
  } catch {}
  return record;
}

function requestContext(req = {}) {
  const headers = req.headers || EMPTY_CONTEXT;
  const user = req.user || req.auth || null;
  return {
    requestId: req.id || req.requestId || headers['x-request-id'] || headers['x-correlation-id'] || null,
    correlationId: req.correlationId || headers['x-correlation-id'] || null,
    traceId: req.traceId || headers['x-trace-id'] || null,
    spanId: req.spanId || headers['x-span-id'] || null,
    tenantId: req.tenantId || req.tenant?.id || headers['x-tenant-id'] || null,
    userId: user?.id || user?._id || user?.sub || null,
    method: req.method || null,
    path: (typeof req.path === 'function' ? req.path() : req.path) || req.url || null,
    route: req.route?.name || req.route?.path || req.routeName || null,
    protocol: req.protocol || (req.socket?.encrypted ? 'https' : 'http'),
    remoteAddress: req.ip || req.socket?.remoteAddress || null,
  };
}

function jobContext(job = {}) {
  return {
    jobId: job.id || job.jobId || null,
    queue: job.queue || job.queueName || null,
    attempt: job.attempt || job.attempts || null,
    maxAttempts: job.maxAttempts || job.tries || null,
    tenantId: job.tenantId || job.tenant_id || null,
    traceId: job.traceId || job.trace_id || null,
    correlationId: job.correlationId || job.correlation_id || null,
  };
}

function roughBytes(value) {
  if (value == null) return 0;
  if (Buffer.isBuffer(value)) return value.length;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof value === 'string') return Buffer.byteLength(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return 16;
  if (typeof value === 'function') return 64;
  if (Array.isArray(value)) return Math.min(64 * 1024, 128 + value.length * 32);
  if (typeof value === 'object') {
    try { return Math.min(64 * 1024, 256 + Object.keys(value).length * 64); }
    catch { return 512; }
  }
  return 64;
}

function emergencyFallback(level, message, error) {
  try {
    const timestamp = new Date().toISOString();
    const text = typeof message === 'function' ? '[lazy message]' : String(message ?? '');
    process.stderr.write(`[${timestamp}] [${String(level || 'error').toUpperCase()}] ${text}${error ? ` logger_error=${error.message || error}` : ''}\n`);
  } catch {}
}

function cloneProcessors(registry) {
  return typeof registry?.clone === 'function' ? registry.clone() : registry;
}

function clonePlugins(manager) {
  return typeof manager?.clone === 'function' ? manager.clone() : manager;
}

/**
 * Canonical RawNode logging runtime.
 *
 * Guarantees:
 * - disabled levels take the fast path before lazy values are evaluated;
 * - accepted records are processed in deterministic order through a bounded queue;
 * - critical records are never silently dropped under queue pressure;
 * - transports are isolated behind bounded adapters and explicit lifecycle APIs;
 * - structured records remain uncolored; presentation is transport-specific.
 */
export class LoggerRuntime extends EventEmitter {
  constructor(options = {}) {
    super();
    const shared = options._shared || null;

    this.profile = resolveCompatibilityProfile(options.profile || shared?.profile || 'v1', options.profileOverrides);
    this.levelRegistry = shared?.levelRegistry || options.levelRegistry || new LevelRegistry(options.levels || {});
    this.level = this.levelRegistry.resolveName(options.level || shared?.level || 'info');
    if (!this.levelRegistry.has(this.level)) {
      if (this.profile.strictLevels) throw new Error(`Unknown log level [${this.level}].`);
      this.level = 'info';
    }

    this.serializer = shared?.serializer || options.serializer || new SafeSerializer(options.serialization);
    this.diagnostics = shared?.diagnostics || options.diagnostics || new InternalDiagnostics(options.diagnosticsOptions);
    const metricsOptions = options.observability && typeof options.observability === 'object' ? options.observability : {};
    this.metricsRegistry = shared?.metricsRegistry || shared?.metrics || options.metricsRegistry || options.metrics || new LoggerMetrics({
      enabled: metricsOptions.enabled ?? this.profile.metrics,
      ...metricsOptions,
    });
    this.contextManager = shared?.contextManager || options.contextManager || (this.profile.context
      ? globalContextManager
      : new ContextManager({ enabled: false }));
    this.errorNormalizer = shared?.errorNormalizer || options.errorNormalizer || new ErrorNormalizer(this.serializer, options.errors);
    this.recordFactory = shared?.recordFactory || options.recordFactory || new RecordFactory({
      serializer: this.serializer,
      errorNormalizer: this.errorNormalizer,
      service: options.service,
      environment: options.environment,
      clock: options.clock,
      hrtime: options.hrtime,
      idFactory: options.idFactory,
      schemaVersion: options.schemaVersion,
    });
    this.redactor = shared?.redactor || options.redactor || new Redactor({
      enabled: options.security?.enabled ?? options.security?.redact ?? this.profile.redact,
      sanitizeControls: options.security?.sanitizeControls ?? this.profile.sanitizeControls,
      stripAnsi: options.security?.stripAnsi ?? this.profile.stripAnsi,
      ...(options.security || {}),
    });

    this.processors = options.processors instanceof ProcessorRegistry
      ? options.processors
      : new ProcessorRegistry({
          errorPolicy: this.profile.isolateProcessorErrors ? 'isolate' : 'propagate',
          diagnostics: this.diagnostics,
        });
    this.plugins = options.plugins instanceof PluginManager
      ? options.plugins
      : new PluginManager({
          duplicate: options.pluginOptions?.duplicate || 'reject',
          errorPolicy: this.profile.isolatePluginErrors ? 'isolate' : 'propagate',
          timeoutMs: options.pluginOptions?.timeoutMs,
          diagnostics: this.diagnostics,
        });

    this.formatter = options.formatter || shared?.formatter || new TextFormatter(options.textFormatter);
    this.compatibilityViewFactory = options.compatibilityViewFactory || shared?.compatibilityViewFactory || null;
    this.awaitTransportDelivery = options.awaitTransportDelivery ?? this.profile.awaitTransportDelivery;
    this.channelName = options.channel || 'app';
    this.service = options.service || shared?.service || this.recordFactory.service;
    this.environment = options.environment || shared?.environment || this.recordFactory.environment;
    this.staticContext = Object.freeze({ ...(shared?.staticContext || {}), ...(options.context || {}) });
    this.tags = Object.freeze([...(shared?.tags || []), ...(options.tags || [])]);
    this.boundError = options.boundError || null;
    const requestedSampleRate = options.sampleRate == null ? 1 : Number(options.sampleRate);
    this.sampleRate = Number.isFinite(requestedSampleRate) ? Math.max(0, Math.min(1, requestedSampleRate)) : 1;
    this.onceKey = options.onceKey || null;
    this.ratePolicy = options.ratePolicy || null;
    this.disabled = options.disabled === true;
    this.defaultLevel = options.defaultLevel || null;

    const stateLimits = options.stateLimits || options.limits?.state || {};
    this.sharedState = shared?.sharedState || {
      onceKeys: new Set(),
      rateBuckets: new Map(),
      random: options.random || Math.random,
      maxOnceKeys: Math.max(1, Number(stateLimits.maxOnceKeys) || 10_000),
      maxRateBuckets: Math.max(1, Number(stateLimits.maxRateBuckets) || 10_000),
    };

    const transportQueue = options.transportQueue || options.queue?.transport || options.queue || {};
    if (shared?.dispatcher) {
      this.dispatcher = shared.dispatcher;
      this.ownsDispatcher = false;
    } else {
      this.dispatcher = options.dispatcher || new TransportDispatcher({
        serializer: this.serializer,
        levelRegistry: this.levelRegistry,
        diagnostics: this.diagnostics,
        metrics: this.metricsRegistry,
        emergencyWriter: options.emergencyWriter,
        transports: options.transports || [],
        adapter: {
          payloadMode: options.transportPayload || this.profile.legacyTransportPayload,
          maxItems: transportQueue.maxItems,
          maxBytes: transportQueue.maxBytes,
          maxOvercommitItems: transportQueue.maxOvercommitItems,
          maxOvercommitBytes: transportQueue.maxOvercommitBytes,
          overflow: transportQueue.overflow || this.profile.queueOverflow,
          budgetMs: transportQueue.budgetMs,
          maxPerSlice: transportQueue.maxPerSlice,
          flushTimeoutMs: transportQueue.flushTimeoutMs,
          writeTimeoutMs: transportQueue.writeTimeoutMs,
          batchSize: transportQueue.batchSize,
          failureThreshold: options.circuitBreaker?.failureThreshold,
          circuitOpenMs: options.circuitBreaker?.openMs,
          maxRetries: transportQueue.maxRetries,
          retryDelayMs: transportQueue.retryDelayMs,
          retryMaxDelayMs: transportQueue.retryMaxDelayMs,
          retryJitter: transportQueue.retryJitter,
        },
      });
      this.ownsDispatcher = true;
    }

    const pipelineOptions = options.pipelineQueue || options.queue?.pipeline || {};
    if (shared?.pipelineQueue) {
      this.pipelineQueue = shared.pipelineQueue;
      this.ownsPipelineQueue = false;
    } else {
      this.pipelineQueue = new DeliveryQueue({
        name: options.name ? `${options.name}:pipeline` : 'logger-pipeline',
        maxItems: pipelineOptions.maxItems ?? options.maxPendingItems ?? 10_000,
        maxBytes: pipelineOptions.maxBytes ?? options.maxPendingBytes ?? 64 * 1024 * 1024,
        maxOvercommitItems: pipelineOptions.maxOvercommitItems,
        maxOvercommitBytes: pipelineOptions.maxOvercommitBytes,
        overflow: pipelineOptions.overflow || this.profile.queueOverflow,
        budgetMs: pipelineOptions.budgetMs,
        maxPerSlice: pipelineOptions.maxPerSlice,
        flushTimeoutMs: pipelineOptions.flushTimeoutMs,
        onDrop: (result, metadata) => {
          this.metricsRegistry.increment('records_dropped');
          try { this.emit('drop', { ...result, metadata }); } catch {}
        },
        onError: (error, metadata) => this.diagnostics.report('LOGGER_PIPELINE_ERROR', error, metadata),
        onEmergency: (metadata) => {
          this.metricsRegistry.increment('records_emergency_fallback');
          return emergencyFallback(metadata?.level, metadata?.message, metadata?.error);
        },
      });
      this.ownsPipelineQueue = true;
    }

    for (const processor of options.processorList || []) {
      if (typeof processor === 'function') this.use(processor);
      else if (processor?.processor) this.use(processor.processor, processor.options || processor);
    }
    for (const plugin of options.pluginList || []) this.plugin(plugin);

    this.lifecycle = new LoggerLifecycle({
      onChange: (state, previous, details) => {
        try { this.emit('state', { state, previous, details }); } catch {}
      },
    });
    this.lifecycle.transition('ready');
    this.state = 'ready';
    this.createdAt = Date.now();
    this._pending = new Set();
    this._closed = false;
    this._parent = options._parent || null;
  }

  isLevelEnabled(level) {
    if (this.disabled || this._closed || !this.pipelineQueue.accepting) return false;
    return this.levelRegistry.isEnabled(level, this.level);
  }

  setLevel(level) {
    const normalized = this.levelRegistry.resolveName(level);
    if (!this.levelRegistry.has(normalized)) {
      if (this.profile.strictLevels) throw new Error(`Unknown log level [${level}].`);
      return this;
    }
    this.level = normalized;
    return this;
  }

  registerLevel(definition, options = {}) {
    this.levelRegistry.register(definition, options);
    return this;
  }

  levels() { return this.levelRegistry.definitions(); }

  log(level, message, data = null, options = {}) {
    const submitted = this.submit(level, message, data, options);
    if (!submitted.accepted) return;
    submitted.promise.catch((error) => {
      this.diagnostics.report('LOGGER_PIPELINE_ERROR', error, { level: submitted.level });
      const definition = this.levelRegistry.get(submitted.level);
      if (definition?.droppable === false) emergencyFallback(submitted.level, message, error);
    });
  }

  async logAsync(level, message, data = null, options = {}) {
    const submitted = this.submit(level, message, data, {
      ...options,
      awaitDelivery: options.awaitDelivery !== false,
      throwOnError: options.throwOnError !== false,
    });
    if (!submitted.accepted) return null;
    return await submitted.promise;
  }

  submit(level, message, data = null, options = {}) {
    const normalized = this.levelRegistry.resolveName(level || this.defaultLevel || 'info');
    if (!this._accept(normalized, message, options)) {
      return { accepted: false, level: normalized, promise: Promise.resolve(null) };
    }

    const definition = this.levelRegistry.get(normalized);
    const acceptedOptions = {
      ...options,
      _acceptedTimeUnixMs: Number(this.recordFactory.clock()),
      _acceptedHrtimeNs: this.recordFactory.hrtime(),
    };
    const bytes = 512 + roughBytes(message) + roughBytes(data) + roughBytes(options.context);
    const queued = this.pipelineQueue.enqueue(
      () => this._process(normalized, message, data, acceptedOptions, acceptedOptions.awaitDelivery === true),
      {
        bytes,
        signal: options.signal,
        meta: {
          level: normalized,
          severity: definition?.severity ?? null,
          rank: definition?.rank ?? null,
          droppable: definition?.droppable !== false,
          message,
          channel: options.channel || this.channelName,
        },
        emergency: () => {
          this.metricsRegistry.increment('records_emergency_fallback');
          return emergencyFallback(normalized, message, new Error('Logger pipeline emergency overcommit budget exhausted.'));
        },
      },
    );

    if (!queued.accepted) this.metricsRegistry.increment('records_rejected');
    else this.metricsRegistry.increment('records_enqueued');
    this._pending.add(queued.promise);
    queued.promise.finally(() => this._pending.delete(queued.promise)).catch(() => {});
    return { accepted: queued.accepted, level: normalized, promise: queued.promise, overcommitted: queued.overcommitted === true };
  }

  _accept(level, message, options = {}) {
    if (!this.levelRegistry.has(level)) {
      if (this.profile.strictLevels) throw new Error(`Unknown log level [${level}].`);
      return false;
    }
    if (!this.isLevelEnabled(level)) return false;

    const definition = this.levelRegistry.get(level);
    if (this.sampleRate < 1 && definition?.droppable !== false && this.sharedState.random() >= this.sampleRate) {
      this.metricsRegistry.increment('records_sampled_out');
      return false;
    }
    if (this.onceKey) {
      const key = String(this.onceKey);
      if (this.sharedState.onceKeys.has(key)) return false;
      while (this.sharedState.onceKeys.size >= this.sharedState.maxOnceKeys) {
        const oldest = this.sharedState.onceKeys.values().next().value;
        if (oldest === undefined) break;
        this.sharedState.onceKeys.delete(oldest);
      }
      this.sharedState.onceKeys.add(key);
    }
    if (this.ratePolicy) {
      const now = Date.now();
      const bucketKey = `${this.ratePolicy.key}:${level}`;
      const bucket = this.sharedState.rateBuckets.get(bucketKey) || { startedAt: now, count: 0 };
      if (now - bucket.startedAt >= this.ratePolicy.intervalMs) {
        bucket.startedAt = now;
        bucket.count = 0;
      }
      if (bucket.count >= this.ratePolicy.limit && definition?.droppable !== false) {
        this.metricsRegistry.increment('records_rate_limited');
        this.sharedState.rateBuckets.set(bucketKey, bucket);
        return false;
      }
      bucket.count++;
      if (!this.sharedState.rateBuckets.has(bucketKey)
        && this.sharedState.rateBuckets.size >= this.sharedState.maxRateBuckets) {
        for (const [candidateKey, candidate] of this.sharedState.rateBuckets) {
          if (now - candidate.startedAt >= this.ratePolicy.intervalMs) this.sharedState.rateBuckets.delete(candidateKey);
        }
        while (this.sharedState.rateBuckets.size >= this.sharedState.maxRateBuckets) {
          const oldest = this.sharedState.rateBuckets.keys().next().value;
          if (oldest === undefined) break;
          this.sharedState.rateBuckets.delete(oldest);
        }
      }
      this.sharedState.rateBuckets.set(bucketKey, bucket);
    }
    if (options.signal?.aborted) return false;
    return true;
  }

  async _process(level, message, data, options, awaitDelivery) {
    if (options.signal?.aborted) return null;
    const started = process.hrtime.bigint();
    const definition = this.levelRegistry.get(level);
    const context = {
      ...this.contextManager.get(),
      ...this.staticContext,
      ...(options.context || {}),
    };

    let record = this.recordFactory.create({
      level,
      levelDefinition: definition,
      message,
      data,
      error: options.error || this.boundError,
      context,
      channel: options.channel || this.channelName,
      service: options.service || this.service,
      environment: options.environment || this.environment,
      tags: [...this.tags, ...(options.tags || [])],
      requestId: options.requestId,
      correlationId: options.correlationId,
      traceId: options.traceId,
      spanId: options.spanId,
      tenantId: options.tenantId,
      userId: options.userId,
      timeUnixMs: options._acceptedTimeUnixMs,
      hrtimeNs: options._acceptedHrtimeNs,
    });
    attachLevelDefinition(record, definition);

    const hookContext = { logger: this, signal: options.signal, levelDefinition: definition };
    const trustedFilter = { trustedOnly: this.redactor.enabled === true };
    const untrustedFilter = { untrustedOnly: this.redactor.enabled === true };

    if (this.plugins.hasHook('beforeBuild', trustedFilter)) {
      record = await this.plugins.runHook('beforeBuild', record, { ...hookContext, ...trustedFilter });
      if (record == null) return this._processorDrop();
      attachLevelDefinition(record, definition);
    }
    if (this.processors.hasPhase('before-redaction')) {
      record = await this.processors.runPhase('before-redaction', record, hookContext);
      if (record == null) return this._processorDrop();
      attachLevelDefinition(record, definition);
    }
    if (this.plugins.hasHook('afterBuild', trustedFilter)) {
      record = await this.plugins.runHook('afterBuild', record, { ...hookContext, ...trustedFilter });
      if (record == null) return this._processorDrop();
      attachLevelDefinition(record, definition);
    }

    if (this.redactor.enabled) this.redactor.redact(record, { inPlace: true });

    let postRedactionEnriched = false;
    if (this.processors.hasPhase('after-redaction')) {
      record = await this.processors.runPhase('after-redaction', record, hookContext);
      if (record == null) return this._processorDrop();
      attachLevelDefinition(record, definition);
      postRedactionEnriched = true;
    }
    if (this.plugins.hasHook('afterRedaction', untrustedFilter)) {
      record = await this.plugins.runHook('afterRedaction', record, { ...hookContext, ...untrustedFilter });
      if (record == null) return this._processorDrop();
      attachLevelDefinition(record, definition);
      postRedactionEnriched = true;
    }
    if (postRedactionEnriched && this.redactor.enabled) this.redactor.redact(record, { inPlace: true });

    try {
      const formatted = typeof this.formatter === 'function'
        ? await this.formatter(record, this.serializer)
        : await this.formatter.format(record, this.serializer);
      record.formatted = String(formatted ?? '');
    } catch (error) {
      this.diagnostics.report('LOGGER_FORMATTER_ERROR', error, { level, formatter: this.formatter?.constructor?.name });
      record.formatted = `[${record.timestamp}] [${String(level).toUpperCase()}] ${record.message}`;
    }

    const shouldBuildCompatibility = this.compatibilityViewFactory
      && (typeof this.compatibilityViewFactory.shouldBuild !== 'function'
        || this.compatibilityViewFactory.shouldBuild(record, this) !== false);
    if (shouldBuildCompatibility) {
      try {
        const view = await this.compatibilityViewFactory(record, this);
        const safeView = this.redactor.enabled && view !== undefined ? this.redactor.redact(view) : view;
        if (safeView !== undefined) Object.defineProperty(record, COMPATIBILITY_VIEW, { value: safeView, enumerable: false, configurable: false });
      } catch (error) {
        this.diagnostics.report('LOGGER_COMPATIBILITY_FORMAT_ERROR', error, { level });
      }
    }

    let beforeWriteEnriched = false;
    if (this.processors.hasPhase('before-write')) {
      record = await this.processors.runPhase('before-write', record, hookContext);
      if (record == null) return this._processorDrop();
      attachLevelDefinition(record, definition);
      beforeWriteEnriched = true;
    }
    if (this.plugins.hasHook('beforeWrite')) {
      record = await this.plugins.runHook('beforeWrite', record, hookContext);
      if (record == null) return this._processorDrop();
      attachLevelDefinition(record, definition);
      beforeWriteEnriched = true;
    }
    if (beforeWriteEnriched && this.redactor.enabled) this.redactor.redact(record, { inPlace: true });
    if (this.profile.freezeRecords) freezeRecord(record);

    const delivery = await this.dispatcher.dispatch(record, {
      awaitDelivery: awaitDelivery || this.awaitTransportDelivery,
      throwOnError: options.throwOnError === true || (awaitDelivery && options.throwOnError !== false),
    });
    if (this.plugins.hasHook('afterWrite')) {
      await this.plugins.runHook('afterWrite', record, { ...hookContext, delivery });
    }

    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    this.metricsRegistry.increment('records_accepted');
    this.metricsRegistry.increment(`level_${level}`);
    this.metricsRegistry.observe('pipeline_duration_ms', durationMs);
    this.metricsRegistry.gauge('pending_records', this._pending.size);
    this.metricsRegistry.gauge('pipeline_queue_items', this.pipelineQueue.queue.length);
    this.metricsRegistry.gauge('pipeline_queue_bytes', this.pipelineQueue.queuedBytes);

    try { this.emit('record', record); } catch (error) { this.diagnostics.report('LOGGER_OBSERVER_ERROR', error); }
    try { this.emit('log', record); } catch (error) { this.diagnostics.report('LOGGER_OBSERVER_ERROR', error); }
    return record;
  }

  _processorDrop() {
    this.metricsRegistry.increment('records_processor_dropped');
    return null;
  }

  emergency(message, data, options) { return this.log('emergency', message, data, options); }
  alert(message, data, options) { return this.log('alert', message, data, options); }
  critical(message, data, options) { return this.log('critical', message, data, options); }
  error(message, data, options) { return this.log('error', message, data, options); }
  urgent(message, data, options) { return this.log('urgent', message, data, options); }
  priority(message, data, options) { return this.log('priority', message, data, options); }
  warn(message, data, options) { return this.log('warn', message, data, options); }
  notice(message, data, options) { return this.log('notice', message, data, options); }
  success(message, data, options) { return this.log('success', message, data, options); }
  info(message, data, options) { return this.log('info', message, data, options); }
  debug(message, data, options) { return this.log('debug', message, data, options); }
  metric(message, data, options) { return this.log('metric', message, data, options); }
  metrics(message, data, options) { return this.log('metrics', message, data, options); }
  important(message, data, options) { return this.log('important', message, data, options); }

  use(processor, options = {}) { this.processors.use(processor, options); return this; }
  processor(processor, options = {}) { return this.use(processor, options); }
  plugin(plugin) { this.plugins.use(plugin); return this; }

  transport(transport, options = {}) { return this.addTransport(transport, options); }

  addTransport(transport, options = {}) {
    if (transport && !transport.serializer) {
      try { transport.serializer = this.serializer; } catch {}
    }
    this.dispatcher.add(transport, options);
    return this;
  }

  removeTransport(nameOrTransport, options = {}) {
    return this.dispatcher.remove(nameOrTransport, options);
  }

  child(context = {}, options = {}) {
    return new LoggerRuntime({
      ...options,
      level: options.level || this.level,
      channel: options.channel || this.channelName,
      context,
      tags: options.tags || [],
      boundError: options.boundError,
      sampleRate: options.sampleRate ?? this.sampleRate,
      onceKey: options.onceKey,
      ratePolicy: options.ratePolicy,
      disabled: options.disabled,
      defaultLevel: options.defaultLevel,
      compatibilityViewFactory: options.compatibilityViewFactory || this.compatibilityViewFactory,
      processors: options.processors || cloneProcessors(this.processors),
      plugins: options.plugins || clonePlugins(this.plugins),
      _parent: this,
      _shared: {
        profile: this.profile,
        levelRegistry: this.levelRegistry,
        level: this.level,
        serializer: this.serializer,
        diagnostics: this.diagnostics,
        metricsRegistry: this.metricsRegistry,
        contextManager: this.contextManager,
        errorNormalizer: this.errorNormalizer,
        recordFactory: this.recordFactory,
        redactor: this.redactor,
        formatter: this.formatter,
        compatibilityViewFactory: this.compatibilityViewFactory,
        dispatcher: this.dispatcher,
        pipelineQueue: this.pipelineQueue,
        service: this.service,
        environment: this.environment,
        staticContext: this.staticContext,
        tags: this.tags,
        sharedState: this.sharedState,
      },
    });
  }

  with(context = {}) { return this.child(context); }
  withTags(...tags) { return this.child({}, { tags: tags.flat().filter((value) => value != null).map(String) }); }
  channel(name) { return this.child({}, { channel: String(name || 'app') }); }
  withError(error, context = {}) { return this.child(context, { boundError: error }); }
  when(condition) { return condition ? this : this.child({}, { disabled: true }); }
  sample(rate) { return this.child({}, { sampleRate: rate }); }
  once(key = 'default') { return this.child({}, { onceKey: String(key) }); }

  rateLimit(key, options = {}) {
    return this.child({}, {
      ratePolicy: {
        key: String(key || 'default'),
        limit: Math.max(1, Number(options.limit) || 1),
        intervalMs: Math.max(1, Number(options.intervalMs || options.windowMs) || 1000),
      },
    });
  }

  at(level) {
    const logger = this;
    const normalized = this.levelRegistry.resolveName(level);
    return Object.freeze({
      log(message, data, options) { return logger.log(normalized, message, data, options); },
      logAsync(message, data, options) { return logger.logAsync(normalized, message, data, options); },
      isEnabled() { return logger.isLevelEnabled(normalized); },
      child(context) { return logger.child(context).at(normalized); },
    });
  }

  forRequest(req, extra = {}) { return this.child({ ...requestContext(req), ...extra }); }
  forJob(job, extra = {}) { return this.child({ ...jobContext(job), ...extra }); }

  runWithContext(context, callback, ...args) {
    return this.contextManager.run(context, callback, ...args);
  }

  getContext() { return this.contextManager.get(); }

  time(label, context = {}) {
    const started = process.hrtime.bigint();
    let ended = false;
    return Object.freeze({
      end: (first = 'info', second = {}) => {
        if (ended) return null;
        ended = true;
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        const level = typeof first === 'string' ? first : 'info';
        const data = typeof first === 'string' ? (second && typeof second === 'object' ? second : {}) : (first || {});
        this.log(level, label, { ...context, ...data, durationMs });
        return durationMs;
      },
      stop: (first = 'info', second = {}) => {
        if (ended) return null;
        ended = true;
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        const level = typeof first === 'string' ? first : 'info';
        const data = typeof first === 'string' ? (second && typeof second === 'object' ? second : {}) : (first || {});
        this.log(level, label, { ...context, ...data, durationMs });
        return durationMs;
      },
      cancel: () => { ended = true; },
    });
  }

  async measure(label, operation, context = {}, options = {}) {
    if (typeof operation !== 'function') throw new TypeError('logger.measure requires an operation function.');
    const started = process.hrtime.bigint();
    try {
      const result = await operation();
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      this.log(options.level || 'info', label, { ...context, durationMs, success: true });
      return result;
    } catch (error) {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      this.log(options.errorLevel || 'error', label, { ...context, durationMs, success: false }, { error });
      throw error;
    }
  }

  clearOnce() { this.sharedState.onceKeys.clear(); return this; }
  resetRateLimits() { this.sharedState.rateBuckets.clear(); return this; }

  async ready() {
    await this.plugins.runHook('ready', this, { logger: this });
    await Promise.allSettled(this.dispatcher.adapters.map((adapter) => adapter.transport?.ready?.()));
    return this;
  }

  async flush(options = {}) {
    await this.pipelineQueue.flush(options);
    await Promise.allSettled([...this._pending]);
    await this.dispatcher.flush(options);
    this.metricsRegistry.gauge('pending_records', 0);
  }

  async reopen(options = {}) {
    return await this.dispatcher.reopen(options);
  }

  async close(options = {}) {
    if (this._closed) return;
    this.state = 'draining';
    if (this.lifecycle.is('ready', 'degraded')) this.lifecycle.transition('draining');

    if (this.ownsPipelineQueue) {
      this.pipelineQueue.accepting = false;
      await this.pipelineQueue.flush(options);
    } else {
      await Promise.allSettled([...this._pending]);
    }

    this.state = 'closing';
    if (!this.lifecycle.is('closing', 'closed')) this.lifecycle.transition('closing');
    if (this.ownsDispatcher) await this.dispatcher.close(options);
    await this.plugins.close({ logger: this });
    this._closed = true;
    this.state = 'closed';
    if (!this.lifecycle.is('closed')) this.lifecycle.transition('closed');
    this.removeAllListeners();
  }

  destroy(options) { return this.close(options); }

  health() {
    const transports = this.dispatcher.health();
    const degraded = transports.some((item) => item.status === 'degraded');
    const pipeline = this.pipelineQueue.snapshot();
    return {
      status: this._closed ? 'closed' : (degraded ? 'degraded' : 'healthy'),
      state: this.state,
      level: this.level,
      profile: this.profile.name,
      uptimeMs: Date.now() - this.createdAt,
      pending: this._pending.size,
      pipeline,
      transports,
      diagnostics: this.diagnostics.snapshot().slice(-20),
    };
  }

  stats() {
    const metrics = this.metricsRegistry.snapshot();
    const counters = { ...metrics.counters };
    for (const [name, value] of Object.entries(metrics.counters)) counters[`${name}_total`] ??= value;
    return {
      metrics,
      counters,
      gauges: { ...metrics.gauges },
      histograms: { ...metrics.histograms },
      pipeline: this.pipelineQueue.snapshot(),
      transports: this.dispatcher.stats(),
      processors: this.processors.snapshot(),
      plugins: this.plugins.snapshot(),
    };
  }

  metricsSnapshot() { return this.metricsRegistry.snapshot(); }
  prometheus(labels = {}) { return this.toPrometheus(labels); }

  diagnosticsSnapshot() { return this.diagnostics.snapshot(); }
  toPrometheus(labels = {}) { return this.metricsRegistry.toPrometheus({ service: this.service, ...labels }); }
}

/** Bare structured runtime factory; root createLogger returns the legacy-compatible facade. */
export function createLogger(options = {}) {
  const logger = new LoggerRuntime(options);
  for (const transport of options.transports || []) {
    if (!transport.serializer) {
      try { transport.serializer = logger.serializer; } catch {}
    }
  }
  return logger;
}

export default LoggerRuntime;
