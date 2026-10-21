'use strict';

import { dispatchEvent } from '../support.js';

export class EventExporter {
  constructor(events, options = {}) { this.events = events; this.eventName = options.eventName || 'monitor:signals'; this.perSignal = options.perSignal === true; this.closed = false; this.stats = { batches: 0, signals: 0, rejected: 0 }; }
  async export(signals) {
    if (this.closed || !this.events) return false;
    let accepted = true;
    if (this.perSignal) for (const signal of signals) accepted = dispatchEvent(this.events, `monitor:signal:${signal.kind}`, signal) && accepted;
    else accepted = dispatchEvent(this.events, this.eventName, signals);
    this.stats.batches++; this.stats.signals += signals.length; if (!accepted) this.stats.rejected++;
    return accepted;
  }
  async close() { this.closed = true; }
  snapshot() { return Object.freeze({ eventName: this.eventName, perSignal: this.perSignal, closed: this.closed, stats: Object.freeze({ ...this.stats }) }); }
}
export default EventExporter;
