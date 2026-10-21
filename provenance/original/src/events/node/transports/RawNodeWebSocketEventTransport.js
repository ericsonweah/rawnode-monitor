'use strict';

import { Buffer } from 'node:buffer';
import { EventTransport } from '../../universal/transport/EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../../universal/delivery/EventDelivery.js';
import { timeout } from '../../universal/support/safe.js';

export class RawNodeWebSocketEventTransport extends EventTransport {
  constructor(target, options = {}) {
    super(options.id || 'websocket', { ...options, capabilities: { remote: true, ordered: true, orderedByPartition: true, acknowledged: true, durable: false, fanout: true, binary: true, requestReply: true, server: true, maxPacketBytes: Number(options.maxPacketBytes) || 1024 * 1024, ...(options.capabilities || {}) } });
    if (!target) throw new TypeError('RawNodeWebSocketEventTransport requires a RawNode WS target.');
    this.target = target;
    this.eventName = options.eventName || 'rawnode:event';
    this.publishOperation = typeof options.publish === 'function' ? options.publish : null;
    this.receivers = new Set();
    this.ackTimeoutMs = Math.max(1, Number(options.ackTimeoutMs) || 15_000);
    this.owned = options.owned === true;
  }
  async start() {
    if (this.state === 'started') return this;
    await super.start();
    const handler = this._handler ||= (payload, peer, ack) => this._receive(payload, peer, ack);
    if (typeof this.target.on === 'function') this.target.on(this.eventName, handler);
    else this.target.addEventListener?.('message', this._nativeHandler ||= (event) => this._receiveNative(event));
    return this;
  }
  subscribe(receiver) { this.receivers.add(receiver); return () => this.receivers.delete(receiver); }
  _receive(payload, peer = null, ack = null) {
    const envelope = payload?.envelope || payload;
    if (!envelope?.name) return;
    this.stats.received++;
    for (const receiver of this.receivers) Promise.resolve(receiver(envelope, { transport: this, remote: true, peer, acknowledge: ack })).then((value) => { if (typeof ack === 'function') ack({ ok: true, value }); }, (error) => { if (typeof ack === 'function') ack({ ok: false, error: { code: error?.code || null, message: error?.message || String(error) } }); this._error(error); });
  }
  _receiveNative(event) { try { const value = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; if (value?.event === this.eventName || value?.__rawnodeEventFabric) this._receive(value.envelope || value.payload || value); } catch (error) { this.stats.rejected++; this._error(error); } }
  async publish(envelope, options = {}) {
    await this.start();
    const raw = envelope.encode?.() || JSON.stringify(envelope);
    const bytes = Buffer.byteLength(raw);
    if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE', reason: 'packet-too-large' });
    try {
      let value; let acknowledged = false;
      if (this.publishOperation) value = await this.publishOperation(envelope, { ...options, target: this.target, transport: this });
      else if ((options.requireAcknowledgement === true || options.ack === true) && typeof this.target.emitWithAck === 'function') { value = await timeout(this.target.emitWithAck(this.eventName, envelope, options), options.timeoutMs || this.ackTimeoutMs, { code: 'EVENT_WEBSOCKET_ACK_TIMEOUT' }); acknowledged = true; }
      else if (options.channel && typeof this.target.to === 'function') value = this.target.to(options.channel).emit(this.eventName, envelope);
      else if (typeof this.target.broadcast?.emit === 'function' && options.broadcast === true) value = this.target.broadcast.emit(this.eventName, envelope);
      else if (typeof this.target.emit === 'function') value = this.target.emit(this.eventName, envelope);
      else if (typeof this.target.send === 'function') value = this.target.send(raw);
      else return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_WEBSOCKET_PUBLISH_UNSUPPORTED', reason: 'publish-unsupported' });
      if (value === false) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_WEBSOCKET_NOT_ADMITTED', reason: 'transport-rejected', retryable: true });
      this.stats.published++; this.stats.bytesOut += bytes;
      return EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: acknowledged ? EventDeliveryState.ACKNOWLEDGED : EventDeliveryState.SENT, acknowledged, value });
    } catch (error) { this._error(error); return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.OUTCOME_UNKNOWN, code: error.code || 'EVENT_WEBSOCKET_PUBLISH_FAILED', reason: error.message, retryable: true, error }); }
  }
  async close() { try { this.target.off?.(this.eventName, this._handler); this.target.removeEventListener?.('message', this._nativeHandler); if (this.owned) await this.target.close?.(); } catch {} this.receivers.clear(); return super.close(); }
}
export default RawNodeWebSocketEventTransport;
