'use strict';

import { randomUUID } from 'node:crypto';
import { estimateValueBytes } from '../support/size.js';
import { raceWithSignal } from '../support/async.js';
import {
  EventAdmissionError,
  EventClosedError,
  EventTimeoutError,
  EventAbortError,
} from '../errors/EventError.js';

const OVERFLOW_POLICIES = new Set(['reject', 'drop-oldest', 'drop-lowest']);

function abortReason(signal, fallback = 'aborted') {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new EventAbortError(reason == null ? fallback : String(reason));
}

class JobHandle {
  constructor(queue, job, promise) {
    this.queue = queue;
    this.id = job.id;
    this.name = job.name;
    this.promise = promise;
  }
  get status() { return this.queue.get(this.id)?.status || 'settled'; }
  cancel(reason = 'cancelled') { return this.queue.cancel(this.id, reason); }
  then(...args) { return this.promise.then(...args); }
  catch(...args) { return this.promise.catch(...args); }
  finally(...args) { return this.promise.finally(...args); }
}

/**
 * Bounded, priority-aware, cancellation-safe, cooperative in-process job queue.
 * It is intentionally not a durable queue; use EventOutbox/Redis Streams when
 * work must survive process loss.
 */
export class EventJobQueue {
  constructor(options = {}) {
    this.maxItems = Math.max(1, Number(options.maxItems) || 100_000);
    this.maxBytes = Math.max(1, Number(options.maxBytes) || 64 * 1024 * 1024);
    this.concurrency = Math.max(1, Number(options.concurrency) || 8);
    this.overflow = OVERFLOW_POLICIES.has(options.overflow) ? options.overflow : 'reject';
    this.defaultAttempts = Math.max(1, Number(options.attempts) || 3);
    this.retryBaseMs = Math.max(0, Number(options.retryBaseMs) || 100);
    this.retryMaxMs = Math.max(this.retryBaseMs, Number(options.retryMaxMs) || 30_000);
    this.shutdownTimeoutMs = Math.max(0, Number(options.shutdownTimeoutMs) || 30_000);
    this.forceOnShutdownTimeout = options.forceOnShutdownTimeout !== false;
    this.unrefTimers = options.unrefTimers === true;

    this.handlers = new Map();
    this.queue = [];
    this.jobs = new Map();
    this.running = new Map();
    this.bytes = 0;
    this.active = 0;
    this.sequence = 0;
    this.closed = false;
    this.accepting = true;
    this.pumpScheduled = false;
    this.wakeTimer = null;
    this.flushWaiters = new Set();
    this.lastShutdown = null;
    this.stats = {
      enqueued: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      cancelled: 0,
      rejected: 0,
      dropped: 0,
      timedOut: 0,
      highWaterItems: 0,
      highWaterBytes: 0,
    };
  }

  register(name, handler, options = {}) {
    const key = String(name || '').trim();
    if (!key || typeof handler !== 'function') throw new TypeError('Queue handler name and function are required');
    if (this.handlers.has(key) && options.replace !== true) {
      throw new EventAdmissionError(`Queue handler already registered: ${key}`, { code: 'EVENT_QUEUE_HANDLER_DUPLICATE' });
    }
    this.handlers.set(key, handler);
    return this;
  }

  unregister(name) { return this.handlers.delete(String(name)); }
  get(id) { return this.jobs.get(String(id)) || null; }

  enqueue(name, payload, options = {}) {
    if (!this.accepting || this.closed) {
      throw new EventClosedError('Event job queue is not accepting work', { code: 'EVENT_QUEUE_CLOSED' });
    }
    const key = String(name || '').trim();
    if (!this.handlers.has(key) && typeof options.handler !== 'function') {
      throw new EventAdmissionError(`Queue handler not found: ${key}`, { code: 'EVENT_QUEUE_HANDLER_MISSING' });
    }

    const bytes = estimateValueBytes(payload);
    const controller = new AbortController();
    const externalSignal = options.signal || null;
    const onExternalAbort = externalSignal
      ? () => controller.abort(abortReason(externalSignal))
      : null;
    if (externalSignal?.aborted) controller.abort(abortReason(externalSignal));
    else externalSignal?.addEventListener?.('abort', onExternalAbort, { once: true });

    const job = {
      id: String(options.id || randomUUID()),
      name: key,
      payload,
      handler: options.handler || null,
      priority: Number(options.priority) || 0,
      sequence: ++this.sequence,
      createdAt: Date.now(),
      availableAt: Number(options.availableAt) || (Date.now() + Math.max(0, Number(options.delayMs) || 0)),
      attempts: 0,
      maxAttempts: Math.max(1, Number(options.attempts) || this.defaultAttempts),
      timeoutMs: Math.max(0, Number(options.timeoutMs) || 0),
      bytes,
      status: 'queued',
      controller,
      signal: controller.signal,
      externalSignal,
      onExternalAbort,
      context: options.context || null,
      meta: options.meta || null,
      resolve: null,
      reject: null,
    };

    const promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
    promise.catch(() => {});
    try { this._admit(job); }
    catch (error) { this._cleanupSignal(job); throw error; }

    this.jobs.set(job.id, job);
    this.queue.push(job);
    this.bytes += bytes;
    this.stats.enqueued++;
    this.stats.highWaterItems = Math.max(this.stats.highWaterItems, this.jobs.size);
    this.stats.highWaterBytes = Math.max(this.stats.highWaterBytes, this.bytes);
    this._sort();
    this._schedulePump();
    return new JobHandle(this, job, promise);
  }

  dispatch(eventName, ...args) { return this.enqueue('dispatch', { eventName, args }); }

  _admit(job, options = {}) {
    if (job.bytes > this.maxBytes) {
      this.stats.rejected++;
      throw new EventAdmissionError('Event job exceeds queue byte limit', { code: 'EVENT_QUEUE_JOB_BYTES' });
    }

    const selfAlreadyCounted = options.retry === true ? 1 : 0;
    const overCapacity = () => (this.jobs.size - selfAlreadyCounted) >= this.maxItems || this.bytes + job.bytes > this.maxBytes;
    while (overCapacity()) {
      let dropped = null;
      if (this.overflow === 'drop-oldest') {
        let index = -1;
        let oldest = Infinity;
        for (let i = 0; i < this.queue.length; i++) {
          if (this.queue[i].sequence < oldest) { oldest = this.queue[i].sequence; index = i; }
        }
        if (index !== -1) [dropped] = this.queue.splice(index, 1);
      } else if (this.overflow === 'drop-lowest') {
        let index = -1;
        for (let i = 0; i < this.queue.length; i++) {
          if (index === -1 || this.queue[i].priority < this.queue[index].priority ||
              (this.queue[i].priority === this.queue[index].priority && this.queue[i].sequence < this.queue[index].sequence)) index = i;
        }
        if (index !== -1) [dropped] = this.queue.splice(index, 1);
      }
      if (!dropped) {
        this.stats.rejected++;
        throw new EventAdmissionError('Event job queue capacity exceeded', { code: 'EVENT_QUEUE_CAPACITY' });
      }
      this._finishDropped(dropped, 'overflow');
    }
  }

  _finishDropped(job, reason) {
    if (!job) return;
    this.bytes = Math.max(0, this.bytes - job.bytes);
    this.jobs.delete(job.id);
    job.status = 'dropped';
    this.stats.dropped++;
    this._cleanupSignal(job);
    job.reject?.(new EventAdmissionError(`Event job dropped: ${reason}`, { code: 'EVENT_QUEUE_DROPPED' }));
  }

  _sort() {
    this.queue.sort((left, right) => right.priority - left.priority || left.availableAt - right.availableAt || left.sequence - right.sequence);
  }

  _schedulePump() {
    if (this.pumpScheduled || this.closed) return;
    this.pumpScheduled = true;
    const immediate = setImmediate(() => { this.pumpScheduled = false; void this._pump(); });
    if (this.unrefTimers) immediate.unref?.();
  }

  async _pump() {
    if (this.closed) return;
    const now = Date.now();
    while (this.active < this.concurrency && this.queue.length) {
      const index = this.queue.findIndex((job) => job.availableAt <= now);
      if (index === -1) break;
      const [job] = this.queue.splice(index, 1);
      this.bytes = Math.max(0, this.bytes - job.bytes);
      if (job.signal.aborted) { this._cancelJob(job, abortReason(job.signal)); continue; }
      this.active++;
      job.status = 'running';
      this.running.set(job.id, job);
      void this._run(job).finally(() => {
        this.running.delete(job.id);
        this.active = Math.max(0, this.active - 1);
        this._resolveFlushWaiters();
        this._schedulePump();
      });
    }

    if (this.queue.length && this.active < this.concurrency) {
      const nextAt = Math.min(...this.queue.map((job) => job.availableAt));
      const delay = Math.max(1, nextAt - Date.now());
      if (!this.wakeTimer) {
        this.wakeTimer = setTimeout(() => { this.wakeTimer = null; this._schedulePump(); }, delay);
        if (this.unrefTimers) this.wakeTimer.unref?.();
      }
    }
    this._resolveFlushWaiters();
  }

  async _run(job) {
    job.attempts++;
    const handler = job.handler || this.handlers.get(job.name);
    try {
      const operation = Promise.resolve().then(() => handler(job.payload, {
        id: job.id,
        name: job.name,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        context: job.context,
        meta: job.meta,
        signal: job.signal,
        queue: this,
      }));
      const result = await raceWithSignal(operation, { signal: job.signal, timeoutMs: job.timeoutMs });
      job.status = 'completed';
      this.jobs.delete(job.id);
      this.stats.completed++;
      this._cleanupSignal(job);
      job.resolve(result);
    } catch (rawError) {
      let error = rawError;
      if (rawError?.name === 'TimeoutError') {
        this.stats.timedOut++;
        error = new EventTimeoutError(`Event job timed out after ${job.timeoutMs}ms`, {
          timeoutMs: job.timeoutMs,
          cause: rawError,
          details: { jobId: job.id, name: job.name },
        });
        job.controller.abort(error);
      }

      const canRetry = job.attempts < job.maxAttempts && !job.signal.aborted && !this.closed;
      if (canRetry) {
        job.status = 'queued';
        job.availableAt = Date.now() + Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** Math.max(0, job.attempts - 1)));
        try {
          this._admit(job, { retry: true });
          this.queue.push(job);
          this.bytes += job.bytes;
          this.stats.retried++;
          this._sort();
        } catch (admissionError) {
          job.status = 'failed';
          this.jobs.delete(job.id);
          this.stats.failed++;
          this._cleanupSignal(job);
          job.reject(new EventAdmissionError('Event job retry could not be admitted', {
            code: 'EVENT_QUEUE_RETRY_CAPACITY',
            cause: admissionError,
          }));
        }
      } else if (job.signal.aborted && !(error instanceof EventTimeoutError)) {
        this._cancelJob(job, abortReason(job.signal));
      } else {
        job.status = 'failed';
        this.jobs.delete(job.id);
        this.stats.failed++;
        this._cleanupSignal(job);
        job.reject(error);
      }
    }
  }

  cancel(id, reason = 'cancelled') {
    const job = this.jobs.get(String(id));
    if (!job || ['completed', 'failed', 'cancelled', 'dropped'].includes(job.status)) return false;
    const error = reason instanceof Error ? reason : new EventAbortError(`Event job cancelled: ${reason}`, {
      code: 'EVENT_QUEUE_CANCELLED',
      details: { jobId: job.id, name: job.name },
    });
    if (!job.signal.aborted) job.controller.abort(error);
    if (job.status === 'queued') {
      const index = this.queue.indexOf(job);
      if (index !== -1) this.queue.splice(index, 1);
      this.bytes = Math.max(0, this.bytes - job.bytes);
      this._cancelJob(job, error);
      this._resolveFlushWaiters();
    }
    return true;
  }

  _cancelJob(job, reason) {
    if (!job || job.status === 'cancelled') return;
    const error = reason instanceof Error ? reason : new EventAbortError(`Event job cancelled: ${reason}`, { code: 'EVENT_QUEUE_CANCELLED' });
    job.status = 'cancelled';
    this.jobs.delete(job.id);
    this.stats.cancelled++;
    this._cleanupSignal(job);
    job.reject(error);
  }

  _cleanupSignal(job) {
    if (job.externalSignal && job.onExternalAbort) job.externalSignal.removeEventListener?.('abort', job.onExternalAbort);
    job.onExternalAbort = null;
  }

  pause() { this.accepting = false; return this; }
  resume() { if (!this.closed) { this.accepting = true; this._schedulePump(); } return this; }

  flush(options = {}) {
    const operation = (!this.queue.length && this.active === 0)
      ? Promise.resolve(this.snapshot())
      : new Promise((resolve) => this.flushWaiters.add(resolve));
    return raceWithSignal(operation, { signal: options.signal, timeoutMs: Math.max(0, Number(options.timeoutMs) || 0), unrefTimer: false });
  }

  _resolveFlushWaiters() {
    if (this.queue.length || this.active) return;
    for (const resolve of this.flushWaiters) resolve(this.snapshot());
    this.flushWaiters.clear();
  }

  async close(options = {}) {
    if (this.closed) return this.snapshot();
    this.accepting = false;
    let forced = options.force === true || options.drain === false;
    let error = null;
    if (!forced) {
      try {
        await this.flush({
          signal: options.signal,
          timeoutMs: Math.max(0, Number(options.timeoutMs ?? this.shutdownTimeoutMs) || 0),
        });
      } catch (failure) {
        error = failure;
        if (options.forceOnTimeout === false || this.forceOnShutdownTimeout === false) throw failure;
        forced = true;
      }
    }

    this.closed = true;
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    for (const job of [...this.queue]) this._cancelJob(job, 'queue closed');
    this.queue.length = 0;
    this.bytes = 0;
    if (forced) {
      for (const job of this.running.values()) {
        if (!job.signal.aborted) job.controller.abort(new EventClosedError('Event job queue forced closed'));
      }
    }
    this.lastShutdown = Object.freeze({ forced, error, closedAt: Date.now() });
    this._resolveFlushWaiters();
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      accepting: this.accepting,
      closed: this.closed,
      queued: this.queue.length,
      active: this.active,
      bytes: this.bytes,
      handlers: this.handlers.size,
      limits: Object.freeze({ maxItems: this.maxItems, maxBytes: this.maxBytes, concurrency: this.concurrency, overflow: this.overflow }),
      shutdown: this.lastShutdown,
      stats: Object.freeze({ ...this.stats }),
    });
  }

  async [Symbol.asyncDispose]() { await this.close(); }
}

export { JobHandle };
export default EventJobQueue;
