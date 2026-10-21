'use strict';

export class EventsDoctorCommand {
  constructor(app) {
    this.app = app;
    this.signature = 'events:doctor {--json}';
    this.description = 'Inspect event-bus health, bounds, bridge state, schemas, and production readiness.';
  }

  async handle() {
    const bus = this.app?.resolve?.('events');
    if (!bus) return { ok: false, errors: ['Events dispatcher is not registered'], warnings: [] };
    const snapshot = bus.snapshot?.() || null;
    const config = bus.configuration?.toJSON?.() || bus.configuration?.value || null;
    const warnings = [];
    const errors = [];
    if (config?.profile === 'production') {
      if (!config.listeners?.maxTotal) warnings.push('listeners.maxTotal is unbounded');
      if (!config.deferred?.maxItems) warnings.push('deferred.maxItems is unbounded');
      if (!config.deferred?.maxBytes) warnings.push('deferred.maxBytes is unbounded');
      if (config.history?.maxEntriesPerEvent > 0 && !config.history?.maxBytes) warnings.push('history is enabled without a byte ceiling');
      if (config.logEvents && bus._logPayloads) warnings.push('event payload logging is enabled in production');
    }
    const health = bus.health?.();
    if (health && !health.ok) errors.push(...health.reasons);
    const schemas = this.app?.resolve?.('events.schemas')?.manifest?.() || [];
    return {
      ok: errors.length === 0,
      profile: config?.profile || 'unknown',
      health,
      snapshot,
      schemas: { count: schemas.length, contracts: schemas },
      warnings,
      errors,
    };
  }
}

export default EventsDoctorCommand;
