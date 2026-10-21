'use strict';

import BaseTransport from './BaseTransport.js';

export class MemoryTransport extends BaseTransport {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'memory' });
    this.maxItems = Math.max(1, Number(options.maxItems ?? options.limit) || 1000);
    this.limit = this.maxItems;
    this.records = [];
    this.clone = options.clone !== false;
    if (options.serializer) this.serializer = options.serializer;
  }

  async writeRecord(record) {
    if (this.closed || this.silent) return;
    const value = this.clone && this.serializer ? this.serializer.clone(record) : record;
    if (this.records.length >= this.maxItems) this.records.shift();
    this.records.push(value);
    this._written(this.serializer ? Buffer.byteLength(this.serializer.stringify(value)) : 0);
    this.emit('written', value);
  }

  all() { return [...this.records]; }
  latest(count = 1) { return this.records.slice(-Math.max(0, Number(count) || 0)); }
  clear() { const count = this.records.length; this.records.length = 0; return count; }
  find(predicate) { return this.records.find(predicate); }
  filter(predicate) { return this.records.filter(predicate); }
  atLevel(level) { return this.records.filter((record) => record.level === level); }
  snapshot() { return { name: this.name, stored: this.records.length, limit: this.maxItems, closed: this.closed }; }
}

export default MemoryTransport;
