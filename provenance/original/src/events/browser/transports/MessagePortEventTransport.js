'use strict';

import { EventTransport } from '../../universal/transport/EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../../universal/delivery/EventDelivery.js';
import { byteLength, randomId } from '../../universal/support/safe.js';

export class MessagePortEventTransport extends EventTransport {
  constructor(port, options = {}) {
    super(options.id || 'message-port', { ...options, capabilities: { remote: true, ordered: true, acknowledged: false, durable: false, fanout: false, binary: true, requestReply: true, browser: true, maxPacketBytes: Number(options.maxPacketBytes) || 8 * 1024 * 1024, ...(options.capabilities || {}) } });
    if (!port?.postMessage) throw new TypeError('MessagePortEventTransport requires a MessagePort-like object.');
    this.port = port; this.originId = options.originId || randomId('port'); this.receivers = new Set(); this.owned = options.owned === true;
  }
  async start() { if (this.state === 'started') return this; await super.start(); this._onMessage ||= (event) => this._receive(event.data ?? event); this.port.addEventListener?.('message', this._onMessage); if (!this.port.addEventListener) this.port.onmessage = this._onMessage; this.port.start?.(); return this; }
  subscribe(receiver) { this.receivers.add(receiver); return () => this.receivers.delete(receiver); }
  _receive(message) { if (!message?.__rawnodeEventFabric || message.originId === this.originId) return; const bytes = byteLength(message); if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) { this.stats.rejected++; return; } this.stats.received++; this.stats.bytesIn += bytes; for (const receiver of this.receivers) Promise.resolve(receiver(message.envelope, { transport: this, originId: message.originId, remote: true })).catch((error) => this._error(error)); }
  async publish(envelope, options = {}) { await this.start(); const bytes = envelope.byteLength?.() || byteLength(envelope); if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE', reason: 'packet-too-large' }); try { const transfer = Array.isArray(options.transfer) ? options.transfer : []; this.port.postMessage({ __rawnodeEventFabric: true, protocolVersion: 3, originId: this.originId, at: Date.now(), envelope }, transfer); this.stats.published++; this.stats.bytesOut += bytes; return EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.SENT }); } catch (error) { this._error(error); return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: error.code || 'EVENT_MESSAGE_PORT_PUBLISH_FAILED', reason: error.message, error }); } }
  async close() { try { this.port.removeEventListener?.('message', this._onMessage); if (this.owned) this.port.close?.(); } catch {} this.receivers.clear(); return super.close(); }
}
export default MessagePortEventTransport;
