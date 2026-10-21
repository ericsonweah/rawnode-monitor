'use strict';

export class RetentionManager {
  constructor(store, options = {}) { this.store = store; this.retentionMs = Math.max(60_000, Number(options.retentionMs) || 30 * 24 * 60 * 60_000); this.intervalMs = Math.max(60_000, Number(options.intervalMs) || Math.min(this.retentionMs / 4, 6 * 60 * 60_000)); this.timer = null; this.stats = { runs: 0, removed: 0, errors: 0 }; }
  start() { if (this.timer || typeof this.store?.prune !== 'function') return this; this.timer = setInterval(() => void this.run().catch(() => {}), this.intervalMs); this.timer.unref?.(); return this; }
  async run(now = Date.now()) { this.stats.runs++; try { const removed = Number(await this.store.prune({ before: now - this.retentionMs, retentionMs: this.retentionMs })) || 0; this.stats.removed += removed; return removed; } catch (error) { this.stats.errors++; throw error; } }
  async close() { clearInterval(this.timer); this.timer = null; }
  snapshot() { return Object.freeze({ retentionMs: this.retentionMs, intervalMs: this.intervalMs, running: !!this.timer, stats: Object.freeze({ ...this.stats }) }); }
}
export default RetentionManager;
