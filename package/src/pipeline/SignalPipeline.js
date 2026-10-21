'use strict';

import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import BoundedSignalQueue from './BoundedSignalQueue.js';
import { boundedInteger, boundedNumber, bytesOf, cooperativeYield, errorRecord, retry, withTimeout } from '../support.js';

export class SignalPipeline extends EventEmitter {
  constructor(options = {}) {
    super();
    this.queue = options.queue || new BoundedSignalQueue(options);
    this.batchSize = boundedInteger(options.batchSize, 512, 1, 100_000);
    this.flushIntervalMs = boundedInteger(options.flushIntervalMs, 500, 1, 3_600_000);
    this.budgetMs = boundedNumber(options.budgetMs, 8, 0.25, 1_000);
    this.maxInFlightBatches = boundedInteger(options.maxInFlightBatches, 2, 1, 1_024);
    this.deliveryAttempts = boundedInteger(options.deliveryAttempts, 3, 1, 100);
    this.retryBaseMs = boundedInteger(options.retryBaseMs, 50, 0, 60_000);
    this.retryMaxMs = boundedInteger(options.retryMaxMs, Math.max(this.retryBaseMs, 2_000), this.retryBaseMs, 300_000);
    this.sinkTimeoutMs = boundedInteger(options.sinkTimeoutMs, 5_000, 1, 300_000);
    this.failureHistoryLimit = boundedInteger(options.failureHistoryLimit, 256, 1, 100_000);
    this.errorPolicy = options.errorPolicy || 'isolate';
    this.sinks = new Map();
    this.timer = null;
    this.scheduledHandle = null;
    this.scheduled = false;
    this.running = false;
    this.closing = false;
    this.closed = false;
    this.closePromise = null;
    this.controller = new AbortController();
    this.inFlight = new Set();
    this.failureHistory = [];
    this.stats = {
      batches: 0,
      signals: 0,
      sinkWrites: 0,
      sinkErrors: 0,
      sinkRetries: 0,
      failedBatches: 0,
      failedSignals: 0,
      dropped: 0,
      flushes: 0,
      maxBatchMs: 0,
    };
  }

  addSink(name, sink, options = {}) {
    if (!name || !sink) throw new TypeError('SignalPipeline.addSink(name, sink) requires both values.');
    const record = {
      name: String(name),
      sink,
      required: options.required === true,
      signals: options.signals ? new Set(options.signals) : null,
      priority: Number(options.priority || 0),
      maxAttempts: boundedInteger(options.maxAttempts, this.deliveryAttempts, 1, 100),
      retryBaseMs: boundedInteger(options.retryBaseMs, this.retryBaseMs, 0, 60_000),
      retryMaxMs: boundedInteger(options.retryMaxMs, this.retryMaxMs, 0, 300_000),
      timeoutMs: boundedInteger(options.timeoutMs, this.sinkTimeoutMs, 1, 300_000),
      pendingWrites: new Set(),
      pendingLifecycle: new Map(),
      retryWhen: typeof options.retryWhen === 'function' ? options.retryWhen : null,
    };
    this.sinks.set(record.name, record);
    return this;
  }

  removeSink(name) { return this.sinks.delete(String(name)); }

  start() {
    if (this.running || this.closed || this.closing) return this;
    this.running = true;
    this.timer = setInterval(() => this.schedule(), this.flushIntervalMs);
    this.timer.unref?.();
    return this;
  }

  admit(envelope, options = {}) {
    if (this.closing || this.closed) return Object.freeze({ accepted: false, reason: this.closed ? 'closed' : 'closing' });
    const result = this.queue.tryPush(envelope, this._queueOptions(envelope, options));
    this._afterAdmission(envelope, result);
    return result;
  }

  async admitAsync(envelope, options = {}) {
    if (this.closing || this.closed) return Object.freeze({ accepted: false, reason: this.closed ? 'closed' : 'closing' });
    const result = await this.queue.push(envelope, this._queueOptions(envelope, options));
    this._afterAdmission(envelope, result);
    return result;
  }

  _queueOptions(envelope, options) {
    return {
      ...options,
      bytes: options.bytes ?? bytesOf(envelope, this.queue.maxSignalBytes + 1),
      onDrop: (value, reason) => {
        this.stats.dropped++;
        this.emit('dropped', value, reason);
        options.onDrop?.(value, reason);
      },
    };
  }

  _afterAdmission(envelope, result) {
    if (!result.accepted) return;
    this.emit('admitted', envelope, result);
    if (this.queue.length >= this.batchSize) this.schedule();
  }

  schedule() {
    if (!this.running || this.closed || this.scheduled || !this.queue.length) return false;
    this.scheduled = true;
    const handle = setImmediate(() => {
      this.scheduledHandle = null;
      this.scheduled = false;
      void this.drain().catch((error) => this._pipelineError(error));
    });
    this.scheduledHandle = handle;
    handle.unref?.();
    return true;
  }

  async drain(options = {}) {
    if (!this.running || this.closed) return this.snapshot();
    const signal = options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal;
    options = { ...options, signal };
    signal.throwIfAborted();
    if (this.inFlight.size >= this.maxInFlightBatches) return this.snapshot();
    const started = performance.now();
    do {
      signal.throwIfAborted();
      if (!this.running || this.closed) break;
      const batch = this.queue.shiftMany(this.batchSize);
      if (!batch.length) break;
      const task = this._deliver(batch, options);
      this.inFlight.add(task);
      task.finally(() => { this.inFlight.delete(task); }).catch(() => {});
      if (this.inFlight.size >= this.maxInFlightBatches) await Promise.race(this.inFlight);
      if (performance.now() - started >= this.budgetMs) await cooperativeYield(options.signal);
    } while (this.queue.length && !options.once);
    if (this.queue.length && !this.closing) this.schedule();
    return this.snapshot();
  }

  async _deliver(batch, options = {}) {
    const started = performance.now();
    this.stats.batches++;
    this.stats.signals += batch.length;
    const sinks = Array.from(this.sinks.values()).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    for (const record of sinks) {
      options.signal?.throwIfAborted();
      const selected = record.signals ? batch.filter((entry) => record.signals.has(entry.kind)) : batch;
      if (!selected.length) continue;
      try {
        await retry(async (attempt) => {
          if (attempt > 1) this.stats.sinkRetries++;
          await this._writeSink(record, selected, options);
        }, {
          attempts: record.maxAttempts,
          baseMs: record.retryBaseMs,
          maxMs: Math.max(record.retryBaseMs, record.retryMaxMs),
          signal: options.signal,
          retryWhen: (error, attempt) => record.retryWhen ? record.retryWhen(error, attempt, record) : error?.retryable !== false,
        });
        this.stats.sinkWrites += selected.length;
      } catch (error) {
        this.stats.sinkErrors++;
        this.emit('sinkError', error, record.name, selected);
        if (record.required || this.errorPolicy === 'propagate') {
          this._recordFailedBatch(selected, error, record);
          throw error;
        }
      }
    }
    this.stats.maxBatchMs = Math.max(this.stats.maxBatchMs, performance.now() - started);
    this.emit('batch', batch.length);
  }

  async _writeSink(record, selected, options) {
    if (record.pendingWrites.size >= this.maxInFlightBatches) {
      throw Object.assign(new Error(`Monitor sink '${record.name}' still has pending delivery operations.`), { code: 'MONITOR_SINK_BUSY', retryable: false });
    }
    try {
      const result = await withTimeout((signal) => {
        const operation = Promise.resolve().then(() => this._invokeSink(record, selected, { ...options, signal }));
        const tracked = operation.finally(() => record.pendingWrites.delete(tracked));
        record.pendingWrites.add(tracked);
        return tracked;
      }, record.timeoutMs, { signal: options.signal, message: `Monitor sink '${record.name}' delivery exceeded ${record.timeoutMs}ms.` });
      if (result === false || (result && typeof result === 'object' && 'written' in result && (!Number.isFinite(result.written) || result.written < selected.length))) {
        throw Object.assign(new Error(`Monitor sink '${record.name}' did not accept the complete batch.`), { code: 'MONITOR_SINK_INCOMPLETE_WRITE', retryable: false });
      }
      return result;
    } catch (error) {
      // A timed-out delivery may have committed remotely. Do not duplicate it
      // through automatic retry while its result is unknown.
      if (error?.code === 'MONITOR_TIMEOUT') error.retryable = false;
      throw error;
    }
  }

  async _invokeSink(record, selected, options) {
    options.signal?.throwIfAborted();
    const sink = record.sink;
    if (typeof sink.export === 'function') return await sink.export(selected, options);
    if (typeof sink.writeMany === 'function') return await sink.writeMany(selected, options);
    if (typeof sink.write === 'function') {
      for (const item of selected) {
        options.signal?.throwIfAborted();
        const result = await sink.write(item, options);
        if (result === false || (result && typeof result === 'object' && 'written' in result && (!Number.isFinite(result.written) || result.written < 1))) {
          throw Object.assign(new Error(`Monitor sink '${record.name}' rejected a telemetry signal.`), { code: 'MONITOR_SINK_INCOMPLETE_WRITE', retryable: false });
        }
      }
      return { written: selected.length };
    }
    if (typeof sink === 'function') return await sink(selected, options);
    throw new TypeError(`Monitor pipeline sink '${record.name}' has no export/write method.`);
  }

  async _sinkLifecycle(record, method, options, timeoutMs = record.timeoutMs) {
    if (typeof record.sink?.[method] !== 'function') return;
    if (record.pendingLifecycle.has(method)) {
      throw Object.assign(new Error(`Monitor sink '${record.name}' still has a pending ${method} operation.`), { code: 'MONITOR_SINK_BUSY', retryable: false });
    }
    return withTimeout((signal) => {
      const operation = Promise.resolve().then(() => { signal.throwIfAborted(); return record.sink[method]({ ...options, signal }); });
      const tracked = operation.finally(() => { if (record.pendingLifecycle.get(method) === tracked) record.pendingLifecycle.delete(method); });
      record.pendingLifecycle.set(method, tracked);
      return tracked;
    }, timeoutMs, { signal: options.signal, message: `Monitor sink '${record.name}' ${method} exceeded ${timeoutMs}ms.` });
  }

  _recordFailedBatch(batch, error, record) {
    this.stats.failedBatches++;
    this.stats.failedSignals += batch.length;
    this.failureHistory.push(Object.freeze({
      at: Date.now(),
      sink: record.name,
      required: record.required,
      count: batch.length,
      signals: Object.freeze(batch.slice(0, 100).map((signal) => Object.freeze({
        id: signal?.id || null,
        kind: signal?.kind || null,
        traceId: signal?.traceId || signal?.context?.traceId || null,
        timestamp: signal?.timestamp || null,
      }))),
      truncated: batch.length > 100,
      error: errorRecord(error, { stack: false }),
    }));
    if (this.failureHistory.length > this.failureHistoryLimit) this.failureHistory.splice(0, this.failureHistory.length - this.failureHistoryLimit);
    this.emit('failedBatch', this.failureHistory.at(-1));
  }

  async flush(options = {}) {
    if (this.closed) return this.snapshot();
    this.stats.flushes++;
    if (!this.running && !this.closed) {
      if (this.closing) this.running = true;
      else this.start();
    }
    const timeoutMs = boundedInteger(options.timeoutMs, 10_000, 1, 300_000);
    const deliveryFailures = [];
    await withTimeout(async (signal) => {
      while (this.queue.length || this.inFlight.size) {
        signal.throwIfAborted();
        if (this.queue.length) {
          try { await this.drain({ once: false, signal }); }
          catch (error) { deliveryFailures.push(error); }
        }
        if (this.inFlight.size) {
          const settled = await Promise.allSettled([...this.inFlight]);
          for (const result of settled) if (result.status === 'rejected') deliveryFailures.push(result.reason);
        }
      }
      for (const record of this.sinks.values()) {
        signal.throwIfAborted();
        try { await this._sinkLifecycle(record, 'flush', { ...options, signal }); }
        catch (error) {
          this.stats.sinkErrors++;
          this.emit('sinkError', error, record.name, []);
          if (record.required || this.errorPolicy === 'propagate') deliveryFailures.push(error);
        }
      }
    }, timeoutMs, { signal: options.signal, message: `Monitor pipeline flush exceeded ${timeoutMs}ms.` });
    if (deliveryFailures.length && (options.throwOnError === true || this.errorPolicy === 'propagate')) {
      const error = new AggregateError(deliveryFailures, 'Monitor pipeline flush completed with required delivery failures.');
      error.code = 'MONITOR_PIPELINE_FLUSH_FAILED';
      throw error;
    }
    return this.snapshot();
  }

  _pipelineError(error) {
    const record = errorRecord(error, { stack: true });
    if (this.listenerCount('error') > 0) this.emit('error', record);
    else this.emit('pipelineError', record);
  }

  async close(options = {}) {
    if (this.closePromise) return this.closePromise;
    if (this.closed) return this.snapshot();
    this.closePromise = this._close(options);
    return this.closePromise;
  }

  async _close(options = {}) {
    this.closing = true;
    const timeoutMs = boundedInteger(options.timeoutMs, 10_000, 1, 300_000);
    const deadline = Date.now() + timeoutMs;
    const failures = [];
    clearInterval(this.timer);
    this.timer = null;
    clearImmediate(this.scheduledHandle);
    this.scheduledHandle = null;
    this.scheduled = false;
    try { if (options.flush !== false) await this.flush({ ...options, timeoutMs }); }
    catch (error) { failures.push(error); }
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.closed = true;
    this.queue.close();
    this.queue.clear((value, reason) => { this.stats.dropped++; this.emit('dropped', value, reason); });
    this.controller.abort(Object.assign(new Error('Monitor pipeline closed.'), { code: 'MONITOR_PIPELINE_CLOSED' }));
    await Promise.allSettled([...this.inFlight]);
    for (const record of Array.from(this.sinks.values()).reverse()) {
      try { await this._sinkLifecycle(record, 'close', { ...options, signal: undefined }, Math.max(1, Math.min(record.timeoutMs, deadline - Date.now()))); }
      catch (error) {
        this.stats.sinkErrors++;
        if (record.required || options.throwOnError || this.errorPolicy === 'propagate') failures.push(error);
      }
    }
    this.closing = false;
    if (failures.length && options.throwOnError) {
      const error = new AggregateError(failures, 'Monitor pipeline close completed with required sink failures.');
      error.code = 'MONITOR_PIPELINE_CLOSE_FAILED';
      throw error;
    }
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      running: this.running,
      closing: this.closing,
      closed: this.closed,
      scheduled: this.scheduled,
      inFlight: this.inFlight.size,
      queue: this.queue.snapshot(),
      sinks: Object.freeze(Array.from(this.sinks.values(), (entry) => ({
        name: entry.name,
        required: entry.required,
        signals: entry.signals ? [...entry.signals] : null,
        maxAttempts: entry.maxAttempts,
        timeoutMs: entry.timeoutMs,
        pendingWrites: entry.pendingWrites.size,
        pendingLifecycle: Object.freeze([...entry.pendingLifecycle.keys()]),
      }))),
      failures: Object.freeze([...this.failureHistory]),
      stats: Object.freeze({ ...this.stats }),
    });
  }
}

export default SignalPipeline;
