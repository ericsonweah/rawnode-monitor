'use strict';
export class NoopTelemetryStore {
  async write() { return false; }
  async writeMany() { return { written: 0 }; }
  async query(options = {}) { return { items: [], total: 0, offset: Number(options.offset) || 0, limit: Number(options.limit) || 100 }; }
  async prune() { return 0; }
  async flush() { return this.snapshot(); }
  async close() { return this.snapshot(); }
  snapshot() { return Object.freeze({ driver: 'none' }); }
}
export default NoopTelemetryStore;
