'use strict';

import { globToRegExp } from '../../support/glob.js';
import { deepFreeze } from '../support/safe.js';

const PHASES = new Set(['beforeEnvelope', 'beforeDispatch', 'beforeHandler', 'afterHandler', 'onHandlerError', 'afterDispatch', 'beforePublish', 'afterPublish', 'onTransportError', 'inbound']);

export class EventMiddlewarePipeline {
  constructor(options = {}) {
    this.maxMiddleware = Math.max(1, Number(options.maxMiddleware) || 10_000);
    this.errorPolicy = options.errorPolicy || 'propagate';
    this.entries = new Map();
    this.sequence = 0;
    this.generation = 0;
    this.cache = new Map();
    this.frozen = false;
  }

  use(phase, middleware, options = {}) {
    const name = String(phase);
    if (!PHASES.has(name)) throw new TypeError(`Unsupported event middleware phase '${name}'.`);
    if (typeof middleware !== 'function' && typeof middleware?.handle !== 'function') throw new TypeError('Event middleware must be a function or expose handle().');
    if (this.frozen) throw Object.assign(new Error('Event middleware registration is frozen.'), { code: 'EVENT_MIDDLEWARE_FROZEN' });
    if (this.size >= this.maxMiddleware) throw Object.assign(new Error('Event middleware limit exceeded.'), { code: 'EVENT_MIDDLEWARE_LIMIT' });
    const event = options.event || options.pattern || '**';
    const entry = {
      id: `middleware-${++this.sequence}`,
      phase: name,
      middleware,
      priority: Number(options.priority) || 0,
      order: this.sequence,
      event: String(event),
      matcher: globToRegExp(String(event)),
      transport: options.transport == null ? null : String(options.transport),
      audience: options.audience == null ? null : String(options.audience),
      owner: options.owner == null ? null : String(options.owner),
      tags: [...new Set((Array.isArray(options.tags) ? options.tags : options.tag ? [options.tag] : []).map(String))],
      active: true,
    };
    const list = this.entries.get(name) || [];
    list.push(entry); list.sort((a, b) => b.priority - a.priority || a.order - b.order);
    this.entries.set(name, list); this._touch();
    return Object.freeze({ id: entry.id, dispose: () => this.remove(entry.id), [Symbol.dispose]: () => this.remove(entry.id) });
  }

  remove(id) { for (const [phase, list] of this.entries) { const index = list.findIndex((entry) => entry.id === id); if (index !== -1) { list[index].active = false; list.splice(index, 1); if (!list.length) this.entries.delete(phase); this._touch(); return true; } } return false; }
  removeOwner(owner) { let removed = 0; for (const list of this.entries.values()) for (const entry of [...list]) if (entry.owner === String(owner) && this.remove(entry.id)) removed++; return removed; }
  removeTag(tag) { let removed = 0; for (const list of this.entries.values()) for (const entry of [...list]) if (entry.tags.includes(String(tag)) && this.remove(entry.id)) removed++; return removed; }
  get size() { let total = 0; for (const list of this.entries.values()) total += list.length; return total; }
  freeze() { this.frozen = true; return this; }
  unfreeze() { this.frozen = false; return this; }
  _touch() { this.generation++; this.cache.clear(); }

  plan(phase, context = {}) {
    const eventName = String(context.eventName || context.name || '*');
    const transport = context.transport?.id || context.transport || null;
    const audience = context.audience || context.routing?.audience || null;
    const key = `${this.generation}:${phase}:${eventName}:${transport || ''}:${audience || ''}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const plan = Object.freeze((this.entries.get(String(phase)) || []).filter((entry) => entry.active && entry.matcher.test(eventName) && (!entry.transport || entry.transport === transport) && (!entry.audience || entry.audience === audience)));
    if (this.cache.size > 4_096) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, plan);
    return plan;
  }

  async run(phase, context, destination = null) {
    const plan = this.plan(phase, context);
    let index = -1;
    const invoke = async (cursor) => {
      if (cursor <= index) throw Object.assign(new Error('Event middleware called next() more than once.'), { code: 'EVENT_MIDDLEWARE_NEXT_MULTIPLE' });
      index = cursor;
      const entry = plan[cursor];
      if (!entry) return destination ? await destination(context) : context;
      const handler = typeof entry.middleware === 'function' ? entry.middleware : entry.middleware.handle.bind(entry.middleware);
      try { return await handler(context, () => invoke(cursor + 1)); }
      catch (error) {
        if (this.errorPolicy === 'isolate') { context.middlewareErrors ||= []; context.middlewareErrors.push({ id: entry.id, error }); return invoke(cursor + 1); }
        throw error;
      }
    };
    return invoke(0);
  }

  snapshot() { return deepFreeze({ frozen: this.frozen, size: this.size, generation: this.generation, phases: Object.fromEntries([...this.entries].map(([phase, list]) => [phase, list.map(({ middleware, matcher, ...entry }) => ({ ...entry, name: middleware.name || middleware.constructor?.name || 'anonymous' }))])) }); }
}

export default EventMiddlewarePipeline;
