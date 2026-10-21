'use strict';

import { EventEmitter } from 'node:events';
import { AlertState, SignalKind } from '../constants.js';
import AlertRule from './AlertRule.js';
import SilenceManager from './SilenceManager.js';
import NotificationRouter from './NotificationRouter.js';
import { deepFreeze, errorRecord, randomId } from '../support.js';

export class AlertEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.intervalMs = Math.max(250, Number(options.intervalMs) || 15_000);
    this.concurrency = Math.max(1, Number(options.concurrency) || 8);
    this.historyLimit = Math.max(1, Number(options.historyLimit) || 5_000);
    this.defaultPendingForMs = Math.max(0, Number(options.defaultPendingForMs) || 0);
    this.defaultResolveAfterMs = Math.max(0, Number(options.defaultResolveAfterMs) || 0);
    this.defaultCooldownMs = Math.max(0, Number(options.defaultCooldownMs) || 5 * 60_000);
    this.rules = new Map();
    this.states = new Map();
    this.history = [];
    this.silences = options.silences || new SilenceManager(options);
    this.notifications = options.notifications || new NotificationRouter(options);
    this.contextProvider = options.contextProvider || (() => ({}));
    this.signal = options.signal || null;
    this.incidents = options.incidents || null;
    this.autoIncidentSeverities = new Set(options.autoIncidentSeverities || ['critical']);
    this.leader = options.leader || null;
    this.timer = null;
    this.running = false;
    this.closed = false;
    this.evaluating = false;
    this.frozen = false;
    this.stats = { evaluations: 0, errors: 0, transitions: 0, notifications: 0, skippedNotLeader: 0 };
  }

  register(input, options = {}) {
    if (this.frozen) throw new Error('Alert engine is frozen.');
    const rule = input instanceof AlertRule ? input : new AlertRule({ pendingForMs: this.defaultPendingForMs, resolveAfterMs: this.defaultResolveAfterMs, cooldownMs: this.defaultCooldownMs, ...input });
    if (this.rules.has(rule.id) && options.replace !== true) throw new Error(`Alert rule '${rule.id}' is already registered.`);
    this.rules.set(rule.id, rule);
    if (!this.states.has(rule.id)) this.states.set(rule.id, initialState(rule));
    this.emit('registered', rule.toJSON());
    return rule;
  }

  unregister(id) { this.states.delete(String(id)); return this.rules.delete(String(id)); }
  freeze() { this.frozen = true; return this; }
  start() { if (this.running || this.closed) return this; this.running = true; this.timer = setInterval(() => void this.evaluate().catch((error) => this.emit('error', error)), this.intervalMs); this.timer.unref?.(); return this; }

  async evaluate(options = {}) {
    if (this.evaluating || this.closed) return this.snapshot();
    if (this.leader && await this.leader.isLeader?.() === false) { this.stats.skippedNotLeader++; return this.snapshot(); }
    this.evaluating = true;
    const context = await this.contextProvider(options);
    const rules = Array.from(this.rules.values()).filter((rule) => rule.enabled);
    let cursor = 0;
    try {
      await Promise.all(Array.from({ length: Math.min(this.concurrency, rules.length || 1) }, async () => {
        while (cursor < rules.length) await this._evaluateRule(rules[cursor++], context, options);
      }));
    } finally { this.evaluating = false; }
    return this.snapshot();
  }

  async _evaluateRule(rule, context, options) {
    const now = Number(options.now || Date.now());
    const state = this.states.get(rule.id) || initialState(rule);
    this.stats.evaluations++;
    try {
      const evaluation = await rule.test({ ...context, now, state: { ...state } });
      state.lastEvaluationAt = now;
      state.lastValue = evaluation.value ?? null;
      state.lastEvaluation = evaluation;
      state.error = null;
      if (evaluation.skipped) return;
      const silence = this.silences.match(rule, now);
      if (silence) {
        if (state.state !== AlertState.SILENCED) await this._transition(rule, state, AlertState.SILENCED, evaluation, { silence }, now);
        return;
      }
      if (state.state === AlertState.SILENCED) await this._transition(rule, state, AlertState.INACTIVE, evaluation, null, now);

      if (evaluation.firing) {
        state.consecutiveFiring++;
        state.consecutiveHealthy = 0;
        state.pendingSince ||= now;
        if (state.state === AlertState.INACTIVE || state.state === AlertState.RESOLVED) await this._transition(rule, state, AlertState.PENDING, evaluation, null, now);
        const pendingMs = now - state.pendingSince;
        if (state.consecutiveFiring >= rule.consecutive && pendingMs >= rule.pendingForMs && state.state !== AlertState.FIRING && state.state !== AlertState.ACKNOWLEDGED) {
          await this._transition(rule, state, AlertState.FIRING, evaluation, null, now);
        }
      } else {
        state.consecutiveHealthy++;
        state.consecutiveFiring = 0;
        state.healthySince ||= now;
        if (state.state === AlertState.PENDING) await this._transition(rule, state, AlertState.INACTIVE, evaluation, null, now);
        else if ([AlertState.FIRING, AlertState.ACKNOWLEDGED].includes(state.state)) {
          const recovered = rule.evaluate
            ? evaluation.firing === false && evaluation.recovered !== false
            : rule.recovered(evaluation.value);
          if (recovered && now - state.healthySince >= rule.resolveAfterMs) {
            await this._transition(rule, state, AlertState.RESOLVED, evaluation, null, now);
          }
        }
      }
      this.states.set(rule.id, state);
    } catch (error) {
      this.stats.errors++;
      state.error = errorRecord(error, { stack: options.includeStack === true });
      await this._transition(rule, state, AlertState.ERROR, { firing: false, value: null, error: state.error }, null, now);
    }
  }

  async _transition(rule, state, next, evaluation, meta, now) {
    if (state.state === next) return;
    const previous = state.state;
    state.state = next;
    state.updatedAt = now;
    state.transitions++;
    if (next === AlertState.FIRING) { state.firedAt ||= now; state.resolvedAt = null; state.healthySince = null; }
    if (next === AlertState.RESOLVED || next === AlertState.INACTIVE) { state.resolvedAt = next === AlertState.RESOLVED ? now : state.resolvedAt; state.pendingSince = null; state.healthySince = null; if (next === AlertState.INACTIVE) state.firedAt = null; }
    const event = deepFreeze({
      id: randomId('alert'), rule: rule.toJSON(), ruleId: rule.id, type: next === AlertState.FIRING ? 'firing' : next === AlertState.RESOLVED ? 'resolved' : 'transition', previous, state: next,
      severity: rule.severity, timestamp: now, value: evaluation.value ?? null, evaluation, meta, annotations: rule.annotations, tags: rule.tags,
    });
    this.history.push(event); if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    this.stats.transitions++;
    this.emit('transition', event);
    this.signal?.(SignalKind.ALERT, event, { priority: next === AlertState.FIRING ? 20 : 10 });

    const notify = next === AlertState.FIRING || next === AlertState.RESOLVED;
    if (notify && (!state.lastNotifiedAt || now - state.lastNotifiedAt >= rule.cooldownMs || next === AlertState.RESOLVED)) {
      await this.notifications.notify({ ...event, title: `${rule.name} ${next}`, channels: rule.channels }, { channels: rule.channels });
      state.lastNotifiedAt = now; this.stats.notifications++;
    }
    if (next === AlertState.FIRING && this.incidents && (rule.incident === true || this.autoIncidentSeverities.has(rule.severity))) {
      state.incidentId = (await this.incidents.openFromAlert(event))?.id || state.incidentId;
    }
    if (next === AlertState.RESOLVED && state.incidentId) await this.incidents?.resolve?.(state.incidentId, { source: 'alert', alert: event }).catch(() => {});
  }

  acknowledge(ruleId, actor = null) {
    const state = this.states.get(String(ruleId));
    if (!state || state.state !== AlertState.FIRING) return false;
    state.state = AlertState.ACKNOWLEDGED; state.acknowledgedAt = Date.now(); state.acknowledgedBy = actor; state.updatedAt = Date.now(); return true;
  }

  async close() { clearInterval(this.timer); this.timer = null; this.running = false; this.closed = true; await this.notifications.close(); }
  current(options = {}) { let rows = Array.from(this.states.values(), (state) => ({ ...state, rule: this.rules.get(state.ruleId)?.toJSON() || null })); if (options.state) rows = rows.filter((row) => row.state === options.state); if (options.severity) rows = rows.filter((row) => row.rule?.severity === options.severity); return deepFreeze(rows); }
  historySnapshot(options = {}) { return deepFreeze(this.history.slice(-(Math.max(1, Number(options.limit) || 100)))); }
  snapshot() { return deepFreeze({ running: this.running, closed: this.closed, frozen: this.frozen, rules: Array.from(this.rules.values(), (rule) => rule.toJSON()), states: this.current(), silences: this.silences.snapshot(), notifications: this.notifications.snapshot(), history: this.history.length, stats: { ...this.stats } }); }
}

function initialState(rule) { return { ruleId: rule.id, state: AlertState.INACTIVE, createdAt: Date.now(), updatedAt: Date.now(), pendingSince: null, firedAt: null, healthySince: null, resolvedAt: null, acknowledgedAt: null, acknowledgedBy: null, lastEvaluationAt: null, lastNotifiedAt: null, lastValue: null, lastEvaluation: null, consecutiveFiring: 0, consecutiveHealthy: 0, transitions: 0, incidentId: null, error: null }; }
export default AlertEngine;
