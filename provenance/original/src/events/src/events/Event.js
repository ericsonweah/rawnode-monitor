'use strict';

// src/events/Event.js

import { randomUUID } from 'node:crypto';

export class Event {
  constructor(payload = {}, options = {}) {
    this.payload = payload;
    this.timestamp = Number(options.timestamp) || Date.now();
    this.id = options.id || randomUUID();
    this.version = Math.max(1, Number(options.version) || Number(this.constructor.version) || 1);
    this.meta = options.meta && typeof options.meta === 'object' ? { ...options.meta } : {};
  }

  get eventName() {
    return this.constructor.eventName || this.constructor.name;
  }

  get occurredAt() { return new Date(this.timestamp); }
  get correlationId() { return this.meta.correlationId ?? this.ctx?.correlationId ?? null; }
  get causationId() { return this.meta.causationId ?? this.ctx?.causationId ?? null; }
  get tenantId() { return this.meta.tenantId ?? this.ctx?.tenantId ?? null; }

  withMeta(meta = {}) {
    if (meta && typeof meta === 'object') Object.assign(this.meta, meta);
    return this;
  }

  shouldBroadcast() { return false; }
  broadcastAs() { return this.constructor.name; }

  toJSON() {
    return {
      id: this.id,
      eventName: this.eventName,
      version: this.version,
      timestamp: this.timestamp,
      occurredAt: this.occurredAt.toISOString(),
      payload: this.payload,
      meta: { ...this.meta },
    };
  }
}

export default Event;
