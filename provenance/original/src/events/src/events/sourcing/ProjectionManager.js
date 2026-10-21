'use strict';

import { performance } from 'node:perf_hooks';
import { EventAdmissionError } from '../errors/EventError.js';

export class MemoryProjectionCheckpointStore {
  constructor() { this.values = new Map(); }
  async get(name) { return this.values.get(String(name)) || 0; }
  async set(name, position) { this.values.set(String(name), Math.max(0, Number(position) || 0)); return position; }
  async clear(name = null) { if (name == null) this.values.clear(); else this.values.delete(String(name)); }
  snapshot() { return Object.freeze(Object.fromEntries(this.values)); }
}

/** Projection runner with checkpoints, selective handlers and cooperative rebuilds. */
export class ProjectionManager {
  constructor(eventStore, options = {}) {
    if (!eventStore || typeof eventStore.readAll !== 'function') throw new TypeError('ProjectionManager requires an event store');
    this.eventStore = eventStore;
    this.checkpoints = options.checkpoints || new MemoryProjectionCheckpointStore();
    this.projections = new Map();
    this.maxProjections = Math.max(1, Number(options.maxProjections) || 1000);
    this.batchSize = Math.max(1, Number(options.batchSize) || 1000);
    this.budgetMs = Math.max(0, Number(options.budgetMs) || 5);
    this.stats = { registered: 0, processed: 0, rebuilds: 0, failures: 0 };
  }

  register(name, handlers, options = {}) {
    const key = String(name || '').trim();
    if (!key) throw new TypeError('Projection name is required');
    if (this.projections.has(key) && options.replace !== true) throw new EventAdmissionError(`Projection already exists: ${key}`, { code: 'EVENT_PROJECTION_DUPLICATE' });
    if (!this.projections.has(key) && this.projections.size >= this.maxProjections) throw new EventAdmissionError('Projection limit exceeded', { code: 'EVENT_PROJECTION_LIMIT' });
    const normalized = typeof handlers === 'function' ? { '*': handlers } : handlers;
    if (!normalized || typeof normalized !== 'object') throw new TypeError('Projection handlers must be a function or event-name map');
    for (const handler of Object.values(normalized)) if (typeof handler !== 'function') throw new TypeError('Projection handler must be a function');
    this.projections.set(key, Object.freeze({ name: key, handlers: { ...normalized }, reset: typeof options.reset === 'function' ? options.reset : null }));
    this.stats.registered++;
    return this;
  }

  unregister(name) { return this.projections.delete(String(name)); }

  async project(name, options = {}) {
    const projection = this.projections.get(String(name));
    if (!projection) throw new EventAdmissionError(`Projection not found: ${name}`, { code: 'EVENT_PROJECTION_UNKNOWN' });
    const fromPosition = options.fromPosition ?? (await this.checkpoints.get(projection.name)) + 1;
    const records = this.eventStore.readAll({ fromPosition, limit: options.limit || this.batchSize, tenantId: options.tenantId });
    for (const record of records) await this._apply(projection, record, options);
    return { name: projection.name, processed: records.length, position: records.at(-1)?.globalPosition || fromPosition - 1 };
  }

  async rebuild(name, options = {}) {
    const projection = this.projections.get(String(name));
    if (!projection) throw new EventAdmissionError(`Projection not found: ${name}`, { code: 'EVENT_PROJECTION_UNKNOWN' });
    await projection.reset?.({ name: projection.name });
    await this.checkpoints.clear(projection.name);
    this.stats.rebuilds++;
    let processed = 0;
    let sliceStarted = performance.now();
    for await (const record of this.eventStore.iterate({ fromPosition: 1, batchSize: options.batchSize || this.batchSize, tenantId: options.tenantId })) {
      await this._apply(projection, record, options);
      processed++;
      if (this.budgetMs > 0 && performance.now() - sliceStarted >= this.budgetMs) {
        await new Promise((resolve) => setImmediate(resolve));
        sliceStarted = performance.now();
      }
    }
    return { name: projection.name, processed, position: await this.checkpoints.get(projection.name) };
  }

  async _apply(projection, record, options) {
    const handler = projection.handlers[record.eventName] || projection.handlers['*'];
    try {
      if (handler) await handler(record.payload, record, options);
      await this.checkpoints.set(projection.name, record.globalPosition);
      this.stats.processed++;
    } catch (error) {
      this.stats.failures++;
      throw error;
    }
  }

  snapshot() { return Object.freeze({ projections: this.projections.size, checkpoints: this.checkpoints.snapshot?.() || null, stats: Object.freeze({ ...this.stats }) }); }
}

export default ProjectionManager;
