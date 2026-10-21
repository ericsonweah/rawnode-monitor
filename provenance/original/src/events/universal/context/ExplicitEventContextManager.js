'use strict';

import { deepFreeze, randomId } from '../support/safe.js';

/**
 * Browser/universal context carrier. It intentionally does not claim ambient
 * propagation through arbitrary Promise chains. Context is preserved by
 * RawNode Events operations, scopes, bindings, envelopes, and transport calls.
 */
export class ExplicitEventContextManager {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.stack = [];
    this.idFactory = options.idFactory || (() => randomId('ctx'));
  }

  create(meta = {}) {
    if (!this.enabled) return null;
    const parent = meta.parent || this.get();
    const id = meta.id || this.idFactory();
    return deepFreeze({
      id,
      parentId: meta.parentId ?? parent?.id ?? null,
      causationId: meta.causationId ?? parent?.eventId ?? parent?.id ?? null,
      correlationId: meta.correlationId ?? parent?.correlationId ?? parent?.id ?? id,
      traceId: meta.traceId ?? parent?.traceId ?? null,
      spanId: meta.spanId ?? null,
      requestId: meta.requestId ?? parent?.requestId ?? null,
      tenantId: meta.tenantId ?? parent?.tenantId ?? null,
      actorId: meta.actorId ?? parent?.actorId ?? null,
      connectionId: meta.connectionId ?? parent?.connectionId ?? null,
      tabId: meta.tabId ?? parent?.tabId ?? null,
      transport: meta.transport ?? null,
      source: meta.source ?? null,
      eventId: meta.eventId ?? null,
      createdAt: Number(meta.createdAt) || Date.now(),
      baggage: meta.baggage && typeof meta.baggage === 'object' ? { ...meta.baggage } : null,
    });
  }

  get() { return this.stack[this.stack.length - 1] || null; }
  id() { return this.get()?.id || null; }

  run(context, callback) {
    if (!this.enabled || !context) return callback();
    this.stack.push(context);
    let value;
    try { value = callback(); }
    catch (error) { this.stack.pop(); throw error; }
    if (value && typeof value.then === 'function') return Promise.resolve(value).finally(() => { if (this.stack[this.stack.length - 1] === context) this.stack.pop(); else this._remove(context); });
    this.stack.pop();
    return value;
  }

  runIfMissing(meta, callback) { return this.get() ? callback(this.get()) : this.run(this.create(meta), callback); }
  enter(context) { if (context) this.stack.push(context); return context; }
  leave(context = null) { if (!context || this.stack[this.stack.length - 1] === context) return this.stack.pop() || null; return this._remove(context); }
  bind(callback, context = this.get()) { return (...args) => this.run(context, () => callback(...args)); }
  child(meta = {}) { return this.create({ ...meta, parent: this.get() }); }
  _remove(context) { const index = this.stack.lastIndexOf(context); if (index !== -1) return this.stack.splice(index, 1)[0]; return null; }
  snapshot() { return Object.freeze({ enabled: this.enabled, depth: this.stack.length, current: this.get() }); }
}

export default ExplicitEventContextManager;
