'use strict';

import BaseTransport from '../transports/BaseTransport.js';

/**
 * Bounded in-memory transport for live inspection.
 * Records entering this transport are expected to have completed the canonical
 * redaction phase. A safe clone is retained so inspector consumers cannot mutate
 * the runtime's delivery record or its compatibility view.
 */
export class InspectorTransport extends BaseTransport {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'inspector' });
    this.channel = options.channel || 'inspector-log';
    this.maxBuffer = Math.max(1, Number(options.maxBuffer) || 500);
    this.maxBufferBytes = Math.max(1024, Number(options.maxBufferBytes) || 8 * 1024 * 1024);
    this.cloneRecords = options.cloneRecords !== false;
    this.buffer = [];
    this.bufferBytes = 0;
    this.filter = typeof options.filter === 'function' ? options.filter : null;
    this.stats.dropped = 0;
  }

  async writeRecord(record) {
    if (this.closed || this.silent) return;
    if (this.filter && !this.filter(record)) return;

    const stored = this.cloneRecords ? this.serializer.clone(record) : record;
    const bytes = Buffer.byteLength(this.serializer.stringify(stored));
    if (bytes > this.maxBufferBytes) {
      this.stats.dropped++;
      this.emit('dropped', { reason: 'record-too-large', bytes, maxBufferBytes: this.maxBufferBytes });
      return;
    }

    while (this.buffer.length && (this.buffer.length >= this.maxBuffer || this.bufferBytes + bytes > this.maxBufferBytes)) {
      const removed = this.buffer.shift();
      this.bufferBytes = Math.max(0, this.bufferBytes - removed.bytes);
      this.stats.dropped++;
    }

    this.buffer.push({ record: stored, bytes });
    this.bufferBytes += bytes;
    this._written(bytes);
    this.emit(this.channel, stored);
    this.emit('written', stored);
  }

  getBufferedLogs(options = {}) {
    let records = this.buffer.map((entry) => entry.record);
    if (options.level) records = records.filter((record) => record.level === options.level);
    if (options.channel) records = records.filter((record) => record.channel === options.channel);
    if (options.limit) records = records.slice(-Math.max(0, Number(options.limit) || 0));
    return options.clone === false ? [...records] : records.map((record) => this.serializer.clone(record));
  }

  clear() {
    const count = this.buffer.length;
    this.buffer.length = 0;
    this.bufferBytes = 0;
    return count;
  }

  health() {
    return {
      ...super.health(),
      bufferedItems: this.buffer.length,
      bufferedBytes: this.bufferBytes,
      maxBuffer: this.maxBuffer,
      maxBufferBytes: this.maxBufferBytes,
    };
  }

  async close(options = {}) {
    this.clear();
    await super.close(options);
  }
}

export default InspectorTransport;
