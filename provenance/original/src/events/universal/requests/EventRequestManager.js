'use strict';

import { randomId } from '../support/safe.js';

export class EventRequestManager {
  constructor(fabric, options = {}) { this.fabric = fabric; this.timeoutMs = Math.max(1, Number(options.timeoutMs) || 30_000); this.prefix = options.replyPrefix || '__events:reply:'; this.pending = new Map(); this.handlers = new Map(); this.closed = false; }

  async request(operation, options = {}) {
    if (this.closed) throw Object.assign(new Error('Event request manager is closed.'), { code: 'EVENT_REQUEST_MANAGER_CLOSED' });
    const requestId = operation.delivery?.requestId || options.requestId || randomId('request');
    const replyEvent = `${this.prefix}${requestId}`;
    const controller = new AbortController();
    const signal = options.signal;
    if (signal?.aborted) controller.abort(signal.reason);
    else signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    const response = this.fabric.dispatcher.waitFor
      ? this.fabric.dispatcher.waitFor(replyEvent, { timeoutMs: options.timeoutMs || this.timeoutMs, signal: controller.signal, map: (_eventName, payload) => payload })
      : waitForFallback(this.fabric.dispatcher, replyEvent, options.timeoutMs || this.timeoutMs, controller.signal);
    this.pending.set(requestId, { requestId, replyEvent, startedAt: Date.now(), controller });
    try {
      const delivery = await this.fabric.publish({ ...operation, delivery: { ...(operation.delivery || {}), requestId, replyTo: replyEvent } }, { ...options, requireAcknowledgement: options.requireAcknowledgement !== false });
      if (!delivery.accepted) throw Object.assign(new Error(`Event request '${operation.name}' was not admitted.`), { code: delivery.code || 'EVENT_REQUEST_NOT_ADMITTED', delivery: delivery.state, result: delivery });
      const packet = await response;
      if (packet?.ok === false) {
        throw Object.assign(
          new Error(packet.error?.message || `Event request '${operation.name}' failed.`),
          packet.error || {},
        );
      }
      return packet?.ok === true ? packet.value : packet;
    } finally { this.pending.delete(requestId); controller.abort('request-complete'); }
  }

  handle(eventName, handler, options = {}) {
    if (typeof handler !== 'function') throw new TypeError('Event request handler must be a function.');
    const subscription = this.fabric.subscription(eventName).handle(async (payload, envelope) => {
      const requestId = envelope?.delivery?.requestId || envelope?.requestId;
      const replyTo = envelope?.delivery?.replyTo || envelope?.replyTo;
      if (!requestId || !replyTo) return;
      try {
        const value = await handler(payload, envelope);
        return await this.fabric.event(replyTo).payload({ ok: true, value, requestId }).correlation(envelope.context?.correlationId).causation(envelope.id).via(...(options.via || envelope.routing?.transports || [])).publish({ ...options, localEcho: true });
      } catch (error) {
        await this.fabric.event(replyTo).payload({ ok: false, error: { name: error.name, message: error.message, code: error.code }, requestId }).correlation(envelope.context?.correlationId).causation(envelope.id).via(...(options.via || envelope.routing?.transports || [])).publish({ ...options, localEcho: true });
        if (options.errorPolicy === 'throw') throw error;
      }
    }).register();
    this.handlers.set(String(eventName), subscription);
    return subscription;
  }

  snapshot() { return { closed: this.closed, pending: this.pending.size, handlers: [...this.handlers.keys()] }; }
  close() { this.closed = true; for (const handle of this.handlers.values()) handle?.dispose?.(); this.handlers.clear(); for (const value of this.pending.values()) value.controller.abort('request-manager-closed'); this.pending.clear(); }
}
function waitForFallback(dispatcher, event, timeoutMs, signal) { return new Promise((resolve, reject) => { let timer; const cleanup = () => { clearTimeout(timer); handle?.dispose?.(); signal?.removeEventListener?.('abort', aborted); }; const aborted = () => { cleanup(); reject(signal.reason || new Error('Event request aborted.')); }; const handle = dispatcher.subscribe(event, (payload) => { cleanup(); if (payload?.ok === false) reject(Object.assign(new Error(payload.error?.message || 'Event request failed.'), payload.error || {})); else resolve(payload?.value ?? payload); }, { once: true }); timer = setTimeout(() => { cleanup(); reject(Object.assign(new Error(`Event request timed out after ${timeoutMs}ms.`), { code: 'EVENT_REQUEST_TIMEOUT' })); }, timeoutMs); signal?.addEventListener?.('abort', aborted, { once: true }); }); }
export default EventRequestManager;
