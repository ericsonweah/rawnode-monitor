'use strict';

import { EventEmitter } from 'node:events';
import { defaultSerializer } from '../serialization/SafeSerializer.js';

export class BaseTransport extends EventEmitter {
  constructor(options = {}) {
    super();
    this.rawnodeEnterpriseTransport = true;
    this.acceptsRecords = true;
    this.name = options.name || this.constructor.name;
    this.serializer = options.serializer || defaultSerializer;
    this.silent = options.silent === true;
    this.closed = false;
    this.createdAt = Date.now();
    // Error events are observable but never allowed to crash an application merely
    // because no listener has been installed.
    this.on('error', () => {});
    this.stats = {
      writes: 0,
      bytes: 0,
      errors: 0,
      flushes: 0,
      closes: 0,
      lastError: null,
      lastWriteAt: null,
    };
  }

  async writeRecord(_record) {
    throw new Error(`${this.constructor.name}.writeRecord(record) must be implemented.`);
  }

  async writeBatch(records) {
    for (const record of records) await this.writeRecord(record);
  }

  async flush() {
    this.stats.flushes++;
  }

  async reopen() {
    return false;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.stats.closes++;
    this.removeAllListeners();
  }

  health() {
    return {
      name: this.name,
      status: this.closed ? 'closed' : (this.stats.lastError ? 'degraded' : 'healthy'),
      closed: this.closed,
      uptimeMs: Date.now() - this.createdAt,
      stats: { ...this.stats },
    };
  }

  _written(bytes = 0) {
    this.stats.writes++;
    this.stats.bytes += Number(bytes) || 0;
    this.stats.lastWriteAt = new Date().toISOString();
  }

  _failed(error) {
    this.stats.errors++;
    this.stats.lastError = {
      message: error?.message || String(error),
      timestamp: new Date().toISOString(),
    };
    try { this.emit('error', error); } catch {}
  }
}

export default BaseTransport;
