'use strict';

const DEFAULT_EVENTS = Object.freeze([
  'sdspa:navigation:before', 'sdspa:navigation:started', 'sdspa:navigation:fetched',
  'sdspa:navigation:validated', 'sdspa:assets:prepared', 'sdspa:page:leaving',
  'sdspa:dom:committed', 'sdspa:page:activating', 'sdspa:navigation:ready',
  'sdspa:navigation:cancelled', 'sdspa:navigation:error',
]);
const MARK = '__rawnodeUniversalEventFabric';

/** Preserve SDSPA CustomEvents while exposing them on the canonical event bus. */
export class SdspaEventsBridge {
  constructor(fabric, options = {}) {
    if (!fabric) throw new TypeError('SdspaEventsBridge requires an event fabric.');
    this.fabric = fabric;
    this.document = options.document || globalThis.document || null;
    this.events = Object.freeze([...(options.events || DEFAULT_EVENTS)]);
    this.mirrorToDocument = options.mirrorToDocument === true;
    this.listeners = [];
    this.reverse = [];
    this.started = false;
    this.stats = { received: 0, forwarded: 0, reverseForwarded: 0, ignored: 0, errors: 0 };
  }
  start() {
    if (this.started || !this.document?.addEventListener) return this;
    this.started = true;
    for (const name of this.events) {
      const listener = (event) => {
        if (event?.detail?.[MARK]) { this.stats.ignored++; return; }
        this.stats.received++;
        Promise.resolve(this.fabric.dispatchAsync(name, event?.detail, {
          context: { source: { runtime: 'browser', integration: 'sdspa' }, nativeEvent: event },
        })).then(() => { this.stats.forwarded++; }, () => { this.stats.errors++; });
      };
      this.document.addEventListener(name, listener);
      this.listeners.push([name, listener]);
      if (this.mirrorToDocument && this.fabric.dispatcher?.subscribe) {
        const handle = this.fabric.dispatcher.subscribe(name, (payload) => {
          if (typeof CustomEvent !== 'function') return;
          const detail = payload && typeof payload === 'object' ? { ...payload, [MARK]: true } : { value: payload, [MARK]: true };
          this.stats.reverseForwarded++;
          this.document.dispatchEvent(new CustomEvent(name, { detail }));
        }, { tag: 'rawnode-events:sdspa-bridge', priority: -10_000 });
        this.reverse.push(handle);
      }
    }
    return this;
  }
  close() {
    for (const [name, listener] of this.listeners) this.document?.removeEventListener?.(name, listener);
    for (const handle of this.reverse) handle?.dispose?.();
    this.listeners = [];
    this.reverse = [];
    this.started = false;
    return this.snapshot();
  }
  snapshot() { return Object.freeze({ id: 'sdspa', available: !!this.document, started: this.started, events: this.events.length, mirrorToDocument: this.mirrorToDocument, stats: { ...this.stats } }); }
}
export { DEFAULT_EVENTS as SDSPA_EVENT_NAMES };
export default SdspaEventsBridge;
