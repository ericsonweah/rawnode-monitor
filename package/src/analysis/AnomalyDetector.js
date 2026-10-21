'use strict';

import { EventEmitter } from 'node:events';
import { SignalKind } from '../constants.js';
import StreamingBaseline from './StreamingBaseline.js';
import { boundedInteger, boundedNumber, deepFreeze, labelsKey, normalizeLabels, randomId } from '../support.js';

const METHODS = new Set(['mad', 'zscore', 'relative', 'absolute']);
const DIRECTIONS = new Set(['both', 'high', 'low']);

/** Adaptive, bounded anomaly detector for metric series. */
export class AnomalyDetector extends EventEmitter {
  constructor(options = {}) {
    super();
    this.enabled = options.enabled !== false;
    this.signal = options.signal || null;
    this.maxRules = boundedInteger(options.maxRules, 1_000, 1, 100_000);
    this.maxSeries = boundedInteger(options.maxSeries, 10_000, 1, 1_000_000);
    this.baselineSamples = boundedInteger(options.baselineSamples, 256, 4, 100_000);
    this.warmupSamples = boundedInteger(options.warmupSamples, 20, 2, this.baselineSamples);
    this.alpha = boundedNumber(options.alpha, 0.2, 0.001, 1);
    this.defaultCooldownMs = boundedInteger(options.cooldownMs, 5 * 60_000, 0, 24 * 60 * 60_000);
    this.emitRecoveries = options.emitRecoveries !== false;
    this.rules = new Map();
    this.baselines = new Map();
    this.lastValues = new Map();
    this.states = new Map();
    this.frozen = false;
    this.stats = { observations: 0, evaluated: 0, anomalies: 0, recoveries: 0, suppressed: 0, seriesRejected: 0, invalid: 0 };
  }

  register(input = {}, options = {}) {
    if (this.frozen) throw new Error('Anomaly detector definitions are frozen.');
    if (this.rules.size >= this.maxRules && !this.rules.has(String(input.id))) throw new Error(`Anomaly rule limit of ${this.maxRules} exceeded.`);
    const rule = normalizeRule(input, { baselineSamples: this.baselineSamples, warmupSamples: this.warmupSamples, alpha: this.alpha, cooldownMs: this.defaultCooldownMs });
    if (this.rules.has(rule.id) && options.replace !== true) throw new Error(`Anomaly rule '${rule.id}' is already registered.`);
    this.rules.set(rule.id, rule);
    return rule;
  }

  unregister(id) {
    const key = String(id);
    for (const seriesKey of this.baselines.keys()) if (seriesKey.startsWith(`${key}\0`)) this.baselines.delete(seriesKey);
    for (const seriesKey of this.lastValues.keys()) if (seriesKey.startsWith(`${key}\0`)) this.lastValues.delete(seriesKey);
    for (const seriesKey of this.states.keys()) if (seriesKey.startsWith(`${key}\0`)) this.states.delete(seriesKey);
    return this.rules.delete(key);
  }

  observe(metric, input, labels = {}, context = {}) {
    if (!this.enabled) return [];
    const value = Number(input);
    if (!Number.isFinite(value)) { this.stats.invalid++; return []; }
    this.stats.observations++;
    const output = [];
    for (const rule of this.rules.values()) {
      if (!matchesMetric(rule.metric, metric) || !matchesLabels(rule.labels, labels)) continue;
      const result = this._observeRule(rule, String(metric), value, labels, context);
      if (result) output.push(result);
    }
    return output;
  }

  observeSnapshot(snapshot = {}, context = {}) {
    const output = [];
    for (const [metric, definition] of Object.entries(snapshot.metrics || {})) {
      for (const series of definition.series || []) {
        const value = metricValue(definition, series);
        if (value == null) continue;
        output.push(...this.observe(metric, value, series.labels || {}, { ...context, statistic: definition.type === 'histogram' || definition.type === 'timer' ? 'mean' : 'value', snapshotTimestamp: snapshot.timestamp }));
      }
    }
    return output;
  }

  _observeRule(rule, metric, rawValue, labels, context) {
    const normalizedLabels = normalizeLabels(labels, { maxLabels: 32, maxValueBytes: 256 });
    const seriesIdentity = labelsKey(normalizedLabels);
    const key = `${rule.id}\0${seriesIdentity}`;
    let value = rawValue;
    if (rule.delta) {
      const previous = this.lastValues.get(key);
      this.lastValues.set(key, rawValue);
      if (previous == null) return null;
      value = rawValue - previous;
      if (rule.monotonic && value < 0) return null;
    }
    let baseline = this.baselines.get(key);
    if (!baseline) {
      if (this.baselines.size >= this.maxSeries) { this.stats.seriesRejected++; return null; }
      baseline = new StreamingBaseline({ maxSamples: rule.baselineSamples, minSamples: rule.warmupSamples, alpha: rule.alpha });
      this.baselines.set(key, baseline);
    }
    const analysis = baseline.observeAndAnalyze(value, { method: rule.method, minSamples: rule.warmupSamples, timestamp: context.snapshotTimestamp || Date.now() });
    this.stats.evaluated++;
    const state = this.states.get(key) || { firing: false, lastEmittedAt: 0, normalSamples: 0, last: null };
    const firing = analysis.warm && isAnomalous(rule, analysis);
    const now = Date.now();
    let emitted = null;

    if (firing) {
      state.normalSamples = 0;
      const cooldownElapsed = now - state.lastEmittedAt >= rule.cooldownMs;
      if (!state.firing || cooldownElapsed) {
        emitted = deepFreeze({
          id: randomId('anomaly'),
          ruleId: rule.id,
          name: rule.name,
          metric,
          labels: normalizedLabels,
          severity: rule.severity,
          state: 'firing',
          value,
          rawValue,
          analysis,
          timestamp: now,
          context,
          tags: rule.tags,
          runbook: rule.runbook,
        });
        state.lastEmittedAt = now;
        this.stats.anomalies++;
        this.emit('anomaly', emitted);
        this.signal?.(SignalKind.ANOMALY, emitted, { timestamp: now, priority: priority(rule.severity), context });
      } else this.stats.suppressed++;
      state.firing = true;
    } else if (state.firing) {
      state.normalSamples++;
      if (state.normalSamples >= rule.recoverySamples) {
        state.firing = false;
        state.normalSamples = 0;
        if (this.emitRecoveries) {
          emitted = deepFreeze({ id: randomId('anomaly'), ruleId: rule.id, name: rule.name, metric, labels: normalizedLabels, severity: rule.severity, state: 'recovered', value, rawValue, analysis, timestamp: now, context, tags: rule.tags, runbook: rule.runbook });
          this.stats.recoveries++;
          this.emit('recovery', emitted);
          this.signal?.(SignalKind.ANOMALY, emitted, { timestamp: now, priority: 2, context });
        }
      }
    }
    state.last = { value, rawValue, analysis, timestamp: now };
    this.states.set(key, state);
    return emitted;
  }

  current(ruleId = null) {
    const output = [];
    for (const [key, state] of this.states) {
      const [id, series] = key.split('\0');
      if (ruleId && id !== String(ruleId)) continue;
      output.push({ ruleId: id, series, firing: state.firing, lastEmittedAt: state.lastEmittedAt, last: state.last });
    }
    return deepFreeze(output);
  }

  alertRule(id, options = {}) {
    const rule = this.rules.get(String(id));
    if (!rule) return null;
    return {
      id: options.id || `anomaly:${rule.id}`,
      name: options.name || `Adaptive anomaly: ${rule.name}`,
      severity: options.severity || rule.severity,
      source: 'custom',
      incident: options.incident ?? rule.incident,
      runbook: options.runbook || rule.runbook,
      tags: [...rule.tags, 'anomaly'],
      evaluate: () => {
        const firing = this.current(rule.id).filter((item) => item.firing);
        return { firing: firing.length > 0, value: firing.length, details: { series: firing.slice(0, 100) } };
      },
    };
  }

  freeze() { this.frozen = true; return this; }
  close() { this.removeAllListeners(); this.rules.clear(); this.baselines.clear(); this.lastValues.clear(); this.states.clear(); }
  snapshot(options = {}) { return deepFreeze({ enabled: this.enabled, frozen: this.frozen, rules: Array.from(this.rules.values()), active: this.current(), baselines: options.includeBaselines ? Array.from(this.baselines, ([key, value]) => ({ key, baseline: value.snapshot() })) : undefined, stats: { ...this.stats } }); }
}

function normalizeRule(input, defaults) {
  const id = String(input.id || input.name || '').trim();
  if (!id) throw new TypeError('Anomaly rules require an id.');
  const method = METHODS.has(String(input.method).toLowerCase()) ? String(input.method).toLowerCase() : 'mad';
  const direction = DIRECTIONS.has(String(input.direction).toLowerCase()) ? String(input.direction).toLowerCase() : 'both';
  const threshold = Number.isFinite(Number(input.threshold)) ? Number(input.threshold) : method === 'relative' ? 0.5 : method === 'absolute' ? 1 : 3.5;
  return deepFreeze({
    id,
    name: String(input.name || id),
    metric: input.metric instanceof RegExp ? input.metric : String(input.metric || '*'),
    labels: normalizeLabels(input.labels || {}, { maxLabels: 32, maxValueBytes: 256 }),
    method,
    direction,
    threshold: Math.max(0, threshold),
    minimum: Math.max(0, Number(input.minimum || input.minAbsolute || 0)),
    baselineSamples: boundedInteger(input.baselineSamples, defaults.baselineSamples, 4, 100_000),
    warmupSamples: boundedInteger(input.warmupSamples, defaults.warmupSamples, 2, 100_000),
    alpha: boundedNumber(input.alpha, defaults.alpha, 0.001, 1),
    cooldownMs: boundedInteger(input.cooldownMs, defaults.cooldownMs, 0, 24 * 60 * 60_000),
    recoverySamples: boundedInteger(input.recoverySamples, 3, 1, 10_000),
    delta: input.delta === true,
    monotonic: input.monotonic !== false,
    severity: String(input.severity || 'warning'),
    incident: input.incident === true,
    alert: input.alert !== false,
    runbook: input.runbook || null,
    tags: Object.freeze(Array.from(new Set((input.tags || []).map(String)))),
  });
}
function matchesMetric(pattern, metric) { if (pattern instanceof RegExp) return pattern.test(metric); if (pattern === '*') return true; if (!String(pattern).includes('*')) return String(pattern) === String(metric); const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'); return new RegExp(`^${escaped}$`).test(metric); }
function matchesLabels(expected, actual) { for (const [key, value] of Object.entries(expected || {})) if (String(actual?.[key] ?? '') !== String(value)) return false; return true; }
function metricValue(definition, series) { if (['histogram', 'timer'].includes(definition.type)) return Number.isFinite(Number(series.mean)) ? Number(series.mean) : null; return Number.isFinite(Number(series.value)) ? Number(series.value) : null; }
function isAnomalous(rule, analysis) { const delta = analysis.delta; if (Math.abs(delta) < rule.minimum) return false; const direction = rule.direction === 'high' ? delta > 0 : rule.direction === 'low' ? delta < 0 : true; if (!direction) return false; if (rule.method === 'relative') return analysis.relativeDeviation >= rule.threshold; if (rule.method === 'absolute') return Math.abs(delta) >= rule.threshold; return analysis.absoluteScore >= rule.threshold; }
function priority(severity) { return severity === 'critical' ? 20 : severity === 'error' ? 15 : severity === 'warning' ? 10 : 5; }
export default AnomalyDetector;
