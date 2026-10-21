'use strict';

import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const EMPTY = Object.freeze(Object.create(null));

function copyContext(value) {
  const output = Object.create(null);
  if (!value || typeof value !== 'object') return output;
  for (const [key, item] of Object.entries(value)) {
    if (!BLOCKED_KEYS.has(key)) output[key] = item;
  }
  return output;
}

export class ContextManager {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.storage = new AsyncLocalStorage();
    this.freeze = options.freeze !== false;
  }

  get() {
    if (!this.enabled) return EMPTY;
    return this.storage.getStore() || EMPTY;
  }

  current() { return this.get(); }

  merge(context = {}) {
    const merged = { ...this.get(), ...copyContext(context) };
    return this.freeze ? Object.freeze(merged) : merged;
  }

  run(context, callback, ...args) {
    if (typeof callback !== 'function') throw new TypeError('ContextManager.run requires a callback.');
    if (!this.enabled) return callback(...args);
    return this.storage.run(this.merge(context), callback, ...args);
  }

  enterWith(context) {
    if (!this.enabled) return this.get();
    const merged = this.merge(context);
    this.storage.enterWith(merged);
    return merged;
  }

  bind(callback, context = this.get()) {
    if (typeof callback !== 'function') throw new TypeError('ContextManager.bind requires a callback.');
    const resource = new AsyncResource('RawNodeLoggerContext');
    const manager = this;
    return function boundLoggerContext(...args) {
      return manager.run(context, () => resource.runInAsyncScope(callback, this, ...args));
    };
  }

  createRequestContext(req = {}, extra = {}) {
    const headers = req.headers || {};
    const user = req.user || req.auth || null;
    return this.merge({
      requestId: req.id || req.requestId || headers['x-request-id'] || headers['x-correlation-id'] || null,
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
      jobId: job.id || job.jobId || null,
      queue: job.queue || job.queueName || null,
      attempt: job.attempt || job.attempts || null,
      maxAttempts: job.maxAttempts || job.tries || null,
      tenantId: job.tenantId || job.tenant_id || null,
      traceId: job.traceId || job.trace_id || null,
      correlationId: job.correlationId || job.correlation_id || null,
      ...extra,
    });
  }

  disable() {
    this.enabled = false;
    this.storage.disable();
  }
}

export const globalContextManager = new ContextManager();
export default ContextManager;
