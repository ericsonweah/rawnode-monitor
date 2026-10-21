'use strict';

import { EventTransport } from '../../universal/transport/EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../../universal/delivery/EventDelivery.js';
import { byteLength, randomId } from '../../universal/support/safe.js';

export class BroadcastChannelEventTransport extends EventTransport {
  constructor(options = {}) {
    super(options.id || 'broadcast-channel', { ...options, capabilities: { local: false, remote: true, ordered: true, orderedByPartition: false, acknowledged: false, durable: false, fanout: true, binary: true, requestReply: true, browser: true, maxPacketBytes: Number(options.maxPacketBytes) || 4 * 1024 * 1024, ...(options.capabilities || {}) } });
    this.channelName = options.channelName || 'rawnode.events.v3';
    this.originId = options.originId || randomId('tab');
    this.channel = options.channel || null;
    this.receivers = new Set();
  }
  async start() { if (this.state === 'started') return this; await super.start(); if (!this.channel) { if (typeof BroadcastChannel !== 'function') throw this._error(Object.assign(new Error('BroadcastChannel is unavailable.'), { code: 'EVENT_BROADCAST_CHANNEL_UNAVAILABLE' })); this.channel = new BroadcastChannel(this.channelName); } this.channel.addEventListener?.('message', this._onMessage ||= (event) => this._receive(event.data)); if (!this.channel.addEventListener) this.channel.onmessage = this._onMessage; return this; }
  subscribe(receiver) { if (typeof receiver !== 'function') throw new TypeError('BroadcastChannel receiver must be a function.'); this.receivers.add(receiver); return () => this.receivers.delete(receiver); }
  _receive(message) { if (!message?.__rawnodeEventFabric || message.originId === this.originId) return; const bytes = byteLength(message); if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) { this.stats.rejected++; return; } this.stats.received++; this.stats.bytesIn += bytes; for (const receiver of this.receivers) Promise.resolve(receiver(message.envelope, { transport: this, originId: message.originId, remote: true })).catch((error) => this._error(error)); }
  async publish(envelope) { await this.start(); const bytes = envelope.byteLength?.() || byteLength(envelope); if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE', reason: 'packet-too-large' }); try { this.channel.postMessage({ __rawnodeEventFabric: true, protocolVersion: 3, originId: this.originId, at: Date.now(), envelope }); this.stats.published++; this.stats.bytesOut += bytes; return EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.SENT }); } catch (error) { this._error(error); return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.FAILED, code: error.code || 'EVENT_BROADCAST_CHANNEL_PUBLISH_FAILED', reason: error.message, error }); } }
  health() { return Object.freeze({ ...super.health(), channelName: this.channelName, originId: this.originId, receivers: this.receivers.size }); }
  async close() { if (this.state === 'closed') return this.health(); try { this.channel?.removeEventListener?.('message', this._onMessage); this.channel?.close?.(); } catch {} this.channel = null; this.receivers.clear(); return super.close(); }
}
export default BroadcastChannelEventTransport;
