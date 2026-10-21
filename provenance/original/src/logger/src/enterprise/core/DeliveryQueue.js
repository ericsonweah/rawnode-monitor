'use strict';

import { performance } from 'node:perf_hooks';

function yieldToLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createQueueError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function finiteInteger(value, fallback, minimum = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : fallback;
}

/**
 * Ordered, cooperative, byte-bounded async queue.
 *
 * Guarantees:
 * - tasks execute in enqueue order;
 * - both queued and active work count toward memory limits;
 * - lower-priority/droppable work is evicted before higher-severity work;
 * - non-droppable work is never silently discarded;
 * - emergency overcommit is itself bounded to prevent a failing sink from
 *   converting the logger into an unbounded memory queue.
 */
export class DeliveryQueue {
  constructor(options = {}) {
    this.name = options.name || 'logger-pipeline';
    this.maxItems = finiteInteger(options.maxItems, 10_000, 1);
    this.maxBytes = finiteInteger(options.maxBytes, 64 * 1024 * 1024, 1_024);
    this.maxOvercommitItems = finiteInteger(
      options.maxOvercommitItems,
      Math.max(16, Math.ceil(this.maxItems * 0.05)),
      0,
    );
    this.maxOvercommitBytes = finiteInteger(
      options.maxOvercommitBytes,
      Math.max(1024 * 1024, Math.ceil(this.maxBytes * 0.10)),
      0,
    );
    this.overflow = options.overflow || 'severity-aware';
    this.budgetMs = Math.max(1, Number(options.budgetMs) || 6);
    this.maxPerSlice = finiteInteger(options.maxPerSlice, 1_000, 1);
    this.flushTimeoutMs = finiteInteger(options.flushTimeoutMs, 30_000, 0);
    this.onDrop = typeof options.onDrop === 'function' ? options.onDrop : null;
    this.onError = typeof options.onError === 'function' ? options.onError : null;
    this.onEmergency = typeof options.onEmergency === 'function' ? options.onEmergency : null;

    this.queue = [];
    this.queuedBytes = 0;
    this.active = 0;
    this.activeBytes = 0;
    this.overcommitItems = 0;
    this.overcommitBytes = 0;
    this.draining = false;
    this.accepting = true;
    this.flushWaiters = new Set();
    this.stats = {
      accepted: 0,
      completed: 0,
      failed: 0,
      dropped: 0,
      evicted: 0,
      overcommitted: 0,
      emergencyFallbacks: 0,
      aborted: 0,
      highWaterItems: 0,
      highWaterBytes: 0,
      maxQueueLatencyMs: 0,
    };
  }

  enqueue(task, options = {}) {
    if (typeof task !== 'function') throw new TypeError('DeliveryQueue.enqueue requires a function.');
    const bytes = Math.max(0, Number(options.bytes) || 0);
    const meta = options.meta || Object.create(null);
    const signal = options.signal || meta.signal || null;
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    // Fire-and-forget logging callers should never trigger process-level
    // unhandled-rejection warnings; explicit callers still receive the same promise.
    promise.catch(() => {});

    if (!this.accepting) {
      reject(createQueueError('LOGGER_QUEUE_CLOSED', `Queue [${this.name}] is closed.`));
      return { accepted: false, promise, reason: 'closed' };
    }
    if (signal?.aborted) {
      this.stats.aborted++;
      resolve({ dropped: true, reason: 'aborted', queue: this.name });
      return { accepted: false, promise, reason: 'aborted' };
    }

    const room = this._makeRoom(bytes, meta);
    if (!room.accepted) {
      const result = { dropped: true, reason: room.reason || 'overflow', queue: this.name };
      this.stats.dropped++;
      try { this.onDrop?.(result, meta); } catch {}
      if (this.overflow === 'throw' || this.overflow === 'reject') {
        reject(createQueueError('LOGGER_QUEUE_OVERFLOW', `Queue [${this.name}] is full.`, this.snapshot()));
      } else {
        resolve(result);
      }
      return { accepted: false, promise, reason: result.reason };
    }

    if (room.emergencyFallback) {
      this.stats.accepted++;
      this.stats.emergencyFallbacks++;
      Promise.resolve()
        .then(() => options.emergency?.(meta) ?? this.onEmergency?.(meta))
        .then((value) => resolve({ delivered: true, emergencyFallback: true, value }), reject);
      return { accepted: true, promise, emergencyFallback: true, overcommitted: false };
    }

    const overcommitted = room.overcommitted === true;
    if (overcommitted) {
      this.stats.overcommitted++;
      this.overcommitItems++;
      this.overcommitBytes += bytes;
    }

    const item = {
      task,
      bytes,
      meta,
      signal,
      resolve,
      reject,
      overcommitted,
      enqueuedAt: performance.now(),
    };
    this.queue.push(item);
    this.queuedBytes += bytes;
    this.stats.accepted++;
    this._captureHighWater();
    this._schedule();
    return { accepted: true, promise, overcommitted };
  }

  _captureHighWater() {
    this.stats.highWaterItems = Math.max(this.stats.highWaterItems, this.queue.length + this.active);
    this.stats.highWaterBytes = Math.max(this.stats.highWaterBytes, this.queuedBytes + this.activeBytes);
  }

  _fits(bytes) {
    return (this.queue.length + this.active) < this.maxItems
      && (this.queuedBytes + this.activeBytes + bytes) <= this.maxBytes;
  }

  _canOvercommit(bytes) {
    return this.overcommitItems < this.maxOvercommitItems
      && this.overcommitBytes + bytes <= this.maxOvercommitBytes;
  }

  _makeRoom(bytes, meta) {
    if (this._fits(bytes)) return { accepted: true };

    const canEvict = ['drop-oldest', 'drop-lowest', 'severity-aware'].includes(this.overflow);
    if (canEvict) {
      while (!this._fits(bytes) && this.queue.length) {
        const index = this._evictionIndex();
        if (index < 0) break;
        const [item] = this.queue.splice(index, 1);
        this.queuedBytes -= item.bytes;
        if (item.overcommitted) {
          this.overcommitItems = Math.max(0, this.overcommitItems - 1);
          this.overcommitBytes = Math.max(0, this.overcommitBytes - item.bytes);
        }
        this.stats.dropped++;
        this.stats.evicted++;
        const result = { dropped: true, reason: 'overflow-evicted', queue: this.name };
        item.resolve(result);
        try { this.onDrop?.(result, item.meta); } catch {}
      }
      if (this._fits(bytes)) return { accepted: true };
    }

    if (meta?.droppable === false) {
      if (this._canOvercommit(bytes)) return { accepted: true, overcommitted: true };
      // There is no safe in-memory space left. The queue does not silently lose
      // critical work; it invokes the synchronous/direct emergency path instead.
      return { accepted: true, emergencyFallback: true };
    }

    return { accepted: false, reason: 'overflow' };
  }

  _evictionIndex() {
    if (this.overflow === 'drop-oldest') {
      return this.queue.findIndex((item) => item?.meta?.droppable !== false);
    }

    // Larger rank / smaller normalized severity means lower importance. On a
    // tie, evict the oldest item to keep behavior deterministic.
    let selected = -1;
    let selectedRank = -Infinity;
    let selectedSeverity = Infinity;
    for (let index = 0; index < this.queue.length; index++) {
      const item = this.queue[index];
      if (item?.meta?.droppable === false) continue;
      const rank = Number.isFinite(Number(item?.meta?.rank)) ? Number(item.meta.rank) : Infinity;
      const severity = Number.isFinite(Number(item?.meta?.severity)) ? Number(item.meta.severity) : -Infinity;
      if (selected < 0 || rank > selectedRank || (rank === selectedRank && severity < selectedSeverity)) {
        selected = index;
        selectedRank = rank;
        selectedSeverity = severity;
      }
    }
    return selected;
  }

  _schedule() {
    if (this.draining || !this.queue.length) return;
    this.draining = true;
    queueMicrotask(() => this._drain().catch((error) => {
      this.draining = false;
      try { this.onError?.(error, { queue: this.name, phase: 'drain' }); } catch {}
      if (this.queue.length) this._schedule();
      else this._resolveFlushWaiters();
    }));
  }

  async _drain() {
    let sliceStart = performance.now();
    let processed = 0;
    try {
      while (this.queue.length) {
        const item = this.queue.shift();
        this.queuedBytes -= item.bytes;
        if (item.overcommitted) {
          this.overcommitItems = Math.max(0, this.overcommitItems - 1);
          this.overcommitBytes = Math.max(0, this.overcommitBytes - item.bytes);
        }

        if (item.signal?.aborted) {
          this.stats.aborted++;
          item.resolve({ dropped: true, reason: 'aborted', queue: this.name });
          continue;
        }

        this.active++;
        this.activeBytes += item.bytes;
        this.stats.maxQueueLatencyMs = Math.max(this.stats.maxQueueLatencyMs, performance.now() - item.enqueuedAt);
        try {
          const value = await item.task();
          this.stats.completed++;
          item.resolve(value);
        } catch (error) {
          this.stats.failed++;
          try { this.onError?.(error, item.meta); } catch {}
          item.reject(error);
        } finally {
          this.active--;
          this.activeBytes = Math.max(0, this.activeBytes - item.bytes);
        }

        processed++;
        if (processed >= this.maxPerSlice || performance.now() - sliceStart >= this.budgetMs) {
          processed = 0;
          sliceStart = performance.now();
          await yieldToLoop();
        }
      }
    } finally {
      this.draining = false;
      if (this.queue.length) this._schedule();
      else this._resolveFlushWaiters();
    }
  }

  _resolveFlushWaiters() {
    if (this.draining || this.active || this.queue.length) return;
    for (const waiter of this.flushWaiters) waiter.resolve();
    this.flushWaiters.clear();
  }

  async flush(options = {}) {
    if (!this.draining && !this.active && this.queue.length === 0) return;
    const timeoutMs = options.timeoutMs == null
      ? this.flushTimeoutMs
      : Math.max(0, Number(options.timeoutMs) || 0);
    let timer = null;
    await new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => {
          if (timer) clearTimeout(timer);
          this.flushWaiters.delete(waiter);
          resolve();
        },
      };
      this.flushWaiters.add(waiter);
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.flushWaiters.delete(waiter);
          reject(createQueueError(
            'LOGGER_FLUSH_TIMEOUT',
            `Queue [${this.name}] flush timed out after ${timeoutMs}ms.`,
            this.snapshot(),
          ));
        }, timeoutMs);
       
      }
      this._schedule();
    });
  }

  async close(options = {}) {
    if (!this.accepting) {
      await this.flush(options);
      return;
    }
    this.accepting = false;
    await this.flush(options);
  }

  destroy(reason = 'destroyed') {
    this.accepting = false;
    while (this.queue.length) {
      const item = this.queue.shift();
      this.queuedBytes -= item.bytes;
      if (item.overcommitted) {
        this.overcommitItems = Math.max(0, this.overcommitItems - 1);
        this.overcommitBytes = Math.max(0, this.overcommitBytes - item.bytes);
      }
      this.stats.dropped++;
      item.resolve({ dropped: true, reason, queue: this.name });
    }
    this._resolveFlushWaiters();
  }

  snapshot() {
    return {
      name: this.name,
      accepting: this.accepting,
      draining: this.draining,
      active: this.active,
      activeBytes: this.activeBytes,
      queuedItems: this.queue.length,
      queuedBytes: this.queuedBytes,
      overcommitItems: this.overcommitItems,
      overcommitBytes: this.overcommitBytes,
      maxItems: this.maxItems,
      maxBytes: this.maxBytes,
      maxOvercommitItems: this.maxOvercommitItems,
      maxOvercommitBytes: this.maxOvercommitBytes,
      overflow: this.overflow,
      stats: { ...this.stats },
    };
  }
}

export default DeliveryQueue;
