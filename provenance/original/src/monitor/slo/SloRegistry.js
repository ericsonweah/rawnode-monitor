'use strict';

import { EventEmitter } from 'node:events';
import { SignalKind } from '../constants.js';
import SloDefinition from './SloDefinition.js';
import { deepFreeze } from '../support.js';

export class SloRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    this.intervalMs = Math.max(1_000, Number(options.intervalMs) || 60_000);
    this.historyLimit = Math.max(1, Number(options.historyLimit) || 44_640);
    this.definitions = new Map();
    this.points = new Map();
    this.latest = new Map();
    this.contextProvider = options.contextProvider || (() => ({}));
    this.signal = options.signal || null;
    this.timer = null;
    this.running = false;
    this.closed = false;
    this.frozen = false;
    this.stats = { evaluations: 0, errors: 0, pruned: 0 };
  }

  register(input, options = {}) { if (this.frozen) throw new Error('SLO registry is frozen.'); const definition = input instanceof SloDefinition ? input : new SloDefinition(input); if (this.definitions.has(definition.id) && options.replace !== true) throw new Error(`SLO '${definition.id}' is already registered.`); this.definitions.set(definition.id, definition); if (!this.points.has(definition.id)) this.points.set(definition.id, []); return definition; }
  unregister(id) { this.points.delete(String(id)); this.latest.delete(String(id)); return this.definitions.delete(String(id)); }
  freeze() { this.frozen = true; return this; }
  start() { if (this.running || this.closed) return this; this.running = true; this.timer = setInterval(() => void this.evaluate().catch((error) => this.emit('error', error)), this.intervalMs); this.timer.unref?.(); return this; }

  async evaluate(options = {}) {
    const context = await this.contextProvider(options);
    const now = Number(options.now || Date.now());
    for (const definition of this.definitions.values()) {
      if (!definition.enabled) continue;
      try {
        const measurement = await definition.measure({ ...context, now });
        if (measurement.total == null || measurement.total < 0) continue;
        const point = Object.freeze({ timestamp: now, good: measurement.good || 0, bad: measurement.bad ?? Math.max(0, measurement.total - (measurement.good || 0)), total: measurement.total, details: measurement.details || null });
        const history = this.points.get(definition.id) || [];
        history.push(point);
        const cutoff = now - definition.windowMs;
        let removed = 0;
        while (history.length && (history[0].timestamp < cutoff || history.length > this.historyLimit)) { history.shift(); removed++; }
        this.stats.pruned += removed;
        this.points.set(definition.id, history);
        const snapshot = calculate(definition, history, now);
        this.latest.set(definition.id, snapshot);
        this.stats.evaluations++;
        this.signal?.(SignalKind.SLO, snapshot, { priority: snapshot.withinBudget ? 0 : 10 });
        this.emit('evaluated', snapshot);
      } catch (error) { this.stats.errors++; this.emit('evaluationError', error, definition); }
    }
    return this.snapshot();
  }

  get(id) { return this.latest.get(String(id)) || null; }
  all() { return deepFreeze(Object.fromEntries(this.latest)); }
  burnRate(id, windowMs = null, now = Date.now()) { const definition = this.definitions.get(String(id)); if (!definition) return null; const points = (this.points.get(definition.id) || []).filter((point) => !windowMs || point.timestamp >= now - windowMs); return calculate(definition, points, now).burnRate; }

  alertRules(options = {}) {
    const output = [];
    for (const definition of this.definitions.values()) {
      for (const rate of options.rates || definition.burnRates) output.push({
        id: `slo-${definition.id}-burn-${String(rate).replace('.', '_')}`,
        name: `${definition.name} burn rate ${rate}x`,
        severity: rate >= 6 ? 'critical' : rate >= 2 ? 'warning' : 'info',
        source: 'custom',
        threshold: rate,
        comparator: 'gt',
        pendingForMs: options.pendingForMs || 0,
        evaluate: () => ({ firing: (this.get(definition.id)?.burnRate || 0) > rate, value: this.get(definition.id)?.burnRate || 0, threshold: rate }),
        annotations: { sloId: definition.id, objective: definition.objective },
        incident: rate >= 6,
      });
    }
    return output;
  }

  async close() { clearInterval(this.timer); this.timer = null; this.running = false; this.closed = true; }
  snapshot() { return deepFreeze({ running: this.running, closed: this.closed, frozen: this.frozen, definitions: Array.from(this.definitions.values(), (definition) => definition.toJSON()), latest: Object.fromEntries(this.latest), stats: { ...this.stats } }); }
}

function calculate(definition, points, now) {
  const good = points.reduce((sum, point) => sum + Number(point.good || 0), 0);
  const bad = points.reduce((sum, point) => sum + Number(point.bad || 0), 0);
  const total = points.reduce((sum, point) => sum + Number(point.total || 0), 0);
  const achieved = total > 0 ? good / total : 1;
  const allowedBadRatio = Math.max(Number.EPSILON, 1 - definition.objective);
  const actualBadRatio = total > 0 ? bad / total : 0;
  const burnRate = actualBadRatio / allowedBadRatio;
  const budgetTotal = total * allowedBadRatio;
  const budgetRemaining = budgetTotal - bad;
  return deepFreeze({ id: definition.id, name: definition.name, objective: definition.objective, windowMs: definition.windowMs, timestamp: now, windowStartedAt: now - definition.windowMs, points: points.length, good, bad, total, achieved, compliance: achieved >= definition.objective, withinBudget: budgetRemaining >= 0, errorBudget: { total: budgetTotal, consumed: bad, remaining: budgetRemaining, remainingRatio: budgetTotal > 0 ? budgetRemaining / budgetTotal : 1 }, burnRate, tags: definition.tags, annotations: definition.annotations });
}
export default SloRegistry;
