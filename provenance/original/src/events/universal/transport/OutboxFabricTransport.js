'use strict';

/** Adapter used by the existing OutboxPublisher contract. */
export class OutboxFabricTransport {
  constructor(fabric, options = {}) { if (!fabric) throw new TypeError('OutboxFabricTransport requires a fabric.'); this.fabric = fabric; this.id = options.id || 'fabric-outbox'; this.options = options; }
  async publish(eventName, args = [], options = {}) {
    const payload = Array.isArray(args) ? args[0] : args;
    const operation = payload?.protocol === 'rawnode.events'
      ? { name: payload.name, payload: payload.content?.payload, version: payload.version, context: payload.context, routing: payload.routing, delivery: { ...payload.delivery, mode: 'best-effort' }, security: payload.security, metadata: payload.metadata }
      : { name: eventName, payload, version: options.version, context: options.context, delivery: { mode: 'best-effort', idempotencyKey: options.id }, metadata: options.meta };
    return this.fabric.publish(operation, { ...this.options, ...options, durable: false, fromOutbox: true });
  }
  snapshot() { return { id: this.id, fabric: this.fabric.snapshot?.() || null }; }
}
export default OutboxFabricTransport;
