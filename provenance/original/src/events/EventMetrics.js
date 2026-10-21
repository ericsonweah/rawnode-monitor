'use strict';

// src/events/EventMetrics.js

import { formatPrometheusSnapshot } from './observability/PrometheusFormatter.js';

export class EventMetrics {
  constructor(options = {}) {
    this.stats = new Map();
    this.maxSeries = Math.max(1, Number(options.maxSeries) || 2048);
    this.prefix = options.prefix || 'rawnode_events';
  }

  record(event, duration, error = null) {
    const name = this.stats.has(event) || this.stats.size < this.maxSeries ? String(event) : '__overflow__';
    const record = this.stats.get(name) || {
      count: 0,
      failures: 0,
      totalTime: 0,
      minTime: Infinity,
      maxTime: 0,
      lastTime: 0,
    };
    const ms = Number(duration) || 0;
    record.count++;
    record.totalTime += ms;
    record.minTime = Math.min(record.minTime, ms);
    record.maxTime = Math.max(record.maxTime, ms);
    record.lastTime = ms;
    if (error) record.failures++;
    this.stats.set(name, record);
    return this;
  }

  reset() { this.stats.clear(); return this; }

  snapshot() {
    const output = {};
    for (const [event, record] of this.stats) {
      output[event] = {
        ...record,
        minTime: Number.isFinite(record.minTime) ? record.minTime : 0,
        averageTime: record.count ? record.totalTime / record.count : 0,
      };
    }
    return output;
  }

  prometheus(prefix = this.prefix) {
    const series = Object.entries(this.snapshot()).map(([eventName, record]) => ({
      eventName,
      count: record.count,
      errorCount: record.failures,
      totalMs: record.totalTime,
      minMs: record.minTime,
      maxMs: record.maxTime,
    }));
    return formatPrometheusSnapshot({ counters: {}, series, histogram: {} }, prefix);
  }
}

export default EventMetrics;
