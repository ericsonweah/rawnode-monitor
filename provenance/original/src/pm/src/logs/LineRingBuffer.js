'use strict';

export class LineRingBuffer {
  constructor(options = {}) {
    this.maxBytes = Math.max(64 * 1024, Number(options.maxBytes) || 2 * 1024 * 1024);
    this.maxEntries = Math.max(100, Number(options.maxEntries) || 20_000);
    this.entries = [];
    this.bytes = 0;
  }

  push(entry) {
    const value = { ...entry, line: String(entry.line ?? '') };
    const size = Buffer.byteLength(value.line) + 128;
    value._bytes = size;
    this.entries.push(value);
    this.bytes += size;
    while (this.entries.length > this.maxEntries || this.bytes > this.maxBytes) {
      const removed = this.entries.shift();
      this.bytes -= removed?._bytes || 0;
    }
  }

  query(options = {}) {
    const lines = Math.max(1, Number(options.lines) || 100);
    const stream = options.stream || null;
    let values = stream ? this.entries.filter((entry) => entry.stream === stream) : this.entries;
    values = values.slice(-lines);
    return values.map(({ _bytes, ...entry }) => entry);
  }
}

export default LineRingBuffer;
