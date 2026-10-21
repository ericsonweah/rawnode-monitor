'use strict';

import { cloneSafe, deepFreeze } from '../support/safe.js';

export class EventFlightRecorder {
  constructor(options = {}) {
    this.enabled = options.enabled === true;
    this.limit = Math.max(0, Number(options.limit || options.maxRecords) || 0);
    this.maxBytes = Math.max(0, Number(options.maxBytes) || 8 * 1024 * 1024);
    this.sampleRate = Math.max(0, Math.min(1, Number(options.sampleRate ?? 1)));
    this.redactKeys = options.redactKeys || [];
    this.records = new Array(this.limit || 1);
    this.cursor = 0;
    this.size = 0;
    this.bytes = 0;
    this.sequence = 0;
    this.stats = { recorded: 0, sampledOut: 0, evicted: 0, oversized: 0 };
  }

  record(type, input = {}) {
    if (!this.enabled || !this.limit) return null;
    if (this.sampleRate < 1 && Math.random() > this.sampleRate && input.force !== true) { this.stats.sampledOut++; return null; }
    const value = cloneSafe({ id: ++this.sequence, type: String(type), at: Date.now(), ...input }, { maxDepth: 12, maxKeys: 2_048, maxArrayItems: 256, maxStringBytes: 8_192, redactKeys: this.redactKeys });
    const bytes = estimate(value);
    if (this.maxBytes && bytes > this.maxBytes) { this.stats.oversized++; return null; }
    while (this.size && this.maxBytes && this.bytes + bytes > this.maxBytes) this._evictOldest();
    if (this.size === this.limit) this._evictAt(this.cursor);
    this.records[this.cursor] = { value, bytes };
    this.cursor = (this.cursor + 1) % this.limit;
    this.size = Math.min(this.limit, this.size + 1);
    this.bytes += bytes;
    this.stats.recorded++;
    return value;
  }

  _evictOldest() { if (!this.size) return; const index = this.size === this.limit ? this.cursor : 0; this._evictAt(index); if (this.size < this.limit) { for (let cursor = index; cursor < this.size; cursor++) this.records[cursor] = this.records[cursor + 1]; this.records[this.size] = undefined; this.cursor = this.size % this.limit; } }
  _evictAt(index) { const record = this.records[index]; if (record) this.bytes = Math.max(0, this.bytes - record.bytes); this.records[index] = undefined; this.size = Math.max(0, this.size - 1); this.stats.evicted++; }
  list(options = {}) {
    const output = [];
    const start = this.size === this.limit ? this.cursor : 0;
    for (let offset = 0; offset < this.size; offset++) { const record = this.records[(start + offset) % this.limit]; if (record?.value) output.push(record.value); }
    let filtered = output;
    if (options.type) filtered = filtered.filter((record) => record.type === options.type);
    if (options.eventName) filtered = filtered.filter((record) => record.eventName === options.eventName);
    if (options.correlationId) filtered = filtered.filter((record) => record.correlationId === options.correlationId);
    if (options.since) filtered = filtered.filter((record) => record.at >= Number(options.since));
    if (options.limit) filtered = filtered.slice(-Math.max(1, Number(options.limit)));
    return deepFreeze(filtered.slice());
  }
  clear() { this.records.fill(undefined); this.cursor = 0; this.size = 0; this.bytes = 0; }
  snapshot() { return deepFreeze({ enabled: this.enabled, limit: this.limit, size: this.size, bytes: this.bytes, maxBytes: this.maxBytes, stats: { ...this.stats } }); }
}
function estimate(value) { try { return typeof TextEncoder === 'function' ? new TextEncoder().encode(JSON.stringify(value)).byteLength : JSON.stringify(value).length * 2; } catch { return 0; } }
export default EventFlightRecorder;
