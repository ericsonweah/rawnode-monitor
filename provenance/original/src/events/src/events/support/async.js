'use strict';

export function isPromiseLike(value) {
  return !!value && (typeof value === 'object' || typeof value === 'function') && typeof value.then === 'function';
}

export function abortError(message = 'Operation aborted') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'EVENT_ABORTED';
  return error;
}

export function timeoutError(ms) {
  const error = new Error(`Operation timed out after ${ms}ms`);
  error.name = 'TimeoutError';
  error.code = 'EVENT_TIMEOUT';
  error.timeoutMs = ms;
  return error;
}

export async function raceWithSignal(value, options = {}) {
  const signal = options.signal;
  const timeoutMs = Number(options.timeoutMs) || 0;
  if (signal?.aborted) throw abortError();
  if (!signal && timeoutMs <= 0) return await value;

  let timer = null;
  let onAbort = null;
  const controls = [];
  if (signal) {
    controls.push(new Promise((_, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
    }));
  }
  if (timeoutMs > 0) {
    controls.push(new Promise((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs);
      if (options.unrefTimer !== false) timer.unref?.();
    }));
  }
  try { return await Promise.race([Promise.resolve(value), ...controls]); }
  finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener?.('abort', onAbort);
  }
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
