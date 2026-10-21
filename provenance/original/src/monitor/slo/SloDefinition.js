'use strict';

import { deepFreeze, randomId } from '../support.js';
import { metricValue } from '../alerts/AlertRule.js';

export class SloDefinition {
  constructor(options = {}) {
    if (!options.name && !options.id) throw new TypeError('SLO requires a stable id or name.');
    this.id = String(options.id || slug(options.name) || randomId('slo'));
    this.name = String(options.name || this.id);
    this.description = options.description || '';
    this.objective = Math.max(0, Math.min(1, Number(options.objective ?? 0.999)));
    this.windowMs = Math.max(60_000, Number(options.windowMs || 30 * 24 * 60 * 60_000));
    this.indicator = normalizeIndicator(options.indicator || options);
    this.enabled = options.enabled !== false;
    this.tags = Object.freeze(Array.from(new Set(options.tags || [])));
    this.annotations = deepFreeze({ ...(options.annotations || {}) });
    this.burnRates = Object.freeze(options.burnRates || [1, 2, 6, 14]);
    Object.freeze(this);
  }

  async measure(context = {}) {
    if (typeof this.indicator.measure === 'function') return normalizeMeasurement(await this.indicator.measure(context, this));
    if (this.indicator.type === 'ratio') {
      const good = metricValue(context.metrics, metricRule(this.indicator.good, this.indicator.goodLabels));
      const total = metricValue(context.metrics, metricRule(this.indicator.total, this.indicator.totalLabels));
      return normalizeMeasurement({ good, total });
    }
    if (this.indicator.type === 'error-ratio') {
      const bad = metricValue(context.metrics, metricRule(this.indicator.bad, this.indicator.badLabels));
      const total = metricValue(context.metrics, metricRule(this.indicator.total, this.indicator.totalLabels));
      return normalizeMeasurement({ bad, total, good: total != null && bad != null ? Math.max(0, total - bad) : null });
    }
    if (this.indicator.type === 'availability') {
      const report = context.health;
      return normalizeMeasurement({ good: report?.ok === false ? 0 : 1, total: 1 });
    }
    return normalizeMeasurement({ good: null, total: null });
  }

  toJSON() { return { id: this.id, name: this.name, description: this.description, objective: this.objective, windowMs: this.windowMs, indicator: { ...this.indicator, measure: this.indicator.measure ? '[Function]' : undefined }, enabled: this.enabled, tags: this.tags, annotations: this.annotations, burnRates: this.burnRates }; }
}
function normalizeIndicator(input) { if (typeof input === 'function') return Object.freeze({ type: 'custom', measure: input }); if (input.measure) return Object.freeze({ ...input, type: input.type || 'custom' }); if (input.good && input.total) return Object.freeze({ ...input, type: input.type || 'ratio' }); if (input.bad && input.total) return Object.freeze({ ...input, type: 'error-ratio' }); return Object.freeze({ ...input, type: input.type || 'availability' }); }
function normalizeMeasurement(value) { if (typeof value === 'number') return { good: value, total: 1, ratio: value }; const good = Number(value?.good); const bad = Number(value?.bad); const total = Number(value?.total); const hasGood = Number.isFinite(good); const hasBad = Number.isFinite(bad); const hasTotal = Number.isFinite(total) && total >= 0; const normalizedGood = hasGood ? good : hasBad && hasTotal ? Math.max(0, total - bad) : null; const normalizedBad = hasBad ? bad : normalizedGood != null && hasTotal ? Math.max(0, total - normalizedGood) : null; const ratio = normalizedGood != null && hasTotal && total > 0 ? normalizedGood / total : null; return { good: normalizedGood, bad: normalizedBad, total: hasTotal ? total : null, ratio, details: value?.details || null }; }
function metricRule(metric, labels) { return { metric, labels: labels || {}, aggregate: 'sum' }; }
function slug(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
export default SloDefinition;
