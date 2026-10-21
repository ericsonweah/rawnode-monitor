'use strict';

import { EventTransport } from './EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../delivery/EventDelivery.js';

export class LocalEventTransport extends EventTransport {
  constructor(dispatcher, options = {}) {
    super(options.id || 'local', { ...options, capabilities: { local: true, remote: false, ordered: true, acknowledged: true, durable: false, fanout: false, binary: false, requestReply: true, browser: true, server: true, ...(options.capabilities || {}) } });
    if (!dispatcher) throw new TypeError('LocalEventTransport requires a dispatcher.');
    this.dispatcher = dispatcher;
  }
  async publish(envelope, options = {}) {
    const startedAt = Date.now();
    await this.start();
    const payload = envelope?.content?.payload;
    const eventName = envelope?.name;
    if (!eventName) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope?.id, code: 'EVENT_NAME_REQUIRED', reason: 'missing-event-name' });
    try {
      if (options.async !== false && typeof this.dispatcher.dispatchAsync === 'function') await this.dispatcher.dispatchAsync(eventName, payload, envelope);
      else this.dispatcher.dispatch?.(eventName, payload, envelope);
      this.stats.published++;
      return EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.ACKNOWLEDGED, acknowledged: true, startedAt, finishedAt: Date.now() });
    } catch (error) { this._error(error); return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.FAILED, code: error.code || 'EVENT_LOCAL_DISPATCH_FAILED', reason: error.message, retryable: false, error, startedAt, finishedAt: Date.now() }); }
  }
}
export default LocalEventTransport;
