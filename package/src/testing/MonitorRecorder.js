'use strict';

import { createMonitor } from '../MonitorRuntime.js';
import MemoryTelemetryStore from '../storage/MemoryTelemetryStore.js';

/** Deterministic test harness that keeps every signal in bounded memory. */
export class MonitorRecorder {
  constructor(options = {}) {
    this.store = options.store || new MemoryTelemetryStore({
      maxItems: options.maxItems || 10_000,
      maxBytes: options.maxBytes || 32 * 1024 * 1024,
    });
    this.monitor = options.monitor || createMonitor({
      ...options,
      config: {
        profile: 'test',
        environment: 'testing',
        collectionIntervalMs: 3_600_000,
        resourceIntervalMs: 3_600_000,
        tracing: { sampleRate: 1, ...(options.config?.tracing || {}) },
        storage: { enabled: true, driver: 'memory', ...(options.config?.storage || {}) },
        studio: { enabled: false, ...(options.config?.studio || {}) },
        cluster: { enabled: false, ...(options.config?.cluster || {}) },
        ...options.config,
      },
      store: this.store,
    });
  }
  async start() { await this.monitor.start(); return this; }
  async flush() { await this.monitor.flush(); return this.all(); }
  async all(filter = {}) { return await this.store.query({ limit: 10_000, ...filter }); }
  async kind(kind) { return await this.all({ kind }); }
  async traces() { return this.monitor.tracer.query({ limit: 10_000 }); }
  async close() { await this.monitor.close(); }
  async [Symbol.asyncDispose]() { await this.close(); }
}

export class FakeMonitorClock {
  constructor(now = 1_700_000_000_000) { this.value = Number(now); }
  now = () => this.value;
  advance(ms) { this.value += Number(ms) || 0; return this.value; }
  set(value) { this.value = Number(value); return this.value; }
}

export default MonitorRecorder;
