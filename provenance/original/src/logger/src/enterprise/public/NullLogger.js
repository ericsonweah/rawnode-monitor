'use strict';

/** A complete no-op logger that is API-compatible with LoggerRuntime. */
export class NullLogger {
  log() { return false; }
  logAsync() { return Promise.resolve(null); }
  submit() { return { accepted: false, promise: Promise.resolve(null) }; }
  isLevelEnabled() { return false; }
  setLevel() { return this; }
  registerLevel() { return this; }
  addTransport() { return this; }
  transport() { return this; }
  removeTransport() { return null; }
  use() { return this; }
  processor() { return this; }
  plugin() { return this; }
  child() { return this; }
  with() { return this; }
  withTags() { return this; }
  channel() { return this; }
  at() { return this; }
  sample() { return this; }
  withError() { return this; }
  when() { return this; }
  once() { return this; }
  rateLimit() { return this; }
  clearOnce() { return this; }
  resetRateLimits() { return this; }
  forRequest() { return this; }
  forJob() { return this; }
  runWithContext(_context, callback, ...args) { return callback(...args); }
  getContext() { return Object.freeze({}); }
  time() { return Object.freeze({ end: () => null, stop: () => null, cancel: () => {} }); }
  async measure(_label, operation) { return await operation(); }
  ready() { return Promise.resolve(this); }
  flush() { return Promise.resolve(); }
  reopen() { return Promise.resolve(false); }
  close() { return Promise.resolve(); }
  destroy() { return Promise.resolve(); }
  health() { return { status: 'disabled', state: 'closed', transports: [] }; }
  stats() { return { status: 'disabled', counters: {}, gauges: {}, histograms: {}, transports: [], processors: [], plugins: [] }; }
  metricsSnapshot() { return { enabled: false, counters: {}, gauges: {}, histograms: {} }; }
  diagnosticsSnapshot() { return []; }
  levels() { return []; }
  prometheus() { return ''; }
  toPrometheus() { return ''; }
}

for (const level of ['emergency','alert','critical','error','urgent','priority','warn','notice','success','info','debug','metric','metrics','important']) {
  NullLogger.prototype[level] = function nullLevel() { return false; };
}

export const nullLogger = new NullLogger();
export default NullLogger;
