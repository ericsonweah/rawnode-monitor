'use strict';

import { SignalKind } from '../constants.js';

export class SignalSpanProcessor {
  constructor(emitter) { this.emitter = emitter; this.closed = false; this.stats = { ended: 0, rejected: 0 }; }
  onEnd(span) {
    if (this.closed || span?.sampled === false) return false;
    const result = this.emitter?.(SignalKind.SPAN, span, { traceId: span.traceId, spanId: span.spanId, priority: span.status?.code === 'error' ? 10 : 0 });
    this.stats.ended++;
    if (result?.accepted === false) this.stats.rejected++;
    return result;
  }
  async forceFlush() {}
  async shutdown() { this.closed = true; }
  snapshot() { return Object.freeze({ closed: this.closed, stats: Object.freeze({ ...this.stats }) }); }
}

export default SignalSpanProcessor;
