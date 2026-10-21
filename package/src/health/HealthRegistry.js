'use strict';

import { EventEmitter } from 'node:events';
import { HealthStatus } from '../constants.js';
import { deepFreeze, errorRecord, withTimeout } from '../support.js';

export class HealthRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    this.timeoutMs = Math.max(1, Number(options.timeoutMs) || 5_000);
    this.concurrency = Math.max(1, Number(options.concurrency) || 16);
    this.historyLimit = Math.max(1, Number(options.historyLimit) || 256);
    this.cacheTtlMs = Math.max(0, Number(options.cacheTtlMs) || 0);
    this.checks = new Map();
    this.pending = new WeakMap();
    this.history = [];
    this.cache = new Map();
    this.frozen = false;
    this.stats = { runs: 0, checks: 0, failures: 0, timeouts: 0, cacheHits: 0 };
  }

  register(name, check, options = {}) {
    if (!name || typeof check !== 'function') throw new TypeError('HealthRegistry.register(name, check) requires a function.');
    if (this.frozen) throw new Error('Health registry is frozen.');
    const key = String(name);
    if (this.checks.has(key) && options.replace !== true) throw new Error(`Health check '${key}' is already registered.`);
    const record = Object.freeze({
      name: key,
      check,
      kind: options.kind || 'dependency',
      critical: options.critical !== false,
      timeoutMs: Math.max(1, Number(options.timeoutMs) || this.timeoutMs),
      tags: Object.freeze(Array.from(new Set(options.tags || []))),
      description: options.description || '',
      cacheTtlMs: Math.max(0, Number(options.cacheTtlMs ?? this.cacheTtlMs) || 0),
      enabled: options.enabled !== false,
    });
    this.cache.delete(key);
    this.checks.set(key, record);
    this.emit('registered', publicCheck(record));
    return () => this.checks.get(key) === record ? this.unregister(key) : false;
  }

  unregister(name) { this.cache.delete(String(name)); return this.checks.delete(String(name)); }
  freeze() { this.frozen = true; return this; }
  list() { return Object.freeze(Array.from(this.checks.values(), publicCheck)); }

  async ready(context = {}) { return await this.run({ ...context, kinds: ['readiness', 'dependency'] }); }
  async live(context = {}) { return await this.run({ ...context, kinds: ['liveness'] }); }
  async all(context = {}) { return await this.run(context); }

  async run(options = {}) {
    const started = process.hrtime.bigint();
    const kinds = options.kinds ? new Set(options.kinds) : null;
    const tags = options.tags ? new Set(options.tags) : null;
    const selected = Array.from(this.checks.values()).filter((record) => record.enabled && (!kinds || kinds.has(record.kind)) && (!tags || record.tags.some((tag) => tags.has(tag))));
    const results = new Array(selected.length);
    let cursor = 0;
    this.stats.runs++;
    await Promise.all(Array.from({ length: Math.min(this.concurrency, selected.length || 1) }, async () => {
      while (cursor < selected.length) {
        const index = cursor++;
        results[index] = await this._runCheck(selected[index], options);
      }
    }));

    const criticalFailures = results.filter((item) => item.critical && item.status === HealthStatus.UNHEALTHY);
    const degraded = results.filter((item) => item.status === HealthStatus.DEGRADED || (!item.critical && item.status === HealthStatus.UNHEALTHY));
    const report = deepFreeze({
      ok: criticalFailures.length === 0,
      ready: criticalFailures.length === 0,
      live: criticalFailures.length === 0,
      status: criticalFailures.length ? HealthStatus.UNHEALTHY : degraded.length ? HealthStatus.DEGRADED : HealthStatus.HEALTHY,
      timestamp: Date.now(),
      durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      counts: {
        total: results.length,
        healthy: results.filter((item) => item.status === HealthStatus.HEALTHY).length,
        degraded: degraded.length,
        unhealthy: results.filter((item) => item.status === HealthStatus.UNHEALTHY).length,
        skipped: results.filter((item) => item.status === HealthStatus.SKIPPED).length,
      },
      checks: results,
    });
    this.history.push(report);
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    this.emit('report', report);
    return report;
  }

  async _runCheck(record, options) {
    const cached = this.cache.get(record.name);
    if (cached && cached.expiresAt > Date.now() && options.fresh !== true) { this.stats.cacheHits++; return cached.value; }
    const started = process.hrtime.bigint();
    this.stats.checks++;
    let result;
    try {
      const value = await withTimeout((signal) => {
        if (this.pending.has(record)) throw Object.assign(new Error('Health check is still pending.'), {code:'MONITOR_COLLECTOR_BUSY'});
        const task = Promise.resolve().then(() => record.check({ ...options, signal, name: record.name, kind: record.kind }));
        this.pending.set(record, task);
        task.finally(() => this.pending.delete(record)).catch(() => {});
        return task;
      }, record.timeoutMs, { signal: options.signal, message: `Health check '${record.name}' exceeded ${record.timeoutMs}ms.` });
      result = normalizeResult(record, value, Number(process.hrtime.bigint() - started) / 1e6);
    } catch (error) {
      this.stats.failures++;
      if (error?.code === 'MONITOR_TIMEOUT') this.stats.timeouts++;
      result = deepFreeze({
        name: record.name,
        kind: record.kind,
        critical: record.critical,
        status: HealthStatus.UNHEALTHY,
        ok: false,
        ready: false,
        live: false,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        timestamp: Date.now(),
        message: error?.message || String(error),
        error: errorRecord(error, { stack: options.includeStack === true }),
        details: null,
        tags: record.tags,
      });
    }
    if (record.cacheTtlMs > 0 && this.checks.get(record.name) === record) this.cache.set(record.name, { value: result, expiresAt: Date.now() + record.cacheTtlMs });
    this.emit('check', result);
    return result;
  }

  latest() { return this.history.at(-1) || null; }
  historySnapshot(options = {}) { return Object.freeze(this.history.slice(-(Math.max(1, Number(options.limit) || this.historyLimit)))); }
  snapshot() { return deepFreeze({ frozen: this.frozen, checks: this.list(), latest: this.latest(), history: this.history.length, stats: { ...this.stats } }); }
}

function normalizeResult(record, value, durationMs) {
  if (value === false) value = { ok: false };
  else if (value === true || value == null) value = { ok: true };
  else if (typeof value !== 'object') value = { ok: Boolean(value), value };
  let status = value.status;
  if (!Object.values(HealthStatus).includes(status)) status = value.ok === false || (record.kind === 'liveness' ? value.live === false : value.ready === false) ? HealthStatus.UNHEALTHY : value.degraded === true ? HealthStatus.DEGRADED : HealthStatus.HEALTHY;
  return deepFreeze({
    name: record.name,
    kind: record.kind,
    critical: record.critical,
    status,
    ok: status !== HealthStatus.UNHEALTHY,
    ready: value.ready ?? status !== HealthStatus.UNHEALTHY,
    live: value.live ?? status !== HealthStatus.UNHEALTHY,
    durationMs,
    timestamp: Date.now(),
    message: value.message || null,
    details: value.details ?? value.snapshot ?? value.value ?? null,
    tags: record.tags,
  });
}

function publicCheck(record) { return Object.freeze({ name: record.name, kind: record.kind, critical: record.critical, timeoutMs: record.timeoutMs, tags: record.tags, description: record.description, enabled: record.enabled }); }

export default HealthRegistry;
