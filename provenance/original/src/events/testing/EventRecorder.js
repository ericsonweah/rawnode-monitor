'use strict';

import { compileMatcherList, matchesAny } from '../support/glob.js';

export class EventRecorder {
  constructor(dispatcher = null, options = {}) {
    this.dispatcher = dispatcher;
    this.maxItems = Math.max(1, Number(options.maxItems) || 10_000);
    this.allow = compileMatcherList(options.allow || []);
    this.deny = compileMatcherList(options.deny || []);
    this.records = [];
    this.handle = null;
    this.dropped = 0;
    if (dispatcher && options.autoStart !== false) this.start();
  }

  start(dispatcher = this.dispatcher) {
    if (this.handle) return this;
    if (!dispatcher) throw new TypeError('EventRecorder requires a dispatcher');
    this.dispatcher = dispatcher;
    const listener = (eventName, ...args) => this.record(eventName, args, dispatcher.getContext?.());
    if (typeof dispatcher.subscribeAny === 'function') {
      this.handle = dispatcher.subscribeAny(listener, {
        priority: Number.MAX_SAFE_INTEGER,
        owner: 'rawnode:events:test-recorder',
        tags: ['testing', 'recorder'],
      });
    } else {
      dispatcher.onAny(listener, { priority: Number.MAX_SAFE_INTEGER });
      this.handle = { dispose: () => dispatcher.offAny?.(listener) };
    }
    return this;
  }

  record(eventName, args = [], context = null) {
    const name = String(eventName);
    if (this.allow.length && !matchesAny(this.allow, name)) return false;
    if (this.deny.length && matchesAny(this.deny, name)) return false;
    if (this.records.length >= this.maxItems) { this.records.shift(); this.dropped++; }
    this.records.push({ eventName: name, args: Array.isArray(args) ? args : [args], context: context ? { ...context } : null, ts: Date.now() });
    return true;
  }

  all(eventName = null) {
    return (eventName == null ? this.records : this.records.filter((record) => record.eventName === String(eventName))).slice();
  }
  count(eventName = null) { return this.all(eventName).length; }
  has(eventName, predicate = null) {
    return this.records.some((record) => record.eventName === String(eventName) && (!predicate || predicate(...record.args, record)));
  }
  last(eventName = null) { const records = this.all(eventName); return records.at(-1) || null; }
  clear() { const count = this.records.length; this.records.length = 0; return count; }
  stop() { this.handle?.dispose?.(); this.handle = null; return this; }
  snapshot() { return Object.freeze({ count: this.records.length, dropped: this.dropped, records: Object.freeze(this.records.slice()) }); }
  [Symbol.dispose]() { this.stop(); }
  async [Symbol.asyncDispose]() { this.stop(); }
}

export default EventRecorder;
