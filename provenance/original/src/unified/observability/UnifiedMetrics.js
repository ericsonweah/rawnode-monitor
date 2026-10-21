'use strict';

import { monitorEventLoopDelay } from 'node:perf_hooks';

function metricName(value) { return String(value || '').replace(/[^a-zA-Z0-9_:]/g, '_'); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function milliseconds(value) { return Number.isFinite(value) ? value / 1e6 : 0; }

export class UnifiedMetrics {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.prefix = metricName(options.prefix || 'rawnode_unified');
    this.createdAt = Date.now();
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this._eventLoopFinal = null;
    this._eventLoop = null;
    if (this.enabled && options.eventLoopMonitoring !== false) {
      try {
        this._eventLoop = monitorEventLoopDelay({
          resolution: Math.max(1, Math.trunc(Number(options.eventLoopResolutionMs) || 20)),
        });
        this._eventLoop.enable();
      } catch {
        this._eventLoop = null;
      }
    }
  }

  inc(name, value = 1) {
    if (!this.enabled) return 0;
    const key = metricName(name);
    const next = finite(this.counters.get(key)) + finite(value);
    this.counters.set(key, next);
    return next;
  }

  set(name, value) {
    if (!this.enabled) return 0;
    const key = metricName(name);
    const next = finite(value);
    this.gauges.set(key, next);
    return next;
  }

  observe(name, value) {
    if (!this.enabled) return null;
    const key = metricName(name);
    const number = finite(value);
    const current = this.histograms.get(key) || { count: 0, sum: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY };
    current.count++;
    current.sum += number;
    current.min = Math.min(current.min, number);
    current.max = Math.max(current.max, number);
    this.histograms.set(key, current);
    return current;
  }

  eventLoopSnapshot() {
    if (this._eventLoopFinal) return { ...this._eventLoopFinal };
    const loop = this._eventLoop;
    if (!loop) return null;
    return {
      minMs: milliseconds(loop.min),
      maxMs: milliseconds(loop.max),
      meanMs: milliseconds(loop.mean),
      stddevMs: milliseconds(loop.stddev),
      p50Ms: milliseconds(loop.percentile(50)),
      p95Ms: milliseconds(loop.percentile(95)),
      p99Ms: milliseconds(loop.percentile(99)),
    };
  }

  snapshot(extra = null) {
    const histograms = {};
    for (const [name, value] of this.histograms) {
      histograms[name] = {
        count: value.count,
        sum: value.sum,
        min: value.count ? value.min : 0,
        max: value.count ? value.max : 0,
        average: value.count ? value.sum / value.count : 0,
      };
    }
    return {
      enabled: this.enabled,
      prefix: this.prefix,
      uptimeMs: Date.now() - this.createdAt,
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms,
      eventLoopDelay: this.eventLoopSnapshot(),
      ...(extra && typeof extra === 'object' ? extra : {}),
    };
  }

  prometheus(extra = null) {
    if (!this.enabled) return '';
    const lines = [];
    for (const [name, value] of this.counters) {
      const full = `${this.prefix}_${name}`;
      lines.push(`# TYPE ${full} counter`, `${full} ${finite(value)}`);
    }
    for (const [name, value] of this.gauges) {
      const full = `${this.prefix}_${name}`;
      lines.push(`# TYPE ${full} gauge`, `${full} ${finite(value)}`);
    }
    for (const [name, value] of this.histograms) {
      const full = `${this.prefix}_${name}`;
      lines.push(`# TYPE ${full} summary`, `${full}_count ${value.count}`, `${full}_sum ${value.sum}`);
    }
    const eventLoop = this.eventLoopSnapshot();
    if (eventLoop) {
      for (const [name, value] of Object.entries(eventLoop)) {
        const full = `${this.prefix}_event_loop_delay_${metricName(name.replace(/Ms$/, ''))}_ms`;
        lines.push(`# TYPE ${full} gauge`, `${full} ${finite(value)}`);
      }
    }
    if (extra && typeof extra === 'object') {
      for (const [name, value] of Object.entries(extra)) {
        if (!Number.isFinite(Number(value))) continue;
        const full = `${this.prefix}_${metricName(name)}`;
        lines.push(`# TYPE ${full} gauge`, `${full} ${Number(value)}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }

  close() {
    if (!this._eventLoop) return this;
    this._eventLoopFinal = this.eventLoopSnapshot();
    try { this._eventLoop.disable(); } catch {}
    this._eventLoop = null;
    return this;
  }
}

export default UnifiedMetrics;
