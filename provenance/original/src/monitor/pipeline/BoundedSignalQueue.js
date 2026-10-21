'use strict';

import { MonitorCapacityError } from '../errors.js';
import { bytesOf, boundedInteger } from '../support.js';

const EMPTY = Symbol('monitor.queue.empty');

export class BoundedSignalQueue {
  constructor(options = {}) {
    this.maxItems = boundedInteger(options.maxItems, 50_000, 1, 10_000_000);
    this.maxBytes = boundedInteger(options.maxBytes, 64 * 1024 * 1024, 1_024, 16 * 1024 * 1024 * 1024);
    this.maxSignalBytes = boundedInteger(options.maxSignalBytes, 2 * 1024 * 1024, 1, this.maxBytes);
    this.maxWaiters = boundedInteger(options.maxWaiters, 100_000, 1, 10_000_000);
    this.overflow = options.overflow || 'drop-oldest';
    this.sizeOf = options.sizeOf || ((value) => bytesOf(value, this.maxSignalBytes + 1));
    this.buffer = new Array(this.maxItems).fill(EMPTY);
    this.head = 0;
    this.tail = 0;
    this.length = 0;
    this.bytes = 0;
    this.waiters = [];
    this.closed = false;
    this.releasingWaiters = false;
    this.stats = {
      admitted: 0,
      shifted: 0,
      blocked: 0,
      waitTimeouts: 0,
      waiterLimit: 0,
      droppedNew: 0,
      droppedOldest: 0,
      rejected: 0,
      oversized: 0,
      highWaterItems: 0,
      highWaterBytes: 0,
      highWaterWaiters: 0,
    };
  }

  tryPush(value, options = {}) {
    if (this.closed) return this._reject('closed', 0, value, options);
    const bytes = options.bytes ?? this.sizeOf(value);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new TypeError('Signal byte size must be a non-negative safe integer.');
    if (bytes > this.maxSignalBytes || bytes > this.maxBytes) {
      this.stats.oversized++;
      return this._reject('oversized', bytes, value, options);
    }

    while (this.length >= this.maxItems || this.bytes + bytes > this.maxBytes) {
      if (this.overflow === 'drop-oldest') {
        const dropped = this._shiftEntry({ releaseWaiters: false });
        if (!dropped) break;
        this.stats.droppedOldest++;
        options.onDrop?.(dropped.value, { reason: 'drop-oldest', bytes: dropped.bytes });
        continue;
      }
      if (this.overflow === 'reject') return this._reject('capacity', bytes, value, { ...options, throw: true });
      if (this.overflow === 'block') {
        this.stats.blocked++;
        return Object.freeze({ accepted: false, reason: 'would-block', bytes, queuedItems: this.length, queuedBytes: this.bytes, waiters: this.waiters.length });
      }
      this.stats.droppedNew++;
      return this._reject('capacity', bytes, value, options);
    }

    this.buffer[this.tail] = { value, bytes };
    this.tail = (this.tail + 1) % this.maxItems;
    this.length++;
    this.bytes += bytes;
    this.stats.admitted++;
    this.stats.highWaterItems = Math.max(this.stats.highWaterItems, this.length);
    this.stats.highWaterBytes = Math.max(this.stats.highWaterBytes, this.bytes);
    return Object.freeze({ accepted: true, bytes, queuedItems: this.length, queuedBytes: this.bytes });
  }

  async push(value, options = {}) {
    const bytes = options.bytes ?? this.sizeOf(value);
    const admitted = this.tryPush(value, { ...options, bytes });
    if (admitted.accepted || admitted.reason !== 'would-block') return admitted;
    if (this.waiters.length >= this.maxWaiters) {
      this.stats.waiterLimit++;
      throw new MonitorCapacityError('Monitor signal queue waiter limit exceeded.', {
        code: 'MONITOR_QUEUE_WAITER_LIMIT',
        details: { maxWaiters: this.maxWaiters },
      });
    }
    if (options.signal?.aborted) throw abortReason(options.signal);

    const timeoutMs = boundedInteger(options.timeoutMs, 5_000, 1, 300_000);
    return await new Promise((resolve, reject) => {
      const waiter = { value, bytes, options: { ...options, bytes }, resolve, reject, timer: null, abort: null, settled: false };
      const cleanup = () => {
        clearTimeout(waiter.timer);
        if (waiter.abort) options.signal?.removeEventListener?.('abort', waiter.abort);
      };
      waiter.resolve = (result) => {
        if (waiter.settled) return;
        waiter.settled = true;
        cleanup();
        resolve(result);
      };
      waiter.reject = (error) => {
        if (waiter.settled) return;
        waiter.settled = true;
        cleanup();
        reject(error);
      };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        this.stats.waitTimeouts++;
        waiter.reject(new MonitorCapacityError('Timed out waiting for Monitor signal queue capacity.', {
          code: 'MONITOR_QUEUE_WAIT_TIMEOUT',
          details: { timeoutMs },
        }));
      }, timeoutMs);
      waiter.timer.unref?.();
      if (options.signal) {
        waiter.abort = () => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          waiter.reject(abortReason(options.signal));
        };
        options.signal.addEventListener('abort', waiter.abort, { once: true });
      }
      this.waiters.push(waiter);
      this.stats.highWaterWaiters = Math.max(this.stats.highWaterWaiters, this.waiters.length);
    });
  }

  shift() { return this._shiftEntry()?.value; }

  shiftMany(limit = 1_000) {
    const output = [];
    while (output.length < limit) {
      const entry = this._shiftEntry({ releaseWaiters: false });
      if (!entry) break;
      output.push(entry.value);
    }
    this._releaseWaiters();
    return output;
  }

  _shiftEntry(options = {}) {
    if (!this.length) return null;
    const entry = this.buffer[this.head];
    this.buffer[this.head] = EMPTY;
    this.head = (this.head + 1) % this.maxItems;
    this.length--;
    this.bytes -= entry.bytes;
    this.stats.shifted++;
    if (options.releaseWaiters !== false) this._releaseWaiters();
    return entry;
  }

  _releaseWaiters() {
    if (this.releasingWaiters || this.closed) return;
    this.releasingWaiters = true;
    try {
      while (this.waiters.length) {
        const waiter = this.waiters[0];
        const result = this.tryPush(waiter.value, waiter.options);
        if (!result.accepted) {
          if (result.reason !== 'would-block') {
            this.waiters.shift();
            waiter.reject(new MonitorCapacityError(`Monitor queued signal rejected: ${result.reason}.`, { details: result }));
            continue;
          }
          break;
        }
        this.waiters.shift();
        waiter.resolve(result);
      }
    } finally {
      this.releasingWaiters = false;
    }
  }

  _reject(reason, bytes, value, options = {}) {
    this.stats.rejected++;
    const result = Object.freeze({ accepted: false, reason, bytes, queuedItems: this.length, queuedBytes: this.bytes });
    options.onDrop?.(value, result);
    if (options.throw === true) throw new MonitorCapacityError(`Monitor signal rejected: ${reason}.`, { details: result });
    return result;
  }

  clear(onDrop = null) {
    let dropped = 0;
    while (this.length) {
      const entry = this._shiftEntry({ releaseWaiters: false });
      dropped++;
      onDrop?.(entry.value, { reason: 'clear', bytes: entry.bytes });
    }
    this._releaseWaiters();
    return dropped;
  }

  close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(new MonitorCapacityError('Monitor signal queue closed.', { code: 'MONITOR_QUEUE_CLOSED' }));
    }
  }

  snapshot() {
    return Object.freeze({
      length: this.length,
      bytes: this.bytes,
      maxItems: this.maxItems,
      maxBytes: this.maxBytes,
      maxSignalBytes: this.maxSignalBytes,
      maxWaiters: this.maxWaiters,
      waiters: this.waiters.length,
      overflow: this.overflow,
      closed: this.closed,
      stats: Object.freeze({ ...this.stats }),
    });
  }
}

function abortReason(signal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error('Signal admission aborted.'), { code: 'ABORT_ERR' });
}

export default BoundedSignalQueue;
