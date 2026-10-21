'use strict';

export function sleep(ms, signal = null) {
  const duration = Math.max(0, Number(ms) || 0);
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('Aborted'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, duration);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(signal.reason || new Error('Aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withTimeout(promiseOrFactory, timeoutMs, options = {}) {
  const ms = Number(timeoutMs) || 0;
  if (ms <= 0) return typeof promiseOrFactory === 'function' ? promiseOrFactory() : promiseOrFactory;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(options.message || `Operation timed out after ${ms}ms`);
      error.code = options.code || 'RNPM_TIMEOUT';
      reject(error);
    }, ms);
  });
  try {
    const task = typeof promiseOrFactory === 'function' ? Promise.resolve().then(promiseOrFactory) : promiseOrFactory;
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export class Deferred {
  constructor() {
    this.settled = false;
    this.promise = new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
    this.promise.catch(() => {});
  }
  resolve(value) { if (!this.settled) { this.settled = true; this._resolve(value); } }
  reject(error) { if (!this.settled) { this.settled = true; this._reject(error); } }
}

export class AsyncLock {
  constructor() { this._tail = Promise.resolve(); }
  run(fn) {
    const next = this._tail.then(fn, fn);
    this._tail = next.catch(() => {});
    return next;
  }
}

export async function mapLimit(values, limit, worker) {
  const list = Array.from(values || []);
  const out = new Array(list.length);
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(list.length || 1, Number(limit) || 1));
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < list.length) {
      const index = cursor++;
      out[index] = await worker(list[index], index);
    }
  }));
  return out;
}
