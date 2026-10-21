'use strict';

/** Bounded TTL idempotency inbox for at-least-once consumers. */
export class MemoryEventInbox {
  constructor(options = {}) {
    this.maxItems = Math.max(1, Number(options.maxItems) || 100_000);
    this.ttlMs = Math.max(1, Number(options.ttlMs) || 24 * 60 * 60 * 1000);
    this.entries = new Map();
    this.inFlight = new Map();
    this.stats = { accepted: 0, duplicates: 0, completed: 0, failed: 0, evicted: 0 };
  }

  has(id, now = Date.now()) {
    const key = String(id);
    const expiresAt = this.entries.get(key);
    if (expiresAt == null) return false;
    if (expiresAt <= now) { this.entries.delete(key); return false; }
    return true;
  }

  async run(id, handler, options = {}) {
    const key = String(id || '');
    if (!key) throw new TypeError('Inbox id is required');
    if (typeof handler !== 'function') throw new TypeError('Inbox handler must be a function');
    if (this.has(key)) { this.stats.duplicates++; return { accepted: false, duplicate: true }; }
    if (this.inFlight.has(key)) { this.stats.duplicates++; return this.inFlight.get(key); }

    const operation = (async () => {
      this.stats.accepted++;
      try {
        const value = await handler();
        this.remember(key, options.ttlMs);
        this.stats.completed++;
        return { accepted: true, duplicate: false, value };
      } catch (error) {
        this.stats.failed++;
        throw error;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, operation);
    return operation;
  }

  remember(id, ttlMs = this.ttlMs) {
    const now = Date.now();
    this.entries.set(String(id), now + Math.max(1, Number(ttlMs) || this.ttlMs));
    this._evict(now);
    return this;
  }

  _evict(now = Date.now()) {
    for (const [id, expiresAt] of this.entries) {
      if (expiresAt <= now) { this.entries.delete(id); this.stats.evicted++; }
    }
    while (this.entries.size > this.maxItems) {
      const id = this.entries.keys().next().value;
      this.entries.delete(id);
      this.stats.evicted++;
    }
  }

  clear() { this.entries.clear(); this.inFlight.clear(); }
  snapshot() { return Object.freeze({ items: this.entries.size, inFlight: this.inFlight.size, maxItems: this.maxItems, ttlMs: this.ttlMs, stats: Object.freeze({ ...this.stats }) }); }
}

export default MemoryEventInbox;
