'use strict';

const LEVEL_METHODS = Object.freeze([
  'emergency', 'alert', 'critical', 'error', 'urgent', 'priority', 'warn',
  'notice', 'success', 'info', 'debug', 'metric', 'metrics', 'important',
]);

function clampRate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 1;
  return Math.max(0, Math.min(1, number));
}

function normalizeContext(value) {
  if (!value || typeof value !== 'object') return Object.freeze({});
  return Object.freeze({ ...value });
}

function messageKey(message) {
  if (typeof message === 'function') return '[lazy]';
  if (message instanceof Error) return message.message;
  if (message && typeof message === 'object') return message.message || '[object]';
  return String(message ?? '');
}

/**
 * Immutable fluent view over a logger runtime.
 *
 * Child loggers do not allocate transports, queues, or context stores. They only
 * carry immutable policy/context and delegate to the parent runtime.
 */
export class LoggerFacade {
  constructor(logger, options = {}) {
    if (!logger || typeof logger.log !== 'function') {
      throw new TypeError('LoggerFacade requires a logger exposing log().');
    }

    this.logger = logger;
    this.context = normalizeContext(options.context);
    this.channelName = options.channel || this.context.channel || null;
    this.fixedLevel = options.level || null;
    this.sampleRate = clampRate(options.sampleRate ?? 1);
    this.random = options.random || Math.random;
    this.disabled = options.disabled === true;
    this.boundError = options.boundError || null;
    this.tags = Object.freeze([...(options.tags || [])]);
    this.onceKey = options.onceKey == null ? null : String(options.onceKey);
    this.ratePolicy = options.ratePolicy || null;
    this.sharedState = options.sharedState || {
      once: new Set(),
      rates: new Map(),
      maxOnceKeys: Math.max(1, Number(options.stateLimits?.maxOnceKeys) || 10_000),
      maxRateBuckets: Math.max(1, Number(options.stateLimits?.maxRateBuckets) || 10_000),
    };
  }

  _isHighSeverity(level) {
    return this.logger.levelRegistry?.isHighSeverity?.(level) === true
      || this.logger.runtime?.levelRegistry?.isHighSeverity?.(level) === true;
  }

  _accept(level, message) {
    if (this.disabled) return false;
    const highSeverity = this._isHighSeverity(level);

    if (!highSeverity && this.sampleRate < 1 && this.random() >= this.sampleRate) {
      this.logger.metricsRegistry?.increment?.('records_sampled_out_total');
      this.logger.runtime?.metricsRegistry?.increment?.('records_sampled_out_total');
      return false;
    }

    if (this.onceKey) {
      const key = String(this.onceKey);
      if (this.sharedState.once.has(key)) return false;
      while (this.sharedState.once.size >= this.sharedState.maxOnceKeys) {
        const oldest = this.sharedState.once.values().next().value;
        if (oldest === undefined) break;
        this.sharedState.once.delete(oldest);
      }
      this.sharedState.once.add(key);
    }

    if (!highSeverity && this.ratePolicy) {
      const now = Date.now();
      const key = `${this.ratePolicy.key}:${level}`;
      let bucket = this.sharedState.rates.get(key);
      if (!bucket || now - bucket.startedAt >= this.ratePolicy.intervalMs) {
        bucket = { startedAt: now, count: 0 };
      }
      if (bucket.count >= this.ratePolicy.limit) return false;
      bucket.count++;
      if (!this.sharedState.rates.has(key) && this.sharedState.rates.size >= this.sharedState.maxRateBuckets) {
        for (const [candidateKey, candidate] of this.sharedState.rates) {
          if (now - candidate.startedAt >= this.ratePolicy.intervalMs) this.sharedState.rates.delete(candidateKey);
        }
        while (this.sharedState.rates.size >= this.sharedState.maxRateBuckets) {
          const oldest = this.sharedState.rates.keys().next().value;
          if (oldest === undefined) break;
          this.sharedState.rates.delete(oldest);
        }
      }
      this.sharedState.rates.set(key, bucket);
    }

    return true;
  }

  _options(options = {}) {
    return {
      ...options,
      channel: options.channel || this.channelName || undefined,
      context: { ...this.context, ...(options.context || {}) },
      tags: [...this.tags, ...(options.tags || [])],
      error: options.error || this.boundError || undefined,
    };
  }

  log(level, message, data = null, options = {}) {
    const actualLevel = this.fixedLevel || level;
    if (!this._accept(actualLevel, message)) return false;
    return this.logger.log(actualLevel, message, data, this._options(options));
  }

  async logAsync(level, message, data = null, options = {}) {
    const actualLevel = this.fixedLevel || level;
    if (!this._accept(actualLevel, message)) return null;
    return await this.logger.logAsync(actualLevel, message, data, this._options(options));
  }

  child(context = {}, options = {}) {
    return new LoggerFacade(this.logger, {
      context: { ...this.context, ...(context || {}) },
      channel: options.channel || this.channelName,
      level: options.level || this.fixedLevel,
      sampleRate: options.sampleRate ?? this.sampleRate,
      random: options.random || this.random,
      disabled: options.disabled ?? this.disabled,
      boundError: options.boundError || this.boundError,
      tags: [...this.tags, ...(options.tags || [])],
      onceKey: options.onceKey ?? this.onceKey,
      ratePolicy: options.ratePolicy || this.ratePolicy,
      sharedState: this.sharedState,
    });
  }

  with(context = {}) { return this.child(context); }
  withTags(...tags) { return this.child({}, { tags: tags.flat().filter((value) => value != null).map(String) }); }
  channel(name) { return this.child({}, { channel: String(name || 'application') }); }
  at(level) { return this.child({}, { level }); }
  sample(rate) { return this.child({}, { sampleRate: rate }); }
  withError(error, context = {}) { return this.child(context, { boundError: error }); }
  when(condition) { return condition ? this : this.child({}, { disabled: true }); }
  once(key = 'default') { return this.child({}, { onceKey: String(key) }); }

  rateLimit(key = 'default', options = {}) {
    return this.child({}, {
      ratePolicy: Object.freeze({
        key: String(key),
        limit: Math.max(1, Number(options.limit) || 1),
        intervalMs: Math.max(1, Number(options.intervalMs ?? options.windowMs) || 1_000),
      }),
    });
  }

  forRequest(req, extra = {}) {
    const manager = this.logger.contextManager || this.logger.runtime?.contextManager;
    const context = manager?.createRequestContext?.(req, extra) || { ...extra };
    return this.child(context);
  }

  forJob(job = {}, extra = {}) {
    const manager = this.logger.contextManager || this.logger.runtime?.contextManager;
    const context = manager?.createJobContext?.(job, extra) || {
      jobId: job.id || job.jobId,
      queue: job.queue || job.queueName,
      attempt: job.attempt || job.attempts,
      tenantId: job.tenantId || job.tenant_id,
      traceId: job.traceId || job.trace_id,
      correlationId: job.correlationId || job.correlation_id,
      ...extra,
    };
    return this.child(context);
  }

  runWithContext(context, callback, ...args) {
    const manager = this.logger.contextManager || this.logger.runtime?.contextManager;
    return manager?.run ? manager.run({ ...this.context, ...(context || {}) }, callback, ...args) : callback(...args);
  }

  getContext() {
    const manager = this.logger.contextManager || this.logger.runtime?.contextManager;
    return manager?.current?.() || manager?.get?.() || {};
  }

  isLevelEnabled(level) {
    return !this.disabled && this.logger.isLevelEnabled(this.fixedLevel || level);
  }

  time(label, context = {}) {
    const started = process.hrtime.bigint();
    let ended = false;
    return Object.freeze({
      end: (first = {}, second = 'metric') => {
        if (ended) return null;
        ended = true;
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        const level = typeof first === 'string' ? first : second;
        const data = typeof first === 'string' ? (second && typeof second === 'object' ? second : {}) : (first || {});
        this.log(level || 'metric', label, { ...context, ...data, durationMs });
        return durationMs;
      },
      stop: (first = {}, second = 'metric') => {
        if (ended) return null;
        ended = true;
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        const level = typeof first === 'string' ? first : second;
        const data = typeof first === 'string' ? (second && typeof second === 'object' ? second : {}) : (first || {});
        this.log(level || 'metric', label, { ...context, ...data, durationMs });
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
      this.log(options.level || 'metric', label, { ...context, ...(options.data || {}), durationMs, success: true });
      return result;
    } catch (error) {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      this.log(options.errorLevel || 'error', label, { ...context, ...(options.data || {}), durationMs, success: false }, { error });
      throw error;
    }
  }

  setLevel(level) { this.logger.setLevel?.(level); return this; }
  registerLevel(definition, options) { this.logger.registerLevel?.(definition, options); return this; }
  levels() { return this.logger.levels?.() || this.logger.runtime?.levels?.() || []; }
  transport(transport, options) { this.logger.addTransport?.(transport, options); return this; }
  processor(processor, options) { this.logger.processor?.(processor, options); return this; }
  plugin(plugin) { this.logger.plugin?.(plugin); return this; }
  ready() { return typeof this.logger.ready === 'function' ? this.logger.ready().then(() => this) : Promise.resolve(this); }
  reopen(options) { return this.logger.reopen?.(options); }
  flush(options) { return this.logger.flush(options); }
  close(options) { return this.logger.close(options); }
  health() { return this.logger.health(); }
  stats() { return this.logger.stats(); }
  metricsSnapshot() { return this.logger.metricsSnapshot?.() || this.logger.runtime?.metricsSnapshot?.() || {}; }
  prometheus(labels) { return this.toPrometheus(labels); }
  toPrometheus(labels) { return this.logger.toPrometheus?.(labels) || this.logger.prometheus?.(labels) || ''; }
}

for (const level of LEVEL_METHODS) {
  LoggerFacade.prototype[level] = function levelMethod(message, data, options) {
    return this.log(level, message, data, options);
  };
}

export { LEVEL_METHODS };
export default LoggerFacade;
