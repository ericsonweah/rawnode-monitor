'use strict';

import { EventEmitter } from 'node:events';
import { SignalKind } from '../constants.js';
import { boundedInteger, deepFreeze, labelsKey, normalizeLabels, randomId } from '../support.js';

/** Bounded trend detector for monotonic memory/resource leaks. */
export class LeakDetector extends EventEmitter {
  constructor(options = {}) {
    super();
    this.enabled = options.enabled !== false;
    this.signal = options.signal || null;
    this.maxSeries = boundedInteger(options.maxSeries, 2_000, 1, 100_000);
    this.maxSamples = boundedInteger(options.maxSamples, 120, 4, 10_000);
    this.rules = new Map();
    this.series = new Map();
    this.states = new Map();
    this.frozen = false;
    this.stats = { observations: 0, evaluations: 0, leaks: 0, recoveries: 0, seriesRejected: 0 };
  }

  register(input = {}, options = {}) {
    if (this.frozen) throw new Error('Leak detector definitions are frozen.');
    const rule = normalizeRule(input, this.maxSamples);
    if (this.rules.has(rule.id) && options.replace !== true) throw new Error(`Leak rule '${rule.id}' is already registered.`);
    this.rules.set(rule.id, rule);
    return rule;
  }

  observe(metric, value, labels = {}, timestamp = Date.now(), context = {}) {
    if (!this.enabled || !Number.isFinite(Number(value))) return [];
    this.stats.observations++;
    const output = [];
    for (const rule of this.rules.values()) {
      if (!match(rule.metric, metric) || !labelsMatch(rule.labels, labels)) continue;
      const normalized = normalizeLabels(labels, { maxLabels: 32, maxValueBytes: 256 });
      const key = `${rule.id}\0${labelsKey(normalized)}`;
      let samples = this.series.get(key);
      if (!samples) {
        if (this.series.size >= this.maxSeries) { this.stats.seriesRejected++; continue; }
        samples = [];
        this.series.set(key, samples);
      }
      samples.push({ value: Number(value), timestamp: Number(timestamp) || Date.now() });
      if (samples.length > rule.windowSamples) samples.splice(0, samples.length - rule.windowSamples);
      if (samples.length < rule.minSamples) continue;
      const analysis = regression(samples);
      this.stats.evaluations++;
      const growth = samples[0].value === 0 ? (samples.at(-1).value > 0 ? Infinity : 0) : (samples.at(-1).value - samples[0].value) / Math.abs(samples[0].value);
      const firing = analysis.slopePerMinute >= rule.minSlopePerMinute && growth >= rule.minGrowthRatio && analysis.r2 >= rule.minR2;
      const previous = this.states.get(key) || { firing: false, lastEmittedAt: 0 };
      const now = Date.now();
      if (firing && (!previous.firing || now - previous.lastEmittedAt >= rule.cooldownMs)) {
        const record = deepFreeze({ id: randomId('leak'), ruleId: rule.id, name: rule.name, metric: String(metric), labels: normalized, state: 'firing', severity: rule.severity, analysis: { ...analysis, growthRatio: growth, samples: samples.length }, timestamp: now, context, runbook: rule.runbook, tags: rule.tags });
        previous.firing = true; previous.lastEmittedAt = now; previous.last = record;
        this.stats.leaks++; this.emit('leak', record); this.signal?.(SignalKind.ANOMALY, { type: 'leak', ...record }, { timestamp: now, priority: rule.severity === 'critical' ? 20 : 10, context }); output.push(record);
      } else if (!firing && previous.firing) {
        const record = deepFreeze({ id: randomId('leak'), ruleId: rule.id, name: rule.name, metric: String(metric), labels: normalized, state: 'recovered', severity: rule.severity, analysis: { ...analysis, growthRatio: growth, samples: samples.length }, timestamp: now, context, runbook: rule.runbook, tags: rule.tags });
        previous.firing = false; previous.last = record; this.stats.recoveries++; this.emit('recovery', record); this.signal?.(SignalKind.ANOMALY, { type: 'leak', ...record }, { timestamp: now, priority: 2, context }); output.push(record);
      }
      this.states.set(key, previous);
    }
    return output;
  }

  observeSnapshot(snapshot = {}, context = {}) {
    const output = [];
    for (const [metric, definition] of Object.entries(snapshot.metrics || {})) {
      for (const series of definition.series || []) {
        const value = ['histogram', 'timer'].includes(definition.type) ? series.mean : series.value;
        output.push(...this.observe(metric, value, series.labels, snapshot.timestamp, context));
      }
    }
    return output;
  }


  alertRule(id, options = {}) {
    const rule = this.rules.get(String(id));
    if (!rule) return null;
    return {
      id: options.id || `leak:${rule.id}`,
      name: options.name || `Leak trend: ${rule.name}`,
      severity: options.severity || rule.severity,
      source: 'custom',
      incident: options.incident ?? rule.incident,
      runbook: options.runbook || rule.runbook,
      tags: [...rule.tags, 'leak'],
      evaluate: () => {
        const firing = this.current().filter((item) => item.key.startsWith(`${rule.id}\0`));
        return { firing: firing.length > 0, value: firing.length, details: { series: firing.slice(0, 100) } };
      },
    };
  }

  current() { return deepFreeze(Array.from(this.states, ([key, state]) => ({ key, ...state })).filter((item) => item.firing)); }
  freeze() { this.frozen = true; return this; }
  close() { this.removeAllListeners(); this.rules.clear(); this.series.clear(); this.states.clear(); }
  snapshot(options = {}) { return deepFreeze({ enabled: this.enabled, frozen: this.frozen, rules: Array.from(this.rules.values()), active: this.current(), series: options.includeSeries ? Array.from(this.series, ([key, samples]) => ({ key, samples: [...samples] })) : undefined, stats: { ...this.stats } }); }
}

function normalizeRule(input, maxSamples) {
  const id = String(input.id || input.name || '').trim(); if (!id) throw new TypeError('Leak rules require an id.');
  return deepFreeze({ id, name: String(input.name || id), metric: input.metric instanceof RegExp ? input.metric : String(input.metric || '*'), labels: normalizeLabels(input.labels || {}, { maxLabels: 32, maxValueBytes: 256 }), windowSamples: boundedInteger(input.windowSamples, maxSamples, 4, 10_000), minSamples: boundedInteger(input.minSamples, 20, 4, 10_000), minSlopePerMinute: Math.max(0, Number(input.minSlopePerMinute || 1)), minGrowthRatio: Math.max(0, Number(input.minGrowthRatio ?? 0.1)), minR2: Math.max(0, Math.min(1, Number(input.minR2 ?? 0.8))), cooldownMs: boundedInteger(input.cooldownMs, 10 * 60_000, 0, 24 * 60 * 60_000), severity: String(input.severity || 'warning'), incident: input.incident === true, alert: input.alert !== false, runbook: input.runbook || null, tags: Object.freeze(Array.from(new Set((input.tags || []).map(String)))) });
}
function regression(samples) { const t0 = samples[0].timestamp; const points = samples.map((sample) => ({ x: (sample.timestamp - t0) / 60_000, y: sample.value })); const n = points.length; const meanX = points.reduce((sum, point) => sum + point.x, 0) / n; const meanY = points.reduce((sum, point) => sum + point.y, 0) / n; let sxx = 0; let sxy = 0; let syy = 0; for (const point of points) { const dx = point.x - meanX; const dy = point.y - meanY; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; } const slope = sxx > 0 ? sxy / sxx : 0; const intercept = meanY - slope * meanX; const r2 = sxx > 0 && syy > 0 ? Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy))) : 0; return { slopePerMinute: slope, intercept, r2, durationMinutes: points.at(-1).x, startValue: samples[0].value, endValue: samples.at(-1).value }; }
function match(pattern, value) { if (pattern instanceof RegExp) return pattern.test(value); if (pattern === '*') return true; if (!String(pattern).includes('*')) return String(pattern) === String(value); const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'); return new RegExp(`^${escaped}$`).test(value); }
function labelsMatch(expected, actual) { for (const [key, value] of Object.entries(expected || {})) if (String(actual?.[key] ?? '') !== String(value)) return false; return true; }
export default LeakDetector;
