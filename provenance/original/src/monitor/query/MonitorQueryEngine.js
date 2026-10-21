'use strict';

import { deepFreeze, safeGet } from '../support.js';

/** Safe bounded query/aggregation layer over telemetry stores. */
export class MonitorQueryEngine {
  constructor(options = {}) {
    this.store = options.store;
    this.tracer = options.tracer || null;
    this.metrics = options.metrics || null;
    this.alerts = options.alerts || null;
    this.incidents = options.incidents || null;
    this.slos = options.slos || null;
    this.resources = options.resources || null;
    this.maxLimit = Math.max(1, Number(options.maxLimit) || 10_000);
    this.maxGroups = Math.max(1, Number(options.maxGroups) || 10_000);
    this.stats = { queries: 0, aggregations: 0, rejected: 0 };
  }

  async signals(options = {}) {
    this.stats.queries++;
    const limit = boundedLimit(options.limit, this.maxLimit);
    return await this.store.query({ ...options, limit });
  }
  spans(options = {}) { this.stats.queries++; return this.tracer?.query({ ...options, limit: boundedLimit(options.limit, this.maxLimit) }) || []; }
  trace(traceId) { this.stats.queries++; return this.tracer?.traceById(traceId) || []; }
  metric(name = null) { this.stats.queries++; const snapshot = this.metrics?.snapshot() || null; return name ? snapshot?.metrics?.[name] || this.metrics?.get?.(name)?.snapshot?.() || null : snapshot; }
  alertState(options = {}) { this.stats.queries++; return this.alerts?.current(options) || []; }
  incidentState(options = {}) { this.stats.queries++; return this.incidents?.list({ ...options, limit: boundedLimit(options.limit, this.maxLimit) }) || []; }
  sloState(id = null) { this.stats.queries++; return id ? this.slos?.get(id) || null : this.slos?.all() || {}; }
  resourceState(name = null) { this.stats.queries++; return name ? this.resources?.latestSnapshot(name) || null : this.resources?.latestSnapshot() || {}; }

  async aggregate(options = {}) {
    this.stats.aggregations++;
    const result = await this.signals({ ...options, limit: boundedLimit(options.scanLimit || options.limit || this.maxLimit, this.maxLimit) });
    const rows = result.items || [];
    const field = options.field || 'payload.value';
    const groupBy = Array.isArray(options.groupBy) ? options.groupBy : options.groupBy ? [options.groupBy] : [];
    const operation = String(options.operation || 'count').toLowerCase();
    const groups = new Map();
    for (const row of rows) {
      const keyValues = groupBy.map((path) => safeGet(row, path, null));
      const key = JSON.stringify(keyValues);
      if (!groups.has(key) && groups.size >= this.maxGroups) { this.stats.rejected++; break; }
      const current = groups.get(key) || { key: keyValues, count: 0, sum: 0, min: Infinity, max: -Infinity, values: [] };
      const value = Number(safeGet(row, field));
      current.count++;
      if (Number.isFinite(value)) { current.sum += value; current.min = Math.min(current.min, value); current.max = Math.max(current.max, value); if (operation.startsWith('p')) current.values.push(value); }
      groups.set(key, current);
    }
    const output = Array.from(groups.values(), (entry) => ({ labels: Object.fromEntries(groupBy.map((name, index) => [name, entry.key[index]])), value: aggregateValue(entry, operation), count: entry.count }));
    output.sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    return deepFreeze({ operation, field, groupBy, scanned: rows.length, groups: output.slice(0, boundedLimit(options.groupLimit, this.maxGroups)) });
  }

  async timeSeries(options = {}) {
    const intervalMs = Math.max(1_000, Number(options.intervalMs) || 60_000);
    const result = await this.signals({ ...options, limit: boundedLimit(options.scanLimit || this.maxLimit, this.maxLimit), order: 'asc' });
    const field = options.field || 'payload.value';
    const buckets = new Map();
    for (const row of result.items || []) {
      const timestamp = Number(row.timestamp || 0);
      const start = Math.floor(timestamp / intervalMs) * intervalMs;
      const current = buckets.get(start) || { timestamp: start, count: 0, sum: 0, min: Infinity, max: -Infinity };
      const value = Number(safeGet(row, field));
      current.count++;
      if (Number.isFinite(value)) { current.sum += value; current.min = Math.min(current.min, value); current.max = Math.max(current.max, value); }
      buckets.set(start, current);
    }
    return deepFreeze({ intervalMs, points: Array.from(buckets.values(), (bucket) => ({ ...bucket, avg: bucket.count ? bucket.sum / bucket.count : 0, min: bucket.min === Infinity ? null : bucket.min, max: bucket.max === -Infinity ? null : bucket.max })).sort((a, b) => a.timestamp - b.timestamp) });
  }

  snapshot() { return Object.freeze({ maxLimit: this.maxLimit, maxGroups: this.maxGroups, stats: Object.freeze({ ...this.stats }) }); }
}
function boundedLimit(value, maximum) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : Math.min(100, maximum); }
function aggregateValue(entry, operation) {
  if (operation === 'count') return entry.count;
  if (operation === 'sum') return entry.sum;
  if (operation === 'avg' || operation === 'average') return entry.count ? entry.sum / entry.count : 0;
  if (operation === 'min') return entry.min === Infinity ? null : entry.min;
  if (operation === 'max') return entry.max === -Infinity ? null : entry.max;
  const percentile = /^p(\d+(?:\.\d+)?)$/.exec(operation);
  if (percentile) { const values = entry.values.sort((a, b) => a - b); if (!values.length) return null; const rank = Math.min(values.length - 1, Math.max(0, Math.ceil((Number(percentile[1]) / 100) * values.length) - 1)); return values[rank]; }
  return entry.count;
}
export default MonitorQueryEngine;
