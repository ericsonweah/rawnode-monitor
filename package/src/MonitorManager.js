'use strict';

import MonitorRuntime from './MonitorRuntime.js';

/** Laravel-style manager facade around the default runtime and named runtimes. */
export class MonitorManager {
  constructor(options = {}) { this.app = options.app || null; this.options = options; this.runtimes = new Map(); this.defaultName = options.default || 'default'; }
  create(name = this.defaultName, options = {}) { const key = String(name); if (this.runtimes.has(key) && options.replace !== true) return this.runtimes.get(key); if (this.runtimes.has(key) && !this.runtimes.get(key).closed && options.runtime !== this.runtimes.get(key)) throw Object.assign(new Error('Close the existing runtime before replacing it.'), { code: 'MONITOR_RUNTIME_IN_USE' }); const runtime = options.runtime || new MonitorRuntime({ ...this.options, ...options, app: options.app || this.app }); this.runtimes.set(key, runtime); return runtime; }
  runtime(name = this.defaultName) { return this.runtimes.get(String(name)) || this.create(name); }
  default() { return this.runtime(this.defaultName); }
  register(name, runtime, options = {}) { return this.create(name, { ...options, runtime }); }
  names() { return Object.freeze([...this.runtimes.keys()]); }
  async start(options = {}) { await this.default().start(options); return this; }
  async close(options = {}) { await Promise.allSettled(Array.from(this.runtimes.values()).reverse().map((runtime) => runtime.close(options))); }
  health(options = {}) { return this.default().health(options); }
  metrics(options = {}) { return this.default().metricsSnapshot(options); }
  prometheus(options = {}) { return this.default().prometheus(options); }
  snapshot(options = {}) { return Object.freeze({ default: this.defaultName, runtimes: Object.fromEntries(Array.from(this.runtimes, ([name, runtime]) => [name, runtime.snapshot(options)])) }); }
  get tracer() { return this.default().tracer; }
  get alerts() { return this.default().alerts; }
  get incidents() { return this.default().incidents; }
  get slos() { return this.default().slos; }
  get query() { return this.default().query; }
}
export default MonitorManager;
