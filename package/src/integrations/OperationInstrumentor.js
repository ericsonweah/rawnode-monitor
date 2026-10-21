'use strict';

import { SpanKind, SpanStatus } from '../constants.js';

/**
 * Explicit opt-in proxy for async clients (RawMongo, Redis, mail, payment, etc.).
 * The original object is never mutated. Methods not selected are passed through.
 */
export class OperationInstrumentor {
  constructor(monitor, options = {}) {
    this.monitor = monitor;
    this.name = options.name || 'operation';
    this.kind = options.kind || SpanKind.CLIENT;
    this.methods = options.methods ? new Set(options.methods) : null;
    this.exclude = new Set(options.exclude || []);
    this.attributeFactory = options.attributes || null;
    this.resultAttributes = options.resultAttributes || null;
    this.captureArguments = options.captureArguments === true;
    this.captureResults = options.captureResults === true;
    this.cache = new WeakMap();
    this.calls = monitor.metrics.counter(`${this.name}_operations_total`);
    this.duration = monitor.metrics.histogram(`${this.name}_operation_duration_seconds`, { unit: 'seconds' });
  }

  wrap(target) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) return target;
    const existing = this.cache.get(target); if (existing) return existing;
    const instrumentor = this;
    const proxy = new Proxy(target, {
      get(object, property, receiver) {
        const value = Reflect.get(object, property, receiver);
        if (typeof value !== 'function' || typeof property !== 'string' || !instrumentor._selected(property)) return value;
        return function monitoredOperation(...args) { return instrumentor.invoke(object, property, value, args, this); };
      },
    });
    this.cache.set(target, proxy); return proxy;
  }

  _selected(method) { return !this.exclude.has(method) && (!this.methods || this.methods.has(method)); }

  invoke(target, method, operation, args, receiver = target) {
    const labels = { operation: method };
    return this.monitor.tracer.trace(`${this.name}.${method}`, {
      kind: this.kind,
      attributes: {
        'rawnode.component': this.name,
        'rawnode.operation': method,
        ...(typeof this.attributeFactory === 'function' ? this.attributeFactory({ target, method, args }) : this.attributeFactory || {}),
        ...(this.captureArguments ? { 'rawnode.arguments': this.monitor.serializer.sanitize(args) } : {}),
      },
    }, async (span) => {
      const started = process.hrtime.bigint();
      try {
        const result = await Reflect.apply(operation, receiver, args);
        this.calls.inc({ ...labels, outcome: 'success' });
        if (this.captureResults) span.setAttribute('rawnode.result', this.monitor.serializer.sanitize(result));
        if (typeof this.resultAttributes === 'function') span.setAttributes(this.resultAttributes(result) || {});
        span.setStatus(SpanStatus.OK);
        return result;
      } catch (error) {
        this.calls.inc({ ...labels, outcome: 'error' });
        span.recordException(error).setStatus(SpanStatus.ERROR, error?.message);
        throw error;
      } finally { this.duration.record(Number(process.hrtime.bigint() - started) / 1e9, labels); }
    });
  }
}

export function instrumentOperations(target, monitor, options = {}) { return new OperationInstrumentor(monitor, options).wrap(target); }
export default OperationInstrumentor;
