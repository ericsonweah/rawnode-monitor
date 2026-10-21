'use strict';

import { EventTransport } from '../../universal/transport/EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../../universal/delivery/EventDelivery.js';
import { byteLength, timeout } from '../../universal/support/safe.js';

export class WebSocketEventTransport extends EventTransport {
  constructor(socket, options = {}) {
    super(options.id || 'websocket', { ...options, capabilities: { remote: true, ordered: true, orderedByPartition: true, acknowledged: true, durable: false, fanout: false, binary: true, requestReply: true, browser: true, maxPacketBytes: Number(options.maxPacketBytes) || 1024 * 1024, ...(options.capabilities || {}) } });
    if (!socket) throw new TypeError('WebSocketEventTransport requires a RawSocketClient or WebSocket-like object.');
    this.socket = socket; this.eventName = options.eventName || 'rawnode:event'; this.ackTimeoutMs = Math.max(1, Number(options.ackTimeoutMs) || 15_000); this.maxBufferedBytes = Math.max(0, Number(options.maxBufferedBytes) || 4 * 1024 * 1024); this.receivers = new Set(); this.owned = options.owned === true; this.native = typeof socket.send === 'function' && typeof socket.emit !== 'function';
  }
  async start() { if (this.state === 'started') return this; await super.start(); if (typeof this.socket.on === 'function') { this._listener ||= (payload) => this._receive(payload); this.socket.on(this.eventName, this._listener); } else if (this.socket.addEventListener) { this._listener ||= (event) => this._receiveNative(event.data); this.socket.addEventListener('message', this._listener); } if (typeof this.socket.connect === 'function' && !this.socket.connected && this.options.autoConnect !== false) this.socket.connect(); return this; }
  subscribe(receiver) { this.receivers.add(receiver); return () => this.receivers.delete(receiver); }
  _receive(payload) { const envelope = payload?.envelope || payload; if (!envelope?.name) return; this.stats.received++; this.stats.bytesIn += byteLength(payload); for (const receiver of this.receivers) Promise.resolve(receiver(envelope, { transport: this, remote: true, socket: this.socket })).catch((error) => this._error(error)); }
  _receiveNative(data) { try { const message = typeof data === 'string' ? JSON.parse(data) : data; if (message?.event === this.eventName || message?.type === this.eventName || message?.__rawnodeEventFabric) this._receive(message.envelope || message.data || message.payload || message); } catch (error) { this.stats.rejected++; this._error(error); } }
  async publish(envelope, options = {}) {
    await this.start(); const bytes = envelope.byteLength?.() || byteLength(envelope);
    if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE', reason: 'packet-too-large' });
    if (this.maxBufferedBytes && Number(this.socket.bufferedAmount || this.socket.ws?.bufferedAmount || 0) > this.maxBufferedBytes) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_WEBSOCKET_BACKPRESSURE', reason: 'backpressure', retryable: true });
    try {
      let acknowledged = false; let value;
      if ((options.requireAcknowledgement === true || options.ack === true) && typeof this.socket.emitWithAck === 'function') { value = await timeout(this.socket.emitWithAck(this.eventName, envelope, { timeout: options.timeoutMs || this.ackTimeoutMs }), options.timeoutMs || this.ackTimeoutMs, { code: 'EVENT_WEBSOCKET_ACK_TIMEOUT' }); acknowledged = true; }
      else if (typeof this.socket.emit === 'function') { const accepted = this.socket.emit(this.eventName, envelope); if (accepted === false) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_WEBSOCKET_NOT_ADMITTED', reason: 'socket-rejected', retryable: true }); value = accepted; }
      else { const state = this.socket.readyState; const open = this.socket.OPEN ?? 1; if (state !== open) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_WEBSOCKET_NOT_OPEN', reason: 'socket-not-open', retryable: true }); this.socket.send(JSON.stringify({ __rawnodeEventFabric: true, event: this.eventName, envelope })); value = true; }
      this.stats.published++; this.stats.bytesOut += bytes;
      return EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: acknowledged ? EventDeliveryState.ACKNOWLEDGED : EventDeliveryState.SENT, acknowledged, value });
    } catch (error) { this._error(error); return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, state: error.delivery || EventDeliveryState.OUTCOME_UNKNOWN, code: error.code || 'EVENT_WEBSOCKET_PUBLISH_FAILED', reason: error.message, retryable: true, error }); }
  }
  health() { return Object.freeze({ ...super.health(), connected: this.socket.connected ?? this.socket.readyState === (this.socket.OPEN ?? 1), bufferedAmount: Number(this.socket.bufferedAmount || this.socket.ws?.bufferedAmount || 0), eventName: this.eventName, receivers: this.receivers.size }); }
  async close() { try { if (typeof this.socket.off === 'function') this.socket.off(this.eventName, this._listener); else this.socket.removeEventListener?.('message', this._listener); if (this.owned) await this.socket.close?.(); } catch {} this.receivers.clear(); return super.close(); }
}
export default WebSocketEventTransport;
