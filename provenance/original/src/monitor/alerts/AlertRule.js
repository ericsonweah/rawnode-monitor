'use strict';

import { AlertRuleError } from '../errors.js';
import { deepFreeze, randomId, safeGet } from '../support.js';

const COMPARATORS = Object.freeze({
  gt: (value, threshold) => value > threshold,
  gte: (value, threshold) => value >= threshold,
  lt: (value, threshold) => value < threshold,
  lte: (value, threshold) => value <= threshold,
  eq: (value, threshold) => value === threshold,
  neq: (value, threshold) => value !== threshold,
  between: (value, threshold) => value >= threshold[0] && value <= threshold[1],
  outside: (value, threshold) => value < threshold[0] || value > threshold[1],
});

export class AlertRule {
  constructor(options = {}) {
    if (!options.name && !options.id) throw new AlertRuleError('Alert rule requires a stable name or id.');
    this.id = String(options.id || slug(options.name) || randomId('rule'));
    this.name = String(options.name || this.id);
    this.description = options.description || '';
    this.severity = options.severity || 'warning';
    this.enabled = options.enabled !== false;
    this.source = options.source || inferSource(options);
    this.metric = options.metric || null;
    this.path = options.path || null;
    this.labels = Object.freeze({ ...(options.labels || {}) });
    this.aggregate = options.aggregate || 'sum';
    this.comparator = options.comparator || options.operator || 'gt';
    this.threshold = options.threshold ?? 0;
    this.recoveryThreshold = options.recoveryThreshold ?? null;
    this.pendingForMs = Math.max(0, Number(options.pendingForMs ?? options.forMs ?? 0) || 0);
    this.resolveAfterMs = Math.max(0, Number(options.resolveAfterMs ?? 0) || 0);
    this.cooldownMs = Math.max(0, Number(options.cooldownMs ?? 5 * 60_000) || 0);
    this.consecutive = Math.max(1, Number(options.consecutive) || 1);
    this.missing = options.missing || 'ignore';
    this.groupBy = Object.freeze([...(options.groupBy || [])]);
    this.annotations = deepFreeze({ ...(options.annotations || {}) });
    this.tags = Object.freeze(Array.from(new Set(options.tags || [])));
    this.runbook = options.runbook || options.runbookUrl || null;
    this.query = options.query || null;
    this.evaluate = options.evaluate || null;
    this.incident = options.incident;
    this.channels = Object.freeze([...(options.channels || [])]);
    this.validate();
    Object.freeze(this);
  }

  validate() {
    if (this.evaluate != null && typeof this.evaluate !== 'function') throw new AlertRuleError(`Alert rule '${this.id}' evaluate must be a function.`);
    if (!this.evaluate && !COMPARATORS[this.comparator]) throw new AlertRuleError(`Alert rule '${this.id}' uses unsupported comparator '${this.comparator}'.`);
    if (!this.evaluate && this.source === 'metric' && !this.metric) throw new AlertRuleError(`Metric alert rule '${this.id}' requires metric.`);
    if (['between', 'outside'].includes(this.comparator) && (!Array.isArray(this.threshold) || this.threshold.length !== 2)) throw new AlertRuleError(`Alert rule '${this.id}' comparator '${this.comparator}' requires [min,max] threshold.`);
  }

  async test(context = {}) {
    if (this.evaluate) return normalizeEvaluation(await this.evaluate(context, this));
    const value = resolveValue(this, context);
    if (value == null || Number.isNaN(Number(value))) {
      if (this.missing === 'fire') return { firing: true, value: null, reason: 'missing' };
      if (this.missing === 'error') throw new AlertRuleError(`Alert rule '${this.id}' source value is missing.`);
      return { firing: false, value: null, reason: 'missing', skipped: true };
    }
    const firing = COMPARATORS[this.comparator](value, this.threshold);
    return { firing, value, threshold: this.threshold, comparator: this.comparator, reason: firing ? 'threshold-breached' : 'threshold-ok' };
  }

  recovered(value) {
    if (this.recoveryThreshold == null) return !COMPARATORS[this.comparator](value, this.threshold);
    return !COMPARATORS[this.comparator](value, this.recoveryThreshold);
  }

  toJSON() {
    return {
      id: this.id, name: this.name, description: this.description, severity: this.severity, enabled: this.enabled,
      source: this.source, metric: this.metric, path: this.path, labels: this.labels, aggregate: this.aggregate,
      comparator: this.comparator, threshold: this.threshold, recoveryThreshold: this.recoveryThreshold,
      pendingForMs: this.pendingForMs, resolveAfterMs: this.resolveAfterMs, cooldownMs: this.cooldownMs,
      consecutive: this.consecutive, missing: this.missing, groupBy: this.groupBy, annotations: this.annotations,
      tags: this.tags, runbook: this.runbook, incident: this.incident, channels: this.channels,
    };
  }
}

function inferSource(options) { if (options.metric) return 'metric'; if (options.slo) return 'slo'; if (options.health) return 'health'; if (options.resource) return 'resource'; return 'custom'; }
function slug(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function normalizeEvaluation(value) { if (typeof value === 'boolean') return { firing: value, value: value ? 1 : 0 }; if (typeof value === 'number') return { firing: value !== 0, value }; if (!value || typeof value !== 'object') return { firing: false, value: null, skipped: true }; return { firing: value.firing === true || value.ok === false, ...value }; }

function resolveValue(rule, context) {
  if (rule.source === 'metric') return metricValue(context.metrics, rule);
  if (rule.source === 'health') return healthValue(context.health, rule);
  if (rule.source === 'resource') return safeGet(context.resources, rule.path || rule.query, null);
  if (rule.source === 'slo') return safeGet(context.slos, rule.path || `${rule.query || rule.metric}.burnRate`, null);
  return safeGet(context, rule.path || rule.query, null);
}

export function metricValue(snapshot, rule) {
  const metric = snapshot?.metrics?.[rule.metric] || snapshot?.metrics?.metrics?.[rule.metric] || snapshot?.[rule.metric];
  if (!metric) return null;
  const series = (metric.series || []).filter((entry) => Object.entries(rule.labels || {}).every(([key, value]) => String(entry.labels?.[key]) === String(value)));
  const values = series.map((entry) => entry.value ?? entry.mean ?? entry.sum ?? entry.count).map(Number).filter(Number.isFinite);
  if (!values.length) return null;
  switch (rule.aggregate) {
    case 'max': return Math.max(...values);
    case 'min': return Math.min(...values);
    case 'avg': case 'mean': return values.reduce((sum, value) => sum + value, 0) / values.length;
    case 'count': return values.length;
    case 'last': return values.at(-1);
    default: return values.reduce((sum, value) => sum + value, 0);
  }
}
function healthValue(report, rule) { const check = (report?.checks || []).find((entry) => entry.name === (rule.query || rule.path)); if (check) return check.ok === false ? 0 : 1; return report?.ok === false ? 0 : 1; }

export { COMPARATORS as ALERT_COMPARATORS };
export default AlertRule;
