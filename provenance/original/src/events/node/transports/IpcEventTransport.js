'use strict';

import { EventTransport } from '../../universal/transport/EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../../universal/delivery/EventDelivery.js';

export class IpcEventTransport extends EventTransport {
  constructor(endpoint = process, options = {}) {
    super(options.id || 'ipc', { ...options, capabilities: { remote: true, ordered: true, acknowledged: false, durable: false, fanout: false, binary: true, requestReply: true, server: true, maxPacketBytes: Number(options.maxPacketBytes) || 8 * 1024 * 1024, ...(options.capabilities || {}) } });
    this.endpoint = endpoint;
    this.receivers = new Set();
    this.originId = options.originId || `${process.pid}`;
  }
  async start() { if (this.state === 'started') return this; await super.start(); this._handler ||= (message) => { if (!message?.__rawnodeEventFabric || message.originId === this.originId) return; this.stats.received++; for (const receiver of this.receivers) Promise.resolve(receiver(message.envelope, { transport: this, remote: true, message })).catch((error) => this._error(error)); }; this.endpoint.on?.('message', this._handler); this.endpoint.addEventListener?.('message', this._eventHandler ||= (event) => this._handler(event.data)); return this; }
  subscribe(receiver) { this.receivers.add(receiver); return () => this.receivers.delete(receiver); }
  async publish(envelope) { await this.start(); const message = { __rawnodeEventFabric: true, protocolVersion: 3, originId: this.originId, envelope }; try { let value; if (typeof this.endpoint.send === 'function') value = await new Promise((resolve, reject) => { const result = this.endpoint.send(message, (error) => error ? reject(error) : resolve(true)); if (result === false) resolve(false); }); else if (typeof this.endpoint.postMessage === 'function') { this.endpoint.postMessage(message); value = true; } else return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_IPC_SEND_UNAVAILABLE', reason: 'send-unavailable' }); if (value === false) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_IPC_BACKPRESSURE', reason: 'backpressure', retryable: true }); this.stats.published++; return EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.SENT }); } catch (error) { this._error(error); return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.OUTCOME_UNKNOWN, code: error.code || 'EVENT_IPC_PUBLISH_FAILED', reason: error.message, retryable: true, error }); } }
  async close() { this.endpoint.off?.('message', this._handler); this.endpoint.removeEventListener?.('message', this._eventHandler); this.receivers.clear(); return super.close(); }
}
export default IpcEventTransport;
