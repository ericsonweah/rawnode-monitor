'use strict';

import { randomUUID } from 'node:crypto';
import { MemoryOutboxStore } from './MemoryOutboxStore.js';
import { shallowEventContext } from '../context/EventContext.js';

export class EventOutbox {
  constructor(options = {}) {
    this.store = options.store || new MemoryOutboxStore(options.memory || options);
    this.dispatcher = options.dispatcher || null;
    this.schemaRegistry = options.schemaRegistry || null;
    this.nodeId = options.nodeId || `${process.pid}`;
    this.defaultMaxAttempts = Math.max(1, Number(options.maxAttempts) || 10);
  }

  async enqueue(eventOrName, args = [], options = {}) {
    const eventObject = typeof eventOrName === 'object' && eventOrName !== null ? eventOrName : null;
    const eventName = eventObject
      ? String(eventObject.constructor?.eventName || eventObject.eventName || eventObject.constructor?.name || 'Event')
      : String(eventOrName);
    const payloadArgs = eventObject ? [eventObject, ...(Array.isArray(args) ? args : [args])] : (Array.isArray(args) ? args : [args]);
    const version = Math.max(1, Number(options.version || eventObject?.version) || 1);

    if (this.schemaRegistry?.has?.(eventName, version) && eventObject?.payload !== undefined) {
      this.schemaRegistry.validate(eventName, version, eventObject.payload, { phase: 'outbox' });
    }

    const context = options.context || this.dispatcher?.getContext?.() || eventObject?.ctx || null;
    return this.store.append({
      id: options.id || eventObject?.id || randomUUID(),
      event: eventName,
      version,
      args: payloadArgs,
      context: shallowEventContext(context),
      headers: options.headers,
      idempotencyKey: options.idempotencyKey,
      maxAttempts: options.maxAttempts || this.defaultMaxAttempts,
      availableAt: options.availableAt,
      meta: { nodeId: this.nodeId, ...(options.meta || {}) },
    });
  }

  async dispatchAfterCommit(transaction, eventOrName, args = [], options = {}) {
    if (!transaction || typeof transaction.afterCommit !== 'function') {
      throw new TypeError('dispatchAfterCommit requires a transaction exposing afterCommit(callback)');
    }
    let result;
    transaction.afterCommit(async () => { result = await this.enqueue(eventOrName, args, options); });
    return { scheduled: true, get result() { return result; } };
  }

  snapshot() { return this.store.snapshot?.() || null; }
  close() { return this.store.close?.(); }
}

export default EventOutbox;
