'use strict';

export class EventOperationBuilder {
  constructor(fabric, eventName, payload = undefined) {
    this.fabric = fabric;
    this.operation = { name: String(eventName), payload, version: 1, context: null, routing: {}, delivery: {}, security: {}, metadata: {}, options: {} };
  }
  payload(value) { this.operation.payload = value; return this; }
  version(value) { this.operation.version = Math.max(1, Number(value) || 1); return this; }
  context(value) { this.operation.context = value; return this; }
  correlation(value) { this.operation.context = { ...(this.operation.context || {}), correlationId: value }; return this; }
  causation(value) { this.operation.context = { ...(this.operation.context || {}), causationId: value }; return this; }
  trace(value, spanId = null) { this.operation.context = { ...(this.operation.context || {}), traceId: value, spanId }; return this; }
  tenant(value) { this.operation.context = { ...(this.operation.context || {}), tenantId: value }; return this; }
  actor(value) { this.operation.context = { ...(this.operation.context || {}), actorId: value }; return this; }
  to(channel) { this.operation.routing.channel = channel == null ? null : String(channel); return this; }
  audience(value) { this.operation.routing.audience = String(value); return this; }
  via(...transports) { this.operation.routing.transports = transports.flat().map(String); return this; }
  fallback(...transports) { this.operation.routing.fallback = transports.flat().map(String); return this; }
  fanout(value = true) { this.operation.options.fanout = value !== false; return this; }
  durable(value = true) { this.operation.options.durable = value !== false; this.operation.delivery.mode = value === false ? 'best-effort' : 'at-least-once'; return this; }
  effectivelyOnce(value = true) { if (value !== false) { this.operation.options.durable = true; this.operation.delivery.mode = 'effectively-once'; this.operation.options.idempotency = true; } return this; }
  idempotencyKey(value) { this.operation.delivery.idempotencyKey = value == null ? null : String(value); return this; }
  partitionBy(value) {
    if (typeof value === 'function') this.operation.partitionResolver = value;
    else this.operation.delivery.partitionKey = value == null ? null : String(value);
    return this;
  }
  sequence(value) { this.operation.delivery.sequence = Number(value); return this; }
  ttl(value) { this.operation.ttlMs = Math.max(0, Number(value) || 0); return this; }
  timeout(value) { this.operation.options.timeoutMs = Math.max(0, Number(value) || 0); return this; }
  requireAcknowledgement(value = true) { this.operation.options.requireAcknowledgement = value !== false; return this; }
  requireOrdering(value = true) { this.operation.options.requireOrdering = value !== false; return this; }
  classification(value) { this.operation.security.classification = String(value); return this; }
  authenticated(principal = null) { this.operation.security.authenticated = true; this.operation.security.principal = principal; return this; }
  key(value) { this.operation.security.keyId = value == null ? null : String(value); return this; }
  codec(value) { this.operation.codec = String(value); return this; }
  schema(value) { this.operation.schema = String(value); return this; }
  meta(value) { this.operation.metadata = { ...(this.operation.metadata || {}), ...(value || {}) }; return this; }
  option(name, value) { this.operation.options[name] = value; return this; }
  local() { return this.fabric.dispatch(this.operation.name, this.operation.payload, this.operation.options); }
  localAsync() { return this.fabric.dispatchAsync(this.operation.name, this.operation.payload, this.operation.options); }
  publish(options = {}) { return this.fabric.publish(this.operation, { ...this.operation.options, ...options }); }
  broadcast(options = {}) { return this.fabric.broadcast(this.operation, { ...this.operation.options, ...options }); }
  enqueue(options = {}) { return this.fabric.enqueue(this.operation, { ...this.operation.options, ...options }); }
  record(options = {}) { return this.fabric.record(this.operation, { ...this.operation.options, ...options }); }
  request(options = {}) { return this.fabric.request(this.operation, { ...this.operation.options, ...options }); }
  snapshot() { return structuredCloneSafe(this.operation); }
}
function structuredCloneSafe(value) { try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); } }
export default EventOperationBuilder;
