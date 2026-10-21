'use strict';

export class MemoryEventTransport {
  constructor(options = {}) {
    this.maxItems = Math.max(1, Number(options.maxItems) || 100_000);
    this.messages = [];
    this.listeners = new Map();
    this.closed = false;
    this.stats = { published: 0, broadcasts: 0, delivered: 0, dropped: 0 };
  }

  async publish(eventName, payload, options = {}) {
    if (this.closed) throw new Error('MemoryEventTransport is closed');
    const message = { eventName: String(eventName), payload, options, ts: Date.now() };
    this._append(message);
    this.stats.published++;
    for (const listener of this.listeners.get(message.eventName) || []) {
      await listener(payload, message);
      this.stats.delivered++;
    }
    for (const listener of this.listeners.get('*') || []) {
      await listener(message.eventName, payload, message);
      this.stats.delivered++;
    }
    return message;
  }

  async publishEnvelope(envelope, options = {}) { return this.publish(envelope.event, envelope, options); }

  async broadcast(envelope, options = {}) {
    this.stats.broadcasts++;
    return this.publish(envelope.event, envelope, options);
  }

  subscribe(eventName, listener) {
    const name = String(eventName);
    let bucket = this.listeners.get(name);
    if (!bucket) this.listeners.set(name, bucket = new Set());
    bucket.add(listener);
    const dispose = () => bucket.delete(listener);
    return { dispose, unsubscribe: dispose, off: dispose, [Symbol.dispose]: dispose };
  }

  all(eventName = null) { return (eventName == null ? this.messages : this.messages.filter((message) => message.eventName === String(eventName))).slice(); }
  clear() { const count = this.messages.length; this.messages.length = 0; return count; }
  _append(message) {
    if (this.messages.length >= this.maxItems) { this.messages.shift(); this.stats.dropped++; }
    this.messages.push(message);
  }
  async close() { this.closed = true; this.listeners.clear(); return this.snapshot(); }
  snapshot() { return Object.freeze({ closed: this.closed, messages: this.messages.length, listeners: this.listeners.size, stats: Object.freeze({ ...this.stats }) }); }
}

export default MemoryEventTransport;
