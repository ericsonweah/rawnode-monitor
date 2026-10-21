'use strict';

import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import BoundedSignalQueue from './BoundedSignalQueue.js';
import { bytesOf, cooperativeYield, errorRecord, retry, withTimeout } from '../support.js';

export class SignalPipeline extends EventEmitter {
  constructor(options = {}) {
    super();
    this.queue = options.queue || new BoundedSignalQueue(options);
    this.batchSize = Math.max(1, Number(options.batchSize) || 512);
    this.flushIntervalMs = Math.max(1, Number(options.flushIntervalMs) || 500);
    this.budgetMs = Math.max(0.25, Number(options.budgetMs) || 8);
    this.maxInFlightBatches = Math.max(1, Number(options.maxInFlightBatches) || 2);
    this.deliveryAttempts = Math.max(1, Number(options.deliveryAttempts) || 3);
    this.retryBaseMs = Math.max(0, Number(options.retryBaseMs) || 50);
    this.retryMaxMs = Math.max(this.retryBaseMs, Number(options.retryMaxMs) || 2_000);
    this.failureHistoryLimit = Math.max(1, Number(options.failureHistoryLimit) || 256);
    this.errorPolicy = options.errorPolicy || 'isolate';
    this.sinks = new Map();
    this.timer = null;
    this.scheduled = false;
    this.running = false;
    this.closing = false;
    this.closed = false;
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
      maxAttempts: Math.max(1, Number(options.maxAttempts) || this.deliveryAttempts),
      retryBaseMs: Math.max(0, Number(options.retryBaseMs) || this.retryBaseMs),
      retryMaxMs: Math.max(0, Number(options.retryMaxMs) || this.retryMaxMs),
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
      this.scheduled = false;
      void this.drain().catch((error) => this._pipelineError(error));
    });
    handle.unref?.();
    return true;
  }

  async drain(options = {}) {
    if (!this.running || this.closed) return this.snapshot();
    if (this.inFlight.size >= this.maxInFlightBatches) return this.snapshot();
    const started = performance.now();
    do {
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
    const sink = record.sink;
    if (typeof sink.export === 'function') return await sink.export(selected, options);
    if (typeof sink.writeMany === 'function') return await sink.writeMany(selected, options);
    if (typeof sink.write === 'function') {
      for (const item of selected) await sink.write(item, options);
      return { written: selected.length };
    }
    if (typeof sink === 'function') return await sink(selected, options);
    throw new TypeError(`Monitor pipeline sink '${record.name}' has no export/write method.`);
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
    this.stats.flushes++;
    if (!this.running && !this.closed) {
      if (this.closing) this.running = true;
      else this.start();
    }
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 10_000);
    const deliveryFailures = [];
    await withTimeout(async () => {
      while (this.queue.length || this.inFlight.size) {
        if (this.queue.length) {
          try { await this.drain({ once: false, signal: options.signal }); }
          catch (error) { deliveryFailures.push(error); }
        }
        if (this.inFlight.size) {
          const settled = await Promise.allSettled([...this.inFlight]);
          for (const result of settled) if (result.status === 'rejected') deliveryFailures.push(result.reason);
        }
      }
      for (const record of this.sinks.values()) {
        try { await record.sink?.flush?.(options); }
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
    if (this.closed) return this.snapshot();
    this.closing = true;
    clearInterval(this.timer);
    this.timer = null;
    try { await this.flush(options); }
    catch (error) { if (options.throwOnError) throw error; }
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.closed = true;
    this.queue.close();
    const failures = [];
    for (const record of Array.from(this.sinks.values()).reverse()) {
      try { await record.sink?.close?.(options); }
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
      }))),
      failures: Object.freeze([...this.failureHistory]),
      stats: Object.freeze({ ...this.stats }),
    });
  }
}

export default SignalPipeline;
