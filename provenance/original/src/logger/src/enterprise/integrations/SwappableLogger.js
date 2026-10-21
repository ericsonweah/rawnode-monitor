'use strict';

const LEVELS = ['emergency','alert','critical','error','urgent','priority','warn','notice','success','info','debug','metric','metrics','important'];

/** Stable bootstrap proxy whose target may be replaced without invalidating DI references. */
export class SwappableLogger {
  constructor(target = null) { this._target = target; }
  swap(target) {
    if (!target || typeof target.log !== 'function') throw new TypeError('SwappableLogger.swap requires a logger-like target.');
    const previous = this._target;
    this._target = target;
    return previous;
  }
  current() { return this._target; }
  log(...args) { return this._target?.log?.(...args); }
  logAsync(...args) { return this._target?.logAsync?.(...args) ?? Promise.resolve(null); }
  isLevelEnabled(level) { return this._target?.isLevelEnabled?.(level) ?? false; }
  child(...args) { return this._target?.child?.(...args) || this; }
  with(...args) { return this._target?.with?.(...args) || this; }
  withTags(...args) { return this._target?.withTags?.(...args) || this; }
  channel(...args) { return this._target?.channel?.(...args) || this; }
  at(...args) { return this._target?.at?.(...args) || this; }
  withError(...args) { return this._target?.withError?.(...args) || this; }
  when(...args) { return this._target?.when?.(...args) || this; }
  sample(...args) { return this._target?.sample?.(...args) || this; }
  once(...args) { return this._target?.once?.(...args) || this; }
  rateLimit(...args) { return this._target?.rateLimit?.(...args) || this; }
  forRequest(...args) { return this._target?.forRequest?.(...args) || this; }
  forJob(...args) { return this._target?.forJob?.(...args) || this; }
  runWithContext(...args) { return this._target?.runWithContext?.(...args); }
  time(...args) { return this._target?.time?.(...args) || Object.freeze({ end: () => null, stop: () => null, cancel() {} }); }
  measure(...args) { return this._target?.measure?.(...args); }
  setLevel(...args) { this._target?.setLevel?.(...args); return this; }
  registerLevel(...args) { this._target?.registerLevel?.(...args); return this; }
  addTransport(...args) { this._target?.addTransport?.(...args); return this; }
  transport(...args) { this._target?.transport?.(...args); return this; }
  processor(...args) { this._target?.processor?.(...args); return this; }
  use(...args) { this._target?.use?.(...args); return this; }
  plugin(...args) { this._target?.plugin?.(...args); return this; }
  ready(...args) { return Promise.resolve(this._target?.ready?.(...args)).then(() => this); }
  flush(...args) { return this._target?.flush?.(...args) ?? Promise.resolve(); }
  reopen(...args) { return this._target?.reopen?.(...args) ?? Promise.resolve(false); }
  close(...args) { return this._target?.close?.(...args) ?? Promise.resolve(); }
  health() { return this._target?.health?.() || { status: 'bootstrap', state: 'initializing', transports: [] }; }
  stats() { return this._target?.stats?.() || { counters: {}, gauges: {}, histograms: {}, transports: [] }; }
  levels() { return this._target?.levels?.() || []; }
  diagnosticsSnapshot() { return this._target?.diagnosticsSnapshot?.() || []; }
  metricsSnapshot() { return this._target?.metricsSnapshot?.() || {}; }
  prometheus(...args) { return this._target?.prometheus?.(...args) || ''; }
  toPrometheus(...args) { return this._target?.toPrometheus?.(...args) || ''; }
}
for (const level of LEVELS) SwappableLogger.prototype[level] = function levelMethod(...args) { return this._target?.[level]?.(...args); };
export default SwappableLogger;
