'use strict';

import { AsyncLocalStorage } from 'node:async_hooks';
import { createEventContext } from './EventContext.js';

function defaultIdFactory() {
  const pid = process.pid.toString(36);
  const boot = Date.now().toString(36);
  let sequence = 0;
  return () => {
    sequence = (sequence + 1) >>> 0;
    return `${pid}-${boot}-${Date.now().toString(36)}-${sequence.toString(36)}-${((Math.random() * 0xfffff) | 0).toString(36)}`;
  };
}

export class EventContextManager {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.storage = this.enabled ? new AsyncLocalStorage() : null;
    this.idFactory = typeof options.idFactory === 'function' ? options.idFactory : defaultIdFactory();
    this.closed = false;
  }

  create(meta = {}) { return createEventContext(meta, this.get(), this.idFactory); }
  get() { return this.storage?.getStore?.() || null; }
  id() { return this.get()?.id ?? null; }

  run(context, fn) {
    if (typeof fn !== 'function') throw new TypeError('EventContextManager.run expects a function');
    if (!this.storage || !context) return fn();
    return this.storage.run(context, fn);
  }

  runIfMissing(meta, fn) {
    return this.get() ? fn() : this.run(this.create(meta), fn);
  }

  enter(context) { if (this.storage && context) this.storage.enterWith(context); }

  bind(fn, context = this.get()) {
    if (typeof fn !== 'function') throw new TypeError('EventContextManager.bind expects a function');
    if (!this.storage || !context) return fn;
    const storage = this.storage;
    return function boundEventContext(...args) {
      return storage.run(context, () => Reflect.apply(fn, this, args));
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.storage?.disable?.();
  }
}

export default EventContextManager;
