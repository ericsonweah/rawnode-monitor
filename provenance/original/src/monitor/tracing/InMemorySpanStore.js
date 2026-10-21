'use strict';

export class InMemorySpanStore {
  constructor(options = {}) {
    this.maxSpans = Math.max(1, Number(options.maxSpans) || 20_000);
    this.maxTraceAgeMs = Math.max(1_000, Number(options.maxTraceAgeMs) || 15 * 60_000);
    this.spans = new Array(this.maxSpans);
    this.cursor = 0;
    this.length = 0;
    this.byTrace = new Map();
    this.stats = { added: 0, evicted: 0, pruned: 0 };
  }

  add(span) {
    const record = span?.toJSON ? span.toJSON() : span;
    if (!record?.traceId) return false;
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
    if (this.byTrace.size > this.maxSpans) this.prune();
    return true;
  }

  trace(traceId) { return Object.freeze((this.byTrace.get(String(traceId)) || []).slice().sort((a, b) => { const left = BigInt(a.startTimeUnixNano); const right = BigInt(b.startTimeUnixNano); return left < right ? -1 : left > right ? 1 : 0; })); }

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
    const output = [];
    const start = (this.cursor - this.length + this.maxSpans) % this.maxSpans;
    for (let index = 0; index < this.length; index++) {
      const item = this.spans[(start + index) % this.maxSpans];
      if (item) output.push(item);
    }
    return output;
  }

  prune(now = Date.now()) {
    const cutoffNs = BigInt(now - this.maxTraceAgeMs) * 1_000_000n;
    let removed = 0;
    for (const [traceId, spans] of this.byTrace) {
      const retained = spans.filter((span) => BigInt(span.startTimeUnixNano) >= cutoffNs);
      removed += spans.length - retained.length;
      if (retained.length) this.byTrace.set(traceId, retained);
      else this.byTrace.delete(traceId);
    }
    this.stats.pruned += removed;
    return removed;
  }

  _removeIndex(record) {
    if (!record?.traceId) return;
    const list = this.byTrace.get(record.traceId);
    if (!list) return;
    const index = list.indexOf(record);
    if (index !== -1) list.splice(index, 1);
    if (!list.length) this.byTrace.delete(record.traceId);
  }

  snapshot() { return Object.freeze({ maxSpans: this.maxSpans, length: this.length, traces: this.byTrace.size, maxTraceAgeMs: this.maxTraceAgeMs, stats: Object.freeze({ ...this.stats }) }); }
}

export default InMemorySpanStore;
