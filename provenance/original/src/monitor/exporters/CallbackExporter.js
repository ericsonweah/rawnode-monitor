'use strict';
export class CallbackExporter {
  constructor(callback, options = {}) { if (typeof callback !== 'function') throw new TypeError('CallbackExporter requires a callback.'); this.callback = callback; this.name = options.name || 'callback'; this.closed = false; this.stats = { batches: 0, signals: 0, errors: 0 }; }
  async export(signals, options = {}) { if (this.closed) return false; try { await this.callback(signals, options); this.stats.batches++; this.stats.signals += signals.length; return true; } catch (error) { this.stats.errors++; throw error; } }
  async flush() {}
  async close() { this.closed = true; }
  snapshot() { return Object.freeze({ name: this.name, closed: this.closed, stats: Object.freeze({ ...this.stats }) }); }
}
export default CallbackExporter;
