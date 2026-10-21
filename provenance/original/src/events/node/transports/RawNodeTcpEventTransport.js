'use strict';

import { Buffer } from 'node:buffer';
import { EventTransport } from '../../universal/transport/EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../../universal/delivery/EventDelivery.js';

export class RawNodeTcpEventTransport extends EventTransport {
  constructor(target, options = {}) {
    super(options.id || 'tcp', { ...options, capabilities: { remote: true, ordered: true, orderedByPartition: true, acknowledged: options.acknowledged !== false, durable: false, fanout: true, binary: true, requestReply: true, server: true, maxPacketBytes: Number(options.maxPacketBytes) || 4 * 1024 * 1024, ...(options.capabilities || {}) } });
    if (!target) throw new TypeError('RawNodeTcpEventTransport requires a RawNode TCP target.');
    this.target = target;
    this.eventName = options.eventName || 'rawnode:event';
    this.publishOperation = typeof options.publish === 'function' ? options.publish : null;
    this.receivers = new Set();
    this.owned = options.owned === true;
  }
  async start() { if (this.state === 'started') return this; await super.start(); this._handler ||= (payload, connection, ack) => this._receive(payload, connection, ack); this.target.on?.(this.eventName, this._handler); this.target.onEvent?.(this.eventName, this._handler); return this; }
  subscribe(receiver) { this.receivers.add(receiver); return () => this.receivers.delete(receiver); }
  _receive(payload, connection = null, ack = null) { const envelope = payload?.envelope || payload; if (!envelope?.name) return; this.stats.received++; for (const receiver of this.receivers) Promise.resolve(receiver(envelope, { transport: this, remote: true, connection, acknowledge: ack })).then((value) => ack?.({ ok: true, value }), (error) => { ack?.({ ok: false, error: { code: error?.code || null, message: error?.message || String(error) } }); this._error(error); }); }
  async publish(envelope, options = {}) {
    await this.start(); const raw = envelope.encode?.() || JSON.stringify(envelope); const bytes = Buffer.byteLength(raw);
    if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE', reason: 'packet-too-large' });
    try {
      let value;
      if (this.publishOperation) value = await this.publishOperation(envelope, { ...options, target: this.target, transport: this });
      else if (typeof this.target.sendEvent === 'function') value = await this.target.sendEvent(this.eventName, envelope, options);
      else if (options.connection?.emit) value = options.connection.emit(this.eventName, envelope);
      else if (options.connection?.send) value = options.connection.send(raw);
      else if (options.room && typeof this.target.to === 'function') value = this.target.to(options.room).emit(this.eventName, envelope);
      else if (typeof this.target.broadcast === 'function') value = await this.target.broadcast(this.eventName, envelope, options);
      else if (typeof this.target.emit === 'function') value = this.target.emit(this.eventName, envelope);
      else if (typeof this.target.send === 'function') value = this.target.send(raw, options);
      else return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TCP_PUBLISH_UNSUPPORTED', reason: 'publish-unsupported' });
      if (value === false) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TCP_NOT_ADMITTED', reason: 'transport-rejected', retryable: true });
      this.stats.published++; this.stats.bytesOut += bytes;
      const acknowledged = value?.acknowledged === true || value?.acked === true;
      return EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: acknowledged ? EventDeliveryState.ACKNOWLEDGED : EventDeliveryState.SENT, acknowledged, value });
    } catch (error) { this._error(error); return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.OUTCOME_UNKNOWN, code: error.code || 'EVENT_TCP_PUBLISH_FAILED', reason: error.message, retryable: true, error }); }
  }
  async close() { try { this.target.off?.(this.eventName, this._handler); this.target.offEvent?.(this.eventName, this._handler); if (this.owned) await this.target.close?.(); } catch {} this.receivers.clear(); return super.close(); }
}
export default RawNodeTcpEventTransport;
