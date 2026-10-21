'use strict';

import { EventTransport } from '../../universal/transport/EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../../universal/delivery/EventDelivery.js';
import { byteLength, randomId } from '../../universal/support/safe.js';

export class DomCustomEventTransport extends EventTransport {
  constructor(options = {}) { super(options.id || 'dom-event', { ...options, capabilities: { local: true, remote: false, ordered: true, acknowledged: false, durable: false, fanout: true, binary: false, requestReply: false, browser: true, maxPacketBytes: Number(options.maxPacketBytes) || 1024 * 1024, ...(options.capabilities || {}) } }); this.target = options.target || globalThis.document || null; this.eventName = options.eventName || 'rawnode:event'; this.originId = options.originId || randomId('dom'); this.receivers = new Set(); }
  async start() { if (this.state === 'started') return this; if (!this.target?.addEventListener || typeof CustomEvent !== 'function') throw this._error(Object.assign(new Error('DOM CustomEvent transport is unavailable.'), { code: 'EVENT_DOM_TRANSPORT_UNAVAILABLE' })); await super.start(); this._listener ||= (event) => { const message = event.detail; if (!message?.__rawnodeEventFabric || message.originId === this.originId) return; this.stats.received++; for (const receiver of this.receivers) Promise.resolve(receiver(message.envelope, { transport: this, nativeEvent: event, remote: false })).catch((error) => this._error(error)); }; this.target.addEventListener(this.eventName, this._listener); return this; }
  subscribe(receiver) { this.receivers.add(receiver); return () => this.receivers.delete(receiver); }
  async publish(envelope) { await this.start(); const bytes = envelope.byteLength?.() || byteLength(envelope); if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE', reason: 'packet-too-large' }); const event = new CustomEvent(this.eventName, { bubbles: false, cancelable: true, detail: { __rawnodeEventFabric: true, originId: this.originId, envelope } }); const accepted = this.target.dispatchEvent(event); this.stats.published++; return accepted ? EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.SENT }) : EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_DOM_TRANSPORT_CANCELLED', reason: 'custom-event-cancelled' }); }
  async close() { try { this.target?.removeEventListener?.(this.eventName, this._listener); } catch {} this.receivers.clear(); return super.close(); }
}
export default DomCustomEventTransport;
