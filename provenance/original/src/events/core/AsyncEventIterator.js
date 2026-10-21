'use strict';

import { deferred, abortError } from '../support/async.js';

export class AsyncEventIterator {
  constructor(options = {}) {
    this.maxItems = Math.max(1, Number(options.maxItems) || 1024);
    this.overflow = options.overflow || 'drop-oldest';
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    this.error = null;
    this.handle = null;
    this.signal = options.signal || null;
    this.onAbort = null;
    if (this.signal) {
      this.onAbort = () => this.fail(abortError());
      if (this.signal.aborted) this.onAbort();
      else this.signal.addEventListener('abort', this.onAbort, { once: true });
    }
  }

  attach(handle) { this.handle = handle; return this; }

  push(value) {
    if (this.closed) return false;
    const waiter = this.waiters.shift();
    if (waiter) { waiter.resolve({ value, done: false }); return true; }
    if (this.queue.length >= this.maxItems) {
      if (this.overflow === 'drop-newest') return false;
      if (this.overflow === 'reject') {
        this.fail(new Error('Event iterator queue capacity exceeded'));
        return false;
      }
      this.queue.shift();
    }
    this.queue.push(value);
    return true;
  }

  next() {
    if (this.queue.length) return Promise.resolve({ value: this.queue.shift(), done: false });
    if (this.error) return Promise.reject(this.error);
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    const waiter = deferred();
    this.waiters.push(waiter);
    return waiter.promise;
  }

  return() { this.close(); return Promise.resolve({ value: undefined, done: true }); }
  throw(error) { this.fail(error); return Promise.reject(error); }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.handle?.dispose?.();
    this.handle = null;
    if (this.onAbort) this.signal?.removeEventListener?.('abort', this.onAbort);
    for (const waiter of this.waiters) waiter.resolve({ value: undefined, done: true });
    this.waiters.length = 0;
  }

  fail(error) {
    if (this.closed) return;
    this.error = error || new Error('Event iterator failed');
    this.closed = true;
    this.handle?.dispose?.();
    this.handle = null;
    if (this.onAbort) this.signal?.removeEventListener?.('abort', this.onAbort);
    for (const waiter of this.waiters) waiter.reject(this.error);
    this.waiters.length = 0;
  }

  [Symbol.asyncIterator]() { return this; }
  async [Symbol.asyncDispose]() { this.close(); }
}

export default AsyncEventIterator;
