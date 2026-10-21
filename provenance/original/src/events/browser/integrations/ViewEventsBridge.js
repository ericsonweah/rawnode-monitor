'use strict';

export const VIEW_BROWSER_EVENT_NAMES = Object.freeze([
  'rawnode:view:companion:mounted', 'rawnode:view:companion:error',
  'rawnode:view:runtime:started', 'rawnode:view:runtime:closed',
  'rawnode:view:hydrating', 'rawnode:view:hydrated', 'rawnode:view:hydrated-bindings',
  'rawnode:view:skipped-owner', 'rawnode:view:build-mismatch', 'rawnode:view:hydration-mismatch',
  'rawnode:view:island:loading', 'rawnode:view:island:hydrated', 'rawnode:view:island:error',
  'rawnode:view:scope:active', 'rawnode:view:scope:paused', 'rawnode:view:scope:resumed',
  'rawnode:view:scope:context', 'rawnode:view:scope:disposed', 'rawnode:view:error',
]);

export class ViewEventsBridge {
  constructor(fabric, options = {}) {
    if (!fabric) throw new TypeError('ViewEventsBridge requires an event fabric.');
    this.fabric = fabric;
    this.document = options.document || globalThis.document || null;
    this.events = Object.freeze([...(options.events || VIEW_BROWSER_EVENT_NAMES)]);
    this.listeners = [];
    this.started = false;
    this.stats = { received: 0, forwarded: 0, errors: 0 };
  }
  start() {
    if (this.started || !this.document?.addEventListener) return this;
    this.started = true;
    for (const name of this.events) {
      const listener = (event) => {
        this.stats.received++;
        Promise.resolve(this.fabric.dispatchAsync(name, event?.detail, { context: { source: { runtime: 'browser', integration: 'view' }, nativeEvent: event } }))
          .then(() => { this.stats.forwarded++; }, () => { this.stats.errors++; });
      };
      this.document.addEventListener(name, listener);
      this.listeners.push([name, listener]);
    }
    return this;
  }
  close() { for (const [name, listener] of this.listeners) this.document?.removeEventListener?.(name, listener); this.listeners = []; this.started = false; return this.snapshot(); }
  snapshot() { return Object.freeze({ id: 'view', available: !!this.document, started: this.started, events: this.events.length, stats: { ...this.stats } }); }
}
export default ViewEventsBridge;
