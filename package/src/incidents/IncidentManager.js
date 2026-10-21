'use strict';

import { EventEmitter } from 'node:events';
import { IncidentState, SignalKind } from '../constants.js';
import RunbookRegistry from './RunbookRegistry.js';
import { deepFreeze, errorRecord, randomId, withTimeout } from '../support.js';

export class IncidentManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxOpen = Math.max(1, Number(options.maxOpen) || 10_000);
    this.historyLimit = Math.max(1, Number(options.historyLimit) || 20_000);
    this.captureDiagnostics = options.captureDiagnostics !== false;
    this.diagnosticsTimeoutMs = Math.max(100, Number(options.diagnosticsTimeoutMs) || 10_000);
    this.diagnosticsProvider = options.diagnosticsProvider || null;
    this.signal = options.signal || null;
    this.runbooks = options.runbooks || new RunbookRegistry();
    this.incidents = new Map();
    this.byDedupe = new Map();
    this.history = [];
    this.stats = { opened: 0, deduplicated: 0, acknowledged: 0, resolved: 0, diagnosticsErrors: 0 };
  }

  async open(options = {}) {
    const dedupeKey = String(options.dedupeKey || `${options.source || 'manual'}:${options.alert?.ruleId || options.title || 'incident'}`);
    const existingId = this.byDedupe.get(dedupeKey);
    const existing = existingId ? this.incidents.get(existingId) : null;
    if (existing && ![IncidentState.RESOLVED, IncidentState.CLOSED].includes(existing.state)) {
      this.stats.deduplicated++;
      await this.annotate(existing.id, { type: 'duplicate', message: options.message || options.title || 'Repeated incident signal', data: options.data || options.alert || null });
      return this.public(existing);
    }
    const openCount = Array.from(this.incidents.values()).filter((incident) => ![IncidentState.RESOLVED, IncidentState.CLOSED].includes(incident.state)).length;
    if (openCount >= this.maxOpen) throw new Error('Monitor open incident limit exceeded.');
    const now = Date.now();
    const incident = {
      id: options.id || randomId('inc'),
      dedupeKey,
      title: String(options.title || options.alert?.rule?.name || 'RawNode incident'),
      description: options.description || options.message || '',
      severity: options.severity || options.alert?.severity || 'warning',
      state: IncidentState.OPEN,
      source: options.source || 'manual',
      alertId: options.alert?.id || null,
      ruleId: options.alert?.ruleId || null,
      runbook: options.runbook || options.alert?.rule?.runbook || null,
      owner: options.owner || null,
      tenantId: options.tenantId || options.alert?.tenantId || null,
      traceId: options.traceId || options.alert?.traceId || null,
      tags: Object.freeze([...(options.tags || options.alert?.tags || [])]),
      createdAt: now,
      updatedAt: now,
      acknowledgedAt: null,
      mitigatedAt: null,
      resolvedAt: null,
      closedAt: null,
      timeline: [],
      diagnostics: null,
      metadata: options.metadata || null,
    };
    incident.timeline.push(timeline('opened', options.actor, options.message || incident.description, options.data || options.alert || null, now));
    this.incidents.set(incident.id, incident); this.byDedupe.set(dedupeKey, incident.id); this.stats.opened++;
    if (this.captureDiagnostics && this.diagnosticsProvider) {
      try { incident.diagnostics = await withTimeout(() => this.diagnosticsProvider({ incident: this.public(incident), options }), this.diagnosticsTimeoutMs); }
      catch (error) { this.stats.diagnosticsErrors++; incident.diagnostics = { ok: false, error: errorRecord(error) }; }
    }
    await this._record('opened', incident);
    return this.public(incident);
  }

  async openFromAlert(alert) { return await this.open({ source: 'alert', alert, title: alert.rule?.name || 'Alert incident', description: alert.rule?.description || alert.evaluation?.reason, severity: alert.severity, runbook: alert.rule?.runbook, dedupeKey: `alert:${alert.ruleId}` }); }
  async acknowledge(id, options = {}) { return await this._transition(id, IncidentState.ACKNOWLEDGED, 'acknowledged', options); }
  async mitigate(id, options = {}) { return await this._transition(id, IncidentState.MITIGATED, 'mitigated', options); }
  async resolve(id, options = {}) { return await this._transition(id, IncidentState.RESOLVED, 'resolved', options); }
  async closeIncident(id, options = {}) { return await this._transition(id, IncidentState.CLOSED, 'closed', options); }

  async _transition(id, state, event, options) {
    const incident = this.incidents.get(String(id)); if (!incident) return null;
    const now = Date.now(); incident.state = state; incident.updatedAt = now; incident[`${event}At`] = now; incident.timeline.push(timeline(event, options.actor, options.message, options.data || options.alert || null, now));
    if (state === IncidentState.ACKNOWLEDGED) this.stats.acknowledged++;
    if (state === IncidentState.RESOLVED) { this.stats.resolved++; this.byDedupe.delete(incident.dedupeKey); }
    if (state === IncidentState.CLOSED) this.byDedupe.delete(incident.dedupeKey);
    await this._record(event, incident); return this.public(incident);
  }

  async annotate(id, options = {}) { const incident = this.incidents.get(String(id)); if (!incident) return null; incident.updatedAt = Date.now(); incident.timeline.push(timeline(options.type || 'annotation', options.actor, options.message, options.data, incident.updatedAt)); await this._record('annotated', incident); return this.public(incident); }
  get(id) { const incident = this.incidents.get(String(id)); return incident ? this.public(incident) : null; }
  list(options = {}) { let rows = Array.from(this.incidents.values()); if (options.state) rows = rows.filter((item) => item.state === options.state); if (options.severity) rows = rows.filter((item) => item.severity === options.severity); if (options.tenantId) rows = rows.filter((item) => item.tenantId === options.tenantId); rows.sort((a, b) => b.updatedAt - a.updatedAt); return deepFreeze(rows.slice(0, Math.max(1, Number(options.limit) || 100)).map((item) => this.public(item))); }
  public(incident) { return deepFreeze({ ...incident, timeline: incident.timeline.slice(), runbookDefinition: incident.runbook ? this.runbooks.get(incident.runbook) : null }); }
  async _record(event, incident) { const record = deepFreeze({ event, timestamp: Date.now(), incident: this.public(incident) }); this.history.push(record); if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit); this.signal?.(SignalKind.INCIDENT, record, { priority: incident.severity === 'critical' ? 30 : 10 }); this.emit(event, record); }
  historySnapshot(options = {}) { return deepFreeze(this.history.slice(-(Math.max(1, Number(options.limit) || 100)))); }
  snapshot() { return deepFreeze({ open: Array.from(this.incidents.values()).filter((item) => ![IncidentState.RESOLVED, IncidentState.CLOSED].includes(item.state)).length, incidents: this.list({ limit: 1_000 }), history: this.history.length, runbooks: this.runbooks.snapshot(), stats: { ...this.stats } }); }
}
function timeline(type, actor, message, data, at = Date.now()) { return Object.freeze({ id: randomId('timeline'), type, at, actor: actor || null, message: message || null, data: data || null }); }
export default IncidentManager;
