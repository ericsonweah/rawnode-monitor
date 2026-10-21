'use strict';

import { Buffer } from 'node:buffer';
import { EventTransport } from '../../universal/transport/EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../../universal/delivery/EventDelivery.js';

export class RedisPubSubEventTransport extends EventTransport {
  constructor(client, options = {}) {
    super(options.id || 'redis-pubsub', { ...options, capabilities: { remote: true, ordered: false, acknowledged: false, durable: false, fanout: true, binary: false, requestReply: true, server: true, maxPacketBytes: Number(options.maxPacketBytes) || 1024 * 1024, ...(options.capabilities || {}) } });
    if (!client) throw new TypeError('RedisPubSubEventTransport requires a Redis client.');
    this.client = client;
    this.channel = options.channel || 'rawnode:events:v3';
    this.receivers = new Set();
    this.subscription = null;
    this.owned = options.owned === true;
  }
  async start() {
    if (this.state === 'started') return this;
    await super.start();
    const handler = this._handler ||= (message, channel) => this._receive(message, channel);
    this.subscription = await this.client.subscribe(this.channel, handler, { serial: true, ...(this.options.subscribe || {}) });
    await this.subscription?.ready?.();
    return this;
  }
  subscribe(receiver) { if (typeof receiver !== 'function') throw new TypeError('Redis event receiver must be a function.'); this.receivers.add(receiver); return () => this.receivers.delete(receiver); }
  _receive(message, channel = this.channel) {
    try {
      const raw = Buffer.isBuffer(message) || message instanceof Uint8Array ? Buffer.from(message).toString('utf8') : String(message);
      const bytes = Buffer.byteLength(raw);
      if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) { this.stats.rejected++; return; }
      const envelope = JSON.parse(raw);
      this.stats.received++; this.stats.bytesIn += bytes;
      for (const receiver of this.receivers) Promise.resolve(receiver(envelope, { transport: this, channel, remote: true })).catch((error) => this._error(error));
    } catch (error) { this.stats.rejected++; this._error(error); }
  }
  async publish(envelope) {
    await this.start();
    const raw = envelope.encode?.() || JSON.stringify(envelope);
    const bytes = Buffer.byteLength(raw);
    if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE', reason: 'packet-too-large' });
    try {
      const receivers = await this.client.publish(this.channel, raw);
      this.stats.published++; this.stats.bytesOut += bytes;
      return EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.SENT, value: { receivers } });
    } catch (error) { this._error(error); return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.FAILED, code: error.code || 'EVENT_REDIS_PUBLISH_FAILED', reason: error.message, retryable: true, error }); }
  }
  async close() {
    try { if (this.subscription?.unsubscribe) await this.subscription.unsubscribe(); else await this.client.unsubscribe?.(this.channel, this._handler); } catch {}
    this.subscription = null; this.receivers.clear();
    if (this.owned) await this.client.close?.();
    return super.close();
  }
}
export default RedisPubSubEventTransport;
