'use strict';

import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import { randomId } from '../support.js';

const EMPTY = Object.freeze(Object.create(null));

export class MonitorContextManager {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.storage = options.storage || new AsyncLocalStorage();
    this.base = Object.freeze({ ...(options.base || {}) });
  }

  active() { return this.enabled ? (this.storage.getStore() || this.base || EMPTY) : this.base || EMPTY; }

  merge(values = {}) {
    const output = Object.create(null);
    Object.assign(output, this.base, this.active(), values || {});
    for (const key of Object.keys(output)) if (output[key] === undefined || output[key] === null || output[key] === '') delete output[key];
    return Object.freeze(output);
  }

  run(context, callback, ...args) {
    if (typeof callback !== 'function') throw new TypeError('MonitorContextManager.run() requires a callback.');
    if (!this.enabled) return callback(...args);
    return this.storage.run(this.merge(context), callback, ...args);
  }

  enter(context) { if (this.enabled) this.storage.enterWith(this.merge(context)); return this.active(); }

  bind(callback, context = this.active()) {
    if (typeof callback !== 'function') throw new TypeError('MonitorContextManager.bind() requires a callback.');
    const resource = new AsyncResource('RawNodeMonitorContext');
    const manager = this;
    return function boundMonitorContext(...args) {
      return manager.run(context, () => resource.runInAsyncScope(callback, this, ...args));
    };
  }

  createRequestContext(req = {}, extra = {}) {
    const headers = req.headers || {};
    const user = req.user || req.auth || null;
    return this.merge({
      requestId: req.requestId || req.id || headers['x-request-id'] || randomId('req'),
      correlationId: req.correlationId || headers['x-correlation-id'] || null,
      traceId: req.traceId || headers['x-trace-id'] || null,
      spanId: req.spanId || headers['x-span-id'] || null,
      tenantId: req.tenantId || req.tenant?.id || headers['x-tenant-id'] || null,
      userId: user?.id || user?._id || user?.sub || null,
      method: req.method || null,
      path: (typeof req.path === 'function' ? req.path() : req.path) || req.url || null,
      route: req.route?.name || req.route?.path || req.routeName || null,
      protocol: req.protocol || (req.socket?.encrypted ? 'https' : 'http'),
      remoteAddress: req.ip || req.socket?.remoteAddress || null,
      ...extra,
    });
  }

  createJobContext(job = {}, extra = {}) {
    return this.merge({
      jobId: job.id || job.jobId || randomId('job'),
      queue: job.queue || job.queueName || null,
      attempt: job.attempt || job.attempts || null,
      maxAttempts: job.maxAttempts || job.tries || null,
      tenantId: job.tenantId || job.tenant_id || null,
      traceId: job.traceId || job.trace_id || null,
      correlationId: job.correlationId || job.correlation_id || null,
      ...extra,
    });
  }

  disable() { this.enabled = false; this.storage.disable(); }
}

export const globalMonitorContext = new MonitorContextManager();
export default MonitorContextManager;
