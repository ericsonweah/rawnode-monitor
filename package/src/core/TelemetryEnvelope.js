'use strict';

import { MONITOR_SCHEMA_VERSION, MONITOR_VERSION, SignalKind } from '../constants.js';
import { deepFreeze, randomId } from '../support.js';

const SIGNALS = new Set(Object.values(SignalKind));

export class TelemetryEnvelope {
  constructor(kind, payload, options = {}) {
    const normalized = String(kind || '').toLowerCase();
    if (!SIGNALS.has(normalized)) throw new TypeError(`Unsupported telemetry signal kind '${kind}'.`);
    this.schemaVersion = MONITOR_SCHEMA_VERSION;
    this.monitorVersion = MONITOR_VERSION;
    this.id = options.id || randomId('sig');
    this.kind = normalized;
    this.timestamp = Number(options.timestamp || Date.now());
    this.observedAt = Number(options.observedAt || Date.now());
    this.service = options.service || null;
    this.environment = options.environment || null;
    this.instanceId = options.instanceId || null;
    this.region = options.region || null;
    this.zone = options.zone || null;
    this.tenantId = options.tenantId || options.context?.tenantId || null;
    this.traceId = options.traceId || options.context?.traceId || payload?.traceId || null;
    this.spanId = options.spanId || options.context?.spanId || payload?.spanId || null;
    this.correlationId = options.correlationId || options.context?.correlationId || null;
    this.context = options.context ? deepFreeze({ ...options.context }) : null;
    this.resource = options.resource ? deepFreeze({ ...options.resource }) : null;
    this.attributes = options.attributes ? deepFreeze({ ...options.attributes }) : null;
    this.payload = payload;
    this.sequence = options.sequence ?? null;
    this.priority = Number(options.priority || 0);
    Object.freeze(this);
  }

  toJSON() { return { ...this }; }
}

export function createTelemetryEnvelope(kind, payload, options = {}) {
  return payload instanceof TelemetryEnvelope ? payload : new TelemetryEnvelope(kind, payload, options);
}

export default TelemetryEnvelope;
