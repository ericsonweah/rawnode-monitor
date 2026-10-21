'use strict';

import { bytesOf, deepFreeze, safeGet } from '../support.js';

export class MemoryTelemetryStore {
  constructor(options = {}) {
    this.maxItems = Math.max(1, Number(options.maxItems || options.maxMemoryItems) || 50_000);
    this.maxBytes = Math.max(1_024, Number(options.maxBytes || options.maxMemoryBytes) || 128 * 1024 * 1024);
    this.items = new Array(this.maxItems);
    this.sizes = new Array(this.maxItems).fill(0);
    this.cursor = 0;
    this.length = 0;
    this.bytes = 0;
    this.closed = false;
    this.fallbackFrom = options.fallbackFrom || null;
    this.fallbackReason = options.fallbackReason || null;
    this.stats = { written: 0, evicted: 0, queried: 0, pruned: 0, oversized: 0 };
  }

  async write(signal) { return this._write(signal); }
  async writeMany(signals = []) { let written = 0; for (const signal of signals) if (this._write(signal)) written++; return { written }; }

  _write(signal) {
    if (this.closed) return false;
    const size = bytesOf(signal, this.maxBytes + 1);
    if (size > this.maxBytes) { this.stats.oversized++; return false; }
    while (this.length && (this.length >= this.maxItems || this.bytes + size > this.maxBytes)) this._evict();
    if (this.length === this.maxItems) this._evict();
    this.items[this.cursor] = signal;
    this.sizes[this.cursor] = size;
    this.cursor = (this.cursor + 1) % this.maxItems;
    this.length++;
    this.bytes += size;
    this.stats.written++;
    return true;
  }

  _evict() {
    if (!this.length) return null;
    const index = (this.cursor - this.length + this.maxItems) % this.maxItems;
    const value = this.items[index];
    this.bytes -= this.sizes[index] || 0;
    this.items[index] = undefined;
    this.sizes[index] = 0;
    this.length--;
    this.stats.evicted++;
    return value;
  }

  all() {
    const output = [];
    const start = (this.cursor - this.length + this.maxItems) % this.maxItems;
    for (let index = 0; index < this.length; index++) {
      const value = this.items[(start + index) % this.maxItems];
      if (value) output.push(value);
    }
    return output;
  }

  async query(options = {}) {
    this.stats.queried++;
    let rows = this.all();
    if (options.kind) rows = rows.filter((row) => row.kind === String(options.kind));
    if (options.traceId) rows = rows.filter((row) => row.traceId === String(options.traceId) || row.payload?.traceId === String(options.traceId));
    if (options.tenantId) rows = rows.filter((row) => row.tenantId === String(options.tenantId));
    if (options.since) rows = rows.filter((row) => Number(row.timestamp || 0) >= Number(options.since));
    if (options.until) rows = rows.filter((row) => Number(row.timestamp || 0) <= Number(options.until));
    if (options.where && typeof options.where === 'object') rows = rows.filter((row) => Object.entries(options.where).every(([path, value]) => safeGet(row, path) === value));
    if (typeof options.filter === 'function') rows = rows.filter(options.filter);
    const order = options.order === 'asc' ? 1 : -1;
    rows.sort((a, b) => order * (Number(a.timestamp || 0) - Number(b.timestamp || 0)));
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Number(options.limit) || 100);
    return deepFreeze({ items: rows.slice(offset, offset + limit), total: rows.length, offset, limit });
  }

  async prune(options = {}) {
    const before = Number(options.before || Date.now() - Number(options.retentionMs || 0));
    if (!Number.isFinite(before)) return 0;
    const retained = this.all().filter((row) => Number(row.timestamp || 0) >= before);
    const removed = this.length - retained.length;
    this.items.fill(undefined); this.sizes.fill(0); this.cursor = 0; this.length = 0; this.bytes = 0;
    for (const row of retained) this._write(row);
    this.stats.pruned += removed;
    return removed;
  }

  async flush() { return this.snapshot(); }
  async close() { this.closed = true; return this.snapshot(); }
  snapshot() { return Object.freeze({ driver: 'memory', fallbackFrom: this.fallbackFrom, fallbackReason: this.fallbackReason, closed: this.closed, length: this.length, bytes: this.bytes, maxItems: this.maxItems, maxBytes: this.maxBytes, stats: Object.freeze({ ...this.stats }) }); }
}

export default MemoryTelemetryStore;
