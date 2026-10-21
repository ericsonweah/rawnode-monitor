'use strict';

const PATCH = Symbol.for('rawnode.events.reactive.patch');

/**
 * Reversibly instruments the existing Reactive EventBus. It never changes the
 * return value, listener order, error handling, or synchronous behavior of the
 * original emit()/emitAsync() methods.
 */
export class ReactiveEventsBridge {
  constructor(fabric, options = {}) {
    if (!fabric) throw new TypeError('ReactiveEventsBridge requires an event fabric.');
    this.fabric = fabric;
    this.runtime = options.runtime || globalThis.RawNode?.reactive || globalThis.rawnode?.reactive || globalThis.RawNodeReactive || null;
    this.bus = options.bus || locateBus(this.runtime);
    this.prefix = options.prefix || '';
    this.started = false;
    this.depth = 0;
    this.stats = { emitted: 0, asyncEmitted: 0, forwarded: 0, errors: 0 };
  }
  start() {
    if (this.started || !this.bus || this.bus[PATCH]) return this;
    const emit = typeof this.bus.emit === 'function' ? this.bus.emit.bind(this.bus) : null;
    const emitAsync = typeof this.bus.emitAsync === 'function' ? this.bus.emitAsync.bind(this.bus) : null;
    if (!emit && !emitAsync) return this;
    const bridge = this;
    const descriptor = { emit, emitAsync };
    Object.defineProperty(this.bus, PATCH, { value: descriptor, configurable: true });
    if (emit) this.bus.emit = function patchedReactiveEmit(name, ...args) {
      const result = emit(name, ...args);
      bridge.stats.emitted++;
      bridge.forward(name, args);
      return result;
    };
    if (emitAsync) this.bus.emitAsync = async function patchedReactiveEmitAsync(name, ...args) {
      const result = await emitAsync(name, ...args);
      bridge.stats.asyncEmitted++;
      await bridge.forward(name, args, true);
      return result;
    };
    this.started = true;
    return this;
  }
  forward(name, args, awaitResult = false) {
    if (this.depth) return undefined;
    this.depth++;
    try {
      const eventName = this.prefix ? `${this.prefix}${name}` : String(name);
      const payload = args.length <= 1 ? args[0] : args;
      const operation = this.fabric.dispatchAsync(eventName, payload, { context: { source: { runtime: 'browser', integration: 'reactive' } } });
      if (awaitResult) return Promise.resolve(operation).then((value) => { this.stats.forwarded++; return value; }, (error) => { this.stats.errors++; throw error; }).finally(() => { this.depth--; });
      Promise.resolve(operation).then(() => { this.stats.forwarded++; }, () => { this.stats.errors++; });
      return operation;
    } finally { if (!awaitResult) this.depth--; }
  }
  close() {
    const original = this.bus?.[PATCH];
    if (original) {
      if (original.emit) this.bus.emit = original.emit;
      if (original.emitAsync) this.bus.emitAsync = original.emitAsync;
      try { delete this.bus[PATCH]; } catch {}
    }
    this.started = false;
    return this.snapshot();
  }
  snapshot() { return Object.freeze({ id: 'reactive', available: !!this.bus, started: this.started, stats: { ...this.stats } }); }
}
function locateBus(runtime) {
  const candidates = [runtime?.events, runtime?.eventBus, runtime?.bus, runtime?.lifecycle, runtime];
  return candidates.find((value) => value && (typeof value.emit === 'function' || typeof value.emitAsync === 'function')) || null;
}
export default ReactiveEventsBridge;
