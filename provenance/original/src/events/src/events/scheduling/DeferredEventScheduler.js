'use strict';

import { performance } from 'node:perf_hooks';
import { deferred } from '../support/async.js';
import { estimateValueBytes } from '../support/size.js';
import { EventAdmissionError, EventClosedError } from '../errors/EventError.js';

const VALID_OVERFLOW = new Set(['reject', 'drop-newest', 'drop-oldest', 'coalesce']);

export class DeferredEventScheduler {
  constructor(options = {}) {
    this.maxItems = Math.max(0, Number(options.maxItems ?? 0) || 0);
    this.maxBytes = Math.max(0, Number(options.maxBytes ?? 0) || 0);
    this.maxInFlight = Math.max(1, Number(options.maxInFlight ?? 1) || 1);
    this.budgetMs = Math.max(0, Number(options.budgetMs ?? 4) || 0);
    this.maxPerSlice = Math.max(1, Number(options.maxPerSlice ?? 256) || 256);
    this.overflow = VALID_OVERFLOW.has(options.overflow) ? options.overflow : 'reject';
    this.awaitTasks = options.awaitTasks === true;
    this.unrefTimers = options.unrefTimers === true;
    this.sizeOf = typeof options.sizeOf === 'function' ? options.sizeOf : (item) => estimateValueBytes(item?.metadata ?? item);
    this.onDiagnostic = typeof options.onDiagnostic === 'function' ? options.onDiagnostic : null;

    this.queue = [];
    this.head = 0;
    this.bytes = 0;
    this.inFlight = 0;
    this.scheduled = false;
    this.accepting = true;
    this.closed = false;
    this.flushWaiters = new Set();
    this.coalesced = new Map();
    this.stats = { accepted: 0, completed: 0, failed: 0, rejected: 0, dropped: 0, highWaterItems: 0, highWaterBytes: 0, slices: 0, yields: 0 };
  }

  get length() { return this.queue.length - this.head; }
  get idle() { return this.length === 0 && this.inFlight === 0; }

  schedule(task, options = {}) {
    if (typeof task !== 'function') throw new TypeError('DeferredEventScheduler.schedule expects a function');
    if (this.closed) throw new EventClosedError('Deferred event scheduler is closed');
    if (!this.accepting) throw new EventAdmissionError('Deferred event scheduler is draining', { code: 'EVENT_SCHEDULER_DRAINING' });

    const completion = deferred();
    const item = {
      task,
      metadata: options.metadata || null,
      key: options.key == null ? null : String(options.key),
      bytes: Math.max(0, Number(options.bytes) || this.sizeOf({ metadata: options.metadata })),
      completion,
      awaitTask: options.awaitTask === true,
      acceptedAt: Date.now(),
    };

    const admission = this._admit(item);
    if (!admission.accepted) {
      const error = new EventAdmissionError(`Deferred event rejected: ${admission.reason}`, {
        code: 'EVENT_DEFERRED_REJECTED',
        details: admission,
      });
      completion.reject(error);
      completion.promise.catch(() => {});
      return { ...admission, promise: completion.promise };
    }

    this.stats.accepted++;
    this.stats.highWaterItems = Math.max(this.stats.highWaterItems, this.length);
    this.stats.highWaterBytes = Math.max(this.stats.highWaterBytes, this.bytes);
    this._ensureScheduled(true);
    return { accepted: true, promise: completion.promise, item };
  }

  _fits(item) {
    if (this.maxItems && this.length >= this.maxItems) return false;
    if (this.maxBytes && this.bytes + item.bytes > this.maxBytes) return false;
    return true;
  }

  _admit(item) {
    if (item.key && this.overflow === 'coalesce') {
      const existing = this.coalesced.get(item.key);
      if (existing) {
        const nextBytes = this.bytes - existing.bytes + item.bytes;
        if (this.maxBytes && nextBytes > this.maxBytes) {
          this.stats.rejected++;
          return { accepted: false, reason: 'item-too-large', items: this.length, bytes: this.bytes };
        }
        existing.task = item.task;
        existing.metadata = item.metadata;
        this.bytes += item.bytes - existing.bytes;
        existing.bytes = item.bytes;
        existing.completion.resolve({ coalesced: true });
        existing.completion = item.completion;
        return { accepted: true, coalesced: true };
      }
    }

    if (!this._fits(item)) {
      if (this.overflow === 'drop-oldest') {
        while (!this._fits(item) && this.length > 0) {
          const dropped = this._shift();
          if (!dropped) break;
          this.stats.dropped++;
          dropped.completion.reject(new EventAdmissionError('Deferred event dropped by overflow policy', { code: 'EVENT_DEFERRED_DROPPED' }));
          dropped.completion.promise.catch(() => {});
        }
      } else if (this.overflow === 'drop-newest' || this.overflow === 'coalesce') {
        this.stats.dropped++;
        return { accepted: false, reason: 'drop-newest', items: this.length, bytes: this.bytes };
      } else {
        this.stats.rejected++;
        return { accepted: false, reason: 'capacity', items: this.length, bytes: this.bytes };
      }
    }

    if (!this._fits(item)) {
      this.stats.rejected++;
      return { accepted: false, reason: 'item-too-large', items: this.length, bytes: this.bytes };
    }

    this.queue.push(item);
    this.bytes += item.bytes;
    if (item.key) this.coalesced.set(item.key, item);
    return { accepted: true };
  }

  _shift() {
    while (this.head < this.queue.length) {
      const item = this.queue[this.head++];
      if (!item) continue;
      this.bytes = Math.max(0, this.bytes - item.bytes);
      if (item.key && this.coalesced.get(item.key) === item) this.coalesced.delete(item.key);
      if (this.head > 4096 && this.head > this.queue.length / 2) {
        this.queue = this.queue.slice(this.head);
        this.head = 0;
      }
      return item;
    }
    this.queue.length = 0;
    this.head = 0;
    return null;
  }

  _ensureScheduled(microtask = false) {
    if (this.scheduled || this.closed) return;
    this.scheduled = true;
    if (microtask) queueMicrotask(() => this._runSlice());
    else {
      const immediate = setImmediate(() => this._runSlice());
      if (this.unrefTimers) immediate.unref?.();
    }
  }

  _runSlice() {
    this.scheduled = false;
    if (this.closed) return this._resolveFlush();
    this.stats.slices++;
    const started = performance.now();
    let processed = 0;

    while (this.length > 0 && this.inFlight < this.maxInFlight) {
      const item = this._shift();
      if (!item) break;
      processed++;
      this.inFlight++;
      let result;
      let threw = false;
      try { result = item.task(); }
      catch (error) { threw = true; this._settle(item, error); }

      if (threw) {
        if (processed >= this.maxPerSlice || (this.budgetMs > 0 && performance.now() - started >= this.budgetMs)) break;
        continue;
      }

      if (result && typeof result.then === 'function') {
        if (this.awaitTasks || item.awaitTask) {
          Promise.resolve(result).then(
            (value) => this._settle(item, null, value),
            (error) => this._settle(item, error),
          );
        } else {
          Promise.resolve(result).catch((error) => this.onDiagnostic?.('task:error', { error, metadata: item.metadata }));
          this._settle(item, null, undefined);
        }
      } else if (this.inFlight > 0 && item.completion) {
        this._settle(item, null, result);
      }

      if (processed >= this.maxPerSlice || (this.budgetMs > 0 && performance.now() - started >= this.budgetMs)) break;
    }

    if (this.length > 0) {
      this.stats.yields++;
      this._ensureScheduled(false);
    }
    this._resolveFlush();
  }

  _settle(item, error, value) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (error) {
      this.stats.failed++;
      item.completion.reject(error);
      item.completion.promise.catch(() => {});
      this.onDiagnostic?.('task:error', { error, metadata: item.metadata });
    } else {
      this.stats.completed++;
      item.completion.resolve(value);
    }
    if (this.length > 0) this._ensureScheduled(false);
    this._resolveFlush();
  }

  flush() {
    if (this.idle) return Promise.resolve(this.snapshot());
    const waiter = deferred();
    this.flushWaiters.add(waiter);
    return waiter.promise;
  }

  _resolveFlush() {
    if (!this.idle) return;
    const snapshot = this.snapshot();
    for (const waiter of this.flushWaiters) waiter.resolve(snapshot);
    this.flushWaiters.clear();
  }

  async drain() {
    this.accepting = false;
    return this.flush();
  }

  async close(options = {}) {
    if (this.closed) return this.snapshot();
    this.accepting = false;
    if (options.force !== true) await this.flush();
    while (this.length) {
      const item = this._shift();
      if (!item) break;
      item.completion.reject(new EventClosedError('Deferred event scheduler closed'));
      item.completion.promise.catch(() => {});
    }
    this.closed = true;
    this._resolveFlush();
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      accepting: this.accepting,
      closed: this.closed,
      queuedItems: this.length,
      queuedBytes: this.bytes,
      inFlight: this.inFlight,
      limits: Object.freeze({ maxItems: this.maxItems, maxBytes: this.maxBytes, maxInFlight: this.maxInFlight, overflow: this.overflow }),
      stats: Object.freeze({ ...this.stats }),
    });
  }
}

export default DeferredEventScheduler;
