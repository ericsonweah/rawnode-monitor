'use strict';

import { SignalKind } from '../constants.js';

/** Logger transport adapter. It accepts common write/log/handle contracts. */
export class MonitorLogTransport {
  constructor(monitor, options = {}) { this.monitor = monitor; this.name = options.name || 'monitor'; this.level = options.level || 'trace'; this.closed = false; this.stats = { written: 0, rejected: 0 }; }
  write(record) { return this._record(record); }
  log(record, callback) { try { this._record(record); callback?.(); } catch (error) { callback?.(error); } }
  handle(record) { return this._record(record); }
  _record(record = {}) {
    if (this.closed) return false;
    const context = this.monitor.context.active();
    const result = this.monitor.emitSignal(SignalKind.LOG, {
      timestamp: record.timestamp || record.time || Date.now(),
      level: record.level || record.severity || 'info',
      message: record.message || record.msg || '',
      channel: record.channel || record.logger || null,
      context: record.context || record.meta || null,
      error: record.error || record.exception || null,
    }, { context, traceId: record.traceId || context.traceId, spanId: record.spanId || context.spanId, priority: levelPriority(record.level) });
    this.stats.written++; if (result?.accepted === false) this.stats.rejected++; return result;
  }
  async flush() {}
  async close() { this.closed = true; }
  snapshot() { return Object.freeze({ name: this.name, closed: this.closed, stats: Object.freeze({ ...this.stats }) }); }
}
function levelPriority(level) { return ['fatal', 'emergency', 'alert', 'critical'].includes(String(level).toLowerCase()) ? 20 : ['error'].includes(String(level).toLowerCase()) ? 10 : 0; }
export default MonitorLogTransport;
