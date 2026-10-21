'use strict';

import { formatPrometheusSnapshot } from './PrometheusFormatter.js';

const DEFAULT_BUCKETS = Object.freeze([0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000]);

function freshCounters() {
  return {
    dispatches_total: 0,
    listener_invocations_total: 0,
    listener_errors_total: 0,
    async_listener_rejections_total: 0,
    deferred_accepted_total: 0,
    deferred_rejected_total: 0,
    history_recorded_total: 0,
    history_rejected_total: 0,
    diagnostics_errors_total: 0,
    series_overflow_total: 0,
  };
}

export class EventMetricsStore {
  constructor(options = {}) {
    this.enabled = options.enabled === true;
    this.maxSeries = Math.max(1, Number(options.maxSeries) || 2048);
    this.prefix = options.prefix || 'rawnode_events';
    this.buckets = (Array.isArray(options.buckets) ? options.buckets : DEFAULT_BUCKETS).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    this.series = new Map();
    this.counters = freshCounters();
    this.histogram = new Map(this.buckets.map((bucket) => [bucket, 0]));
    this.histogram.set('+Inf', 0);
  }

  _series(eventName) {
    let record = this.series.get(eventName);
    if (record) return record;
    // Reserve one bounded slot for the overflow aggregate. This keeps the
    // total map size at or below maxSeries even under attacker-controlled or
    // naturally high-cardinality event names.
    const namedCapacity = Math.max(0, this.maxSeries - 1);
    if (this.series.size >= namedCapacity) {
      this.counters.series_overflow_total++;
      const overflow = '__overflow__';
      record = this.series.get(overflow);
      if (record) return record;
      eventName = overflow;
    }
    record = { count: 0, errorCount: 0, totalMs: 0, minMs: Infinity, maxMs: 0, lastMs: 0, lastAt: 0 };
    this.series.set(eventName, record);
    return record;
  }

  recordDispatch(eventName, ms, errorCount = 0, invoked = 0) {
    if (!this.enabled) return;
    this.counters.dispatches_total++;
    this.counters.listener_invocations_total += Math.max(0, Number(invoked) || 0);
    const record = this._series(String(eventName));
    record.count++;
    record.totalMs += Number(ms) || 0;
    record.minMs = Math.min(record.minMs, Number(ms) || 0);
    record.maxMs = Math.max(record.maxMs, Number(ms) || 0);
    record.lastMs = Number(ms) || 0;
    record.lastAt = Date.now();
    for (const bucket of this.buckets) if (ms <= bucket) this.histogram.set(bucket, this.histogram.get(bucket) + 1);
    this.histogram.set('+Inf', this.histogram.get('+Inf') + 1);
  }

  recordListenerError(eventName, options = {}) {
    if (!this.enabled) return;
    this.counters.listener_errors_total++;
    if (options.async) this.counters.async_listener_rejections_total++;
    this._series(String(eventName)).errorCount++;
  }

  increment(name, value = 1) {
    if (!this.enabled) return;
    if (!(name in this.counters)) this.counters[name] = 0;
    this.counters[name] += Number(value) || 0;
  }

  reset() {
    this.series.clear();
    this.counters = freshCounters();
    this.histogram = new Map(this.buckets.map((bucket) => [bucket, 0]));
    this.histogram.set('+Inf', 0);
  }

  snapshot() {
    const series = [];
    for (const [eventName, value] of this.series) {
      series.push({
        eventName,
        ...value,
        minMs: Number.isFinite(value.minMs) ? value.minMs : 0,
        avgMs: value.count ? value.totalMs / value.count : 0,
      });
    }
    return Object.freeze({
      enabled: this.enabled,
      maxSeries: this.maxSeries,
      counters: Object.freeze({ ...this.counters }),
      series: Object.freeze(series),
      histogram: Object.freeze(Object.fromEntries(this.histogram)),
    });
  }

  prometheus(prefix = this.prefix) { return formatPrometheusSnapshot(this.snapshot(), prefix); }
}

export default EventMetricsStore;
