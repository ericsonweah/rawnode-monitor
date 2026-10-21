'use strict';

export class SeenMessageWindow {
  constructor(options = {}) {
    this.maxItems = Math.max(1, Number(options.maxItems ?? options.limit) || 50_000);
    this.ttlMs = Math.max(1, Number(options.ttlMs) || 60_000);
    this.map = new Map();
    this.queue = [];
    this.head = 0;
    this.stats = { remembered: 0, duplicate: 0, expired: 0, evicted: 0 };
  }

  has(id, now = Date.now()) {
    const expiresAt = this.map.get(id);
    if (expiresAt == null) return false;
    if (expiresAt <= now) {
      this.map.delete(id);
      this.stats.expired++;
      return false;
    }
    this.stats.duplicate++;
    return true;
  }

  remember(id, now = Date.now()) {
    const expiresAt = now + this.ttlMs;
    this.map.set(id, expiresAt);
    this.queue.push({ id, expiresAt });
    this.stats.remembered++;
    this.prune(now);
    while (this.map.size > this.maxItems) {
      const marker = this.queue[this.head++];
      if (!marker) break;
      if (this.map.get(marker.id) === marker.expiresAt) {
        this.map.delete(marker.id);
        this.stats.evicted++;
      }
    }
    this._compact();
    return this;
  }

  prune(now = Date.now(), budget = 1024) {
    let checked = 0;
    while (this.head < this.queue.length && checked++ < budget) {
      const marker = this.queue[this.head];
      const current = this.map.get(marker.id);
      if (current !== marker.expiresAt) { this.head++; continue; }
      if (marker.expiresAt > now) break;
      this.head++;
      this.map.delete(marker.id);
      this.stats.expired++;
    }
    this._compact();
  }

  _compact() {
    if (this.head > 4096 && this.head > this.queue.length / 2) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }
  }

  clear() { this.map.clear(); this.queue.length = 0; this.head = 0; }
  snapshot() { return Object.freeze({ size: this.map.size, maxItems: this.maxItems, ttlMs: this.ttlMs, stats: Object.freeze({ ...this.stats }) }); }
}

export default SeenMessageWindow;
