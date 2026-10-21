'use strict';

import { deepFreeze } from '../support/safe.js';

export class UniversalEventMetrics {
  constructor(options = {}) {
    this.enabled = options.enabled === true;
    this.prefix = String(options.prefix || 'rawnode_events_fabric').replace(/[^a-zA-Z0-9_:]/g, '_');
    this.maxSeries = Math.max(1, Number(options.maxSeries) || 2_048);
    this.counters = new Map();
    this.histograms = new Map();
    this.overflow = 0;
    this.createdAt = Date.now();
  }

  increment(name, value = 1, labels = null) { if (!this.enabled) return; const key = this._key(name, labels); if (!key) return; this.counters.set(key, (this.counters.get(key) || 0) + Number(value || 0)); }
  observe(name, value, labels = null) {
    if (!this.enabled) return;
    const key = this._key(name, labels); if (!key) return;
    const current = this.histograms.get(key) || { count: 0, sum: 0, min: Infinity, max: -Infinity };
    const number = Number(value) || 0; current.count++; current.sum += number; current.min = Math.min(current.min, number); current.max = Math.max(current.max, number); this.histograms.set(key, current);
  }
  _key(name, labels) {
    const suffix = labels && typeof labels === 'object' ? `{${Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${normalizeLabel(value)}`).join(',')}}` : '';
    const key = `${String(name)}${suffix}`;
    if (this.counters.has(key) || this.histograms.has(key)) return key;
    if (this.counters.size + this.histograms.size >= this.maxSeries) { this.overflow++; return null; }
    return key;
  }
  snapshot() { return deepFreeze({ enabled: this.enabled, prefix: this.prefix, uptimeMs: Date.now() - this.createdAt, counters: Object.fromEntries(this.counters), histograms: Object.fromEntries([...this.histograms].map(([key, value]) => [key, { ...value, average: value.count ? value.sum / value.count : 0 }])), overflow: this.overflow }); }
  prometheus(prefix = this.prefix) {
    const lines = [];
    for (const [key, value] of this.counters) { const { name, labels } = parseKey(key); lines.push(`${metric(prefix, name)}${labels} ${value}`); }
    for (const [key, value] of this.histograms) { const { name, labels } = parseKey(key); const base = metric(prefix, name); lines.push(`${base}_count${labels} ${value.count}`, `${base}_sum${labels} ${value.sum}`, `${base}_min${labels} ${Number.isFinite(value.min) ? value.min : 0}`, `${base}_max${labels} ${Number.isFinite(value.max) ? value.max : 0}`); }
    lines.push(`${metric(prefix, 'series_overflow_total')} ${this.overflow}`);
    return `${lines.join('\n')}\n`;
  }
  reset() { this.counters.clear(); this.histograms.clear(); this.overflow = 0; }
}
function normalizeLabel(value) { return String(value ?? '').replace(/[{},=\s]/g, '_').slice(0, 128); }
function metric(prefix, name) { return `${prefix}_${String(name).replace(/[^a-zA-Z0-9_:]/g, '_')}`; }
function parseKey(key) { const index = key.indexOf('{'); if (index === -1) return { name: key, labels: '' }; const pairs = key.slice(index + 1, -1).split(',').filter(Boolean).map((pair) => { const at = pair.indexOf('='); return `${pair.slice(0, at)}="${pair.slice(at + 1)}"`; }).join(','); return { name: key.slice(0, index), labels: pairs ? `{${pairs}}` : '' }; }
export default UniversalEventMetrics;
