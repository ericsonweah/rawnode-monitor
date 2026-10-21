'use strict';

import { boundedInteger } from '../support.js';

export class InMemorySpanStore {
  constructor(options = {}) {
    this.maxSpans = boundedInteger(options.maxSpans ?? options.maxSpansInMemory, 20_000, 1, 10_000_000);
    this.maxTraceAgeMs = boundedInteger(options.maxTraceAgeMs, 15 * 60_000, 1_000, 365 * 24 * 60 * 60_000);
    this.spans = new Array(this.maxSpans);
    this.cursor = 0;
    this.length = 0;
    this.byTrace = new Map();
    this.nextPruneAt = Infinity;
    this.stats = { added: 0, evicted: 0, pruned: 0, invalid: 0 };
  }

  add(span) {
    const record = span?.toJSON ? span.toJSON() : span;
    if (!record?.traceId) return false;
    let timestamp;
    try { timestamp = BigInt(record.startTimeUnixNano); }
    catch { this.stats.invalid++; return false; }
    const now = Date.now();
    this._pruneIfDue(now);
    if (timestamp < BigInt(now - this.maxTraceAgeMs) * 1_000_000n) { this.stats.pruned++; return false; }
    if (this.length === this.maxSpans) {
      const evicted = this.spans[this.cursor];
      this._removeIndex(evicted);
      this.stats.evicted++;
    } else this.length++;
    this.spans[this.cursor] = record;
    this.cursor = (this.cursor + 1) % this.maxSpans;
    const list = this.byTrace.get(record.traceId) || [];
    list.push(record);
    this.byTrace.set(record.traceId, list);
    this.stats.added++;
    this.nextPruneAt = Math.min(this.nextPruneAt, Number(timestamp / 1_000_000n) + this.maxTraceAgeMs + 1);
    return true;
  }

  trace(traceId) { this._pruneIfDue(); return Object.freeze((this.byTrace.get(String(traceId)) || []).slice().sort((a, b) => { const left = BigInt(a.startTimeUnixNano); const right = BigInt(b.startTimeUnixNano); return left < right ? -1 : left > right ? 1 : 0; })); }

  query(options = {}) {
    let rows = this.all();
    if (options.traceId) rows = rows.filter((row) => row.traceId === String(options.traceId));
    if (options.name) rows = rows.filter((row) => row.name === String(options.name));
    if (options.status) rows = rows.filter((row) => row.status?.code === String(options.status));
    if (options.minDurationMs != null) rows = rows.filter((row) => Number(row.durationMs || 0) >= Number(options.minDurationMs));
    if (options.since) rows = rows.filter((row) => Number(BigInt(row.startTimeUnixNano) / 1_000_000n) >= Number(options.since));
    return Object.freeze(rows.slice(-(Math.max(1, Number(options.limit) || 100))));
  }

  all() {
    this._pruneIfDue();
    return this._all();
  }

  _all() {
    const output = [];
    const start = (this.cursor - this.length + this.maxSpans) % this.maxSpans;
    for (let index = 0; index < this.length; index++) {
      const item = this.spans[(start + index) % this.maxSpans];
      if (item) output.push(item);
    }
    return output;
  }

  prune(now = Date.now()) {
    const time = Number(now);
    if (!Number.isSafeInteger(time)) throw new TypeError('Span retention time must be an integer timestamp.');
    const cutoffNs = BigInt(time - this.maxTraceAgeMs) * 1_000_000n;
    const retained = this._all().filter(span => BigInt(span.startTimeUnixNano) >= cutoffNs);
    const removed = this.length - retained.length;
    this.spans.fill(undefined);
    this.byTrace.clear();
    this.length = retained.length;
    this.cursor = this.length % this.maxSpans;
    this.nextPruneAt = Infinity;
    for (let index = 0; index < retained.length; index++) {
      const span = retained[index];
      this.spans[index] = span;
      const trace = this.byTrace.get(span.traceId) || [];
      trace.push(span);
      this.byTrace.set(span.traceId, trace);
      this.nextPruneAt = Math.min(this.nextPruneAt, Number(BigInt(span.startTimeUnixNano) / 1_000_000n) + this.maxTraceAgeMs + 1);
    }
    this.stats.pruned += removed;
    return removed;
  }

  _pruneIfDue(now = Date.now()) { if (now >= this.nextPruneAt) this.prune(now); }

  _removeIndex(record) {
    if (!record?.traceId) return;
    const list = this.byTrace.get(record.traceId);
    if (!list) return;
    const index = list.indexOf(record);
    if (index !== -1) list.splice(index, 1);
    if (!list.length) this.byTrace.delete(record.traceId);
  }

  snapshot() { this._pruneIfDue(); return Object.freeze({ maxSpans: this.maxSpans, length: this.length, traces: this.byTrace.size, maxTraceAgeMs: this.maxTraceAgeMs, stats: Object.freeze({ ...this.stats }) }); }
}

export default InMemorySpanStore;
