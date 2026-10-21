'use strict';

import { timeout } from '../support/safe.js';

export class EventSubscriptionBuilder {
  constructor(fabric, eventName, options = {}) { this.fabric = fabric; this.eventName = String(eventName); this.options = { ...options }; this.listener = null; }
  handle(listener) { if (typeof listener !== 'function') throw new TypeError('Event subscription handler must be a function.'); this.listener = listener; return this; }
  priority(value) { this.options.priority = Number(value) || 0; return this; }
  prepend(value = true) { this.options.prepend = value !== false; return this; }
  once(value = true) { this.options.once = value !== false; return this; }
  replay(value = true) { this.options.replay = value; return this; }
  owner(value) { this.options.owner = value == null ? null : String(value); return this; }
  tag(...values) { this.options.tags = [...(this.options.tags || []), ...values.flat().map(String)]; return this; }
  signal(value) { this.options.signal = value; return this; }
  timeout(value) { this.options.timeoutMs = Math.max(0, Number(value) || 0); return this; }
  retry(attempts = 1, options = {}) { this.options.retry = { attempts: Math.max(0, Number(attempts) || 0), delayMs: Math.max(0, Number(options.delayMs) || 0), backoff: Math.max(1, Number(options.backoff) || 2), maxDelayMs: Math.max(0, Number(options.maxDelayMs) || 30_000) }; return this; }
  serialBy(selector) { this.options.serialBy = selector; return this; }
  debounce(milliseconds) { this.options.debounceMs = Math.max(0, Number(milliseconds) || 0); return this; }
  throttle(milliseconds) { this.options.throttleMs = Math.max(0, Number(milliseconds) || 0); return this; }
  onError(policy) { this.options.errorPolicy = policy; return this; }
  idempotent(value = true) { this.options.idempotent = value !== false; return this; }
  queued(value = true) { this.options.queued = value !== false; return this; }
  durable(value = true) { this.options.durable = value !== false; return this; }
  pattern(value = true) { this.options.pattern = value !== false; return this; }
  any(value = true) { this.options.any = value !== false; return this; }
  register() {
    if (!this.listener) throw new TypeError(`Event subscription '${this.eventName}' requires handle().`);
    const wrapped = wrapHandler(this.listener, this.options, this.fabric);
    if (this.options.signal?.aborted) return null;
    const dispatcher = this.fabric.dispatcher;
    const handle = this.options.any ? dispatcher.subscribeAny(wrapped, this.options) : this.options.pattern || this.eventName.includes('**') || this.eventName.includes('?') ? dispatcher.subscribePattern(this.eventName, wrapped, this.options) : dispatcher.subscribe(this.eventName, wrapped, this.options);
    if (this.options.signal && handle) {
      const dispose = () => handle.dispose?.();
      this.options.signal.addEventListener('abort', dispose, { once: true });
    }
    return handle;
  }
  listen(listener = null) { if (listener) this.handle(listener); return this.register(); }
}

function wrapHandler(listener, options, fabric) {
  const chains = new Map();
  let debounceTimer = null;
  let lastRun = 0;
  let pendingDebounce = null;
  const execute = async (...args) => {
    if (options.queued) return fabric.queue ? fabric.queue.add?.('dispatch-listener', { listener, args, eventName: options.eventName }, options) : listener(...args);
    let attempt = 0; const retries = options.retry?.attempts || 0;
    while (true) {
      try { return await timeout(Promise.resolve(listener(...args)), options.timeoutMs, { code: 'EVENT_LISTENER_TIMEOUT' }); }
      catch (error) { if (attempt++ >= retries || options.idempotent !== true) throw error; const delay = Math.min(options.retry.maxDelayMs, options.retry.delayMs * (options.retry.backoff ** Math.max(0, attempt - 1))); if (delay) await new Promise((resolve) => setTimeout(resolve, delay)); }
    }
  };
  return (...args) => {
    const now = Date.now();
    if (options.throttleMs > 0 && now - lastRun < options.throttleMs) return undefined;
    if (options.debounceMs > 0) {
      clearTimeout(debounceTimer);
      pendingDebounce ||= deferred();
      debounceTimer = setTimeout(async () => { const current = pendingDebounce; pendingDebounce = null; try { lastRun = Date.now(); current.resolve(await execute(...args)); } catch (error) { current.reject(error); } }, options.debounceMs);
      return pendingDebounce.promise;
    }
    lastRun = now;
    if (options.serialBy) {
      const key = String(typeof options.serialBy === 'function' ? options.serialBy(...args) : args[0]?.[options.serialBy] ?? 'default');
      const previous = chains.get(key) || Promise.resolve();
      const next = previous.catch(() => {}).then(() => execute(...args)).finally(() => { if (chains.get(key) === next) chains.delete(key); });
      chains.set(key, next); return next;
    }
    return execute(...args);
  };
}
function deferred() { let resolve; let reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
export default EventSubscriptionBuilder;
