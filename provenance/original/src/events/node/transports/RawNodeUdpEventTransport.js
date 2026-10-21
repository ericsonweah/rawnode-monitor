'use strict';

import { Buffer } from 'node:buffer';
import { EventTransport } from '../../universal/transport/EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../../universal/delivery/EventDelivery.js';

export class RawNodeUdpEventTransport extends EventTransport {
  constructor(target, options = {}) {
    super(options.id || 'udp', { ...options, capabilities: { remote: true, ordered: false, orderedByPartition: false, acknowledged: false, durable: false, fanout: true, binary: true, requestReply: false, server: true, maxPacketBytes: Number(options.maxPacketBytes) || 60 * 1024, ...(options.capabilities || {}) } });
    if (!target) throw new TypeError('RawNodeUdpEventTransport requires a RawNode UDP target.');
    this.target = target;
    this.eventName = options.eventName || 'rawnode:event';
    this.publishOperation = typeof options.publish === 'function' ? options.publish : null;
    this.decode = typeof options.decode === 'function' ? options.decode : defaultDecode;
    this.encode = typeof options.encode === 'function' ? options.encode : defaultEncode;
    this.destination = options.destination || null;
    this.receivers = new Set();
    this.owned = options.owned === true;
  }
  async start() { if (this.state === 'started') return this; await super.start(); this._eventHandler ||= (payload, peer) => this._receive(payload, peer); this._messageHandler ||= (payload, peer) => this._receiveRaw(payload, peer); this.target.on?.(this.eventName, this._eventHandler); if (this.options.rawMessages === true) this.target.on?.('message', this._messageHandler); return this; }
  subscribe(receiver) { this.receivers.add(receiver); return () => this.receivers.delete(receiver); }
  _receive(payload, peer = null) { const envelope = payload?.envelope || payload; if (!envelope?.name) return; this.stats.received++; for (const receiver of this.receivers) Promise.resolve(receiver(envelope, { transport: this, remote: true, peer })).catch((error) => this._error(error)); }
  _receiveRaw(payload, peer) { try { const message = this.decode(payload, peer); if (message?.event === this.eventName || message?.__rawnodeEventFabric) this._receive(message.envelope || message.payload || message, peer); } catch (error) { this.stats.rejected++; this._error(error); } }
  async publish(envelope, options = {}) {
    await this.start(); const payload = this.encode({ __rawnodeEventFabric: true, event: this.eventName, envelope }); const bytes = payload.byteLength ?? Buffer.byteLength(payload);
    if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE', reason: 'packet-too-large' });
    const destination = options.destination || this.destination || {};
    try {
      let value;
      if (this.publishOperation) value = await this.publishOperation(envelope, { ...options, payload, target: this.target, transport: this });
      else if (typeof this.target.sendEvent === 'function') value = await this.target.sendEvent(this.eventName, envelope, destination);
      else if (typeof this.target.emitTo === 'function') value = await this.target.emitTo(destination, this.eventName, envelope);
      else if (typeof this.target.send === 'function' && destination.port) value = await sendDatagram(this.target, payload, destination.port, destination.address || destination.host || '127.0.0.1');
      else return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_UDP_DESTINATION_REQUIRED', reason: 'destination-required' });
      if (value === false) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_UDP_NOT_ADMITTED', reason: 'transport-rejected', retryable: true });
      this.stats.published++; this.stats.bytesOut += bytes;
      return EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.SENT, value });
    } catch (error) { this._error(error); return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.OUTCOME_UNKNOWN, code: error.code || 'EVENT_UDP_PUBLISH_FAILED', reason: error.message, retryable: true, error }); }
  }
  async close() { try { this.target.off?.(this.eventName, this._eventHandler); this.target.off?.('message', this._messageHandler); if (this.owned) await this.target.close?.(); } catch {} this.receivers.clear(); return super.close(); }
}
function defaultEncode(value) { return Buffer.from(JSON.stringify(value)); }
function defaultDecode(value) { return JSON.parse(Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value).toString('utf8') : String(value)); }
function sendDatagram(target, payload, port, address) { return new Promise((resolve, reject) => { const accepted = target.send(payload, port, address, (error) => error ? reject(error) : resolve(true)); if (accepted === false) resolve(false); }); }
export default RawNodeUdpEventTransport;
