'use strict';

export class SeenEventWindow {
  constructor(options = {}) { this.maxItems = Math.max(1, Number(options.maxItems) || 100_000); this.ttlMs = Math.max(1, Number(options.ttlMs) || 5 * 60_000); this.values = new Map(); this.stats = { added: 0, duplicates: 0, expired: 0, evicted: 0 }; }
  has(id, now = Date.now()) { const key = String(id); const expiresAt = this.values.get(key); if (!expiresAt) return false; if (expiresAt <= now) { this.values.delete(key); this.stats.expired++; return false; } this.stats.duplicates++; return true; }
  add(id, now = Date.now()) { const key = String(id); this.prune(now); if (!this.values.has(key) && this.values.size >= this.maxItems) { const oldest = this.values.keys().next().value; this.values.delete(oldest); this.stats.evicted++; } this.values.delete(key); this.values.set(key, now + this.ttlMs); this.stats.added++; return true; }
  checkAndAdd(id, now = Date.now()) { if (this.has(id, now)) return false; this.add(id, now); return true; }
  prune(now = Date.now()) { for (const [id, expiresAt] of this.values) { if (expiresAt > now) break; this.values.delete(id); this.stats.expired++; } }
  snapshot() { return Object.freeze({ size: this.values.size, maxItems: this.maxItems, ttlMs: this.ttlMs, stats: Object.freeze({ ...this.stats }) }); }
  clear() { this.values.clear(); }
}
export default SeenEventWindow;
