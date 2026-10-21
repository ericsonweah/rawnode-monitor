'use strict';

const BRIDGE_MARK = Symbol.for('rawnode.events.live.bridge');

/**
 * Mirrors RawNode Live lifecycle events into the Universal Event Fabric without
 * replacing LiveLifecycleBus or changing any existing listener semantics.
 */
export class LiveEventsBridge {
  constructor(fabric, options = {}) {
    if (!fabric) throw new TypeError('LiveEventsBridge requires an event fabric.');
    this.fabric = fabric;
    this.runtime = options.runtime || globalThis.RawNodeLive || globalThis.rawnodeLive || globalThis.RawNode?.live || globalThis.rawnode?.live || null;
    this.prefix = options.prefix || '';
    this.include = compileList(options.include || ['**']);
    this.exclude = compileList(options.exclude || ['rawnode:event']);
    this.mirrorToLive = options.mirrorToLive === true;
    this.started = false;
    this.forwarding = 0;
    this.off = null;
    this.reverseHandle = null;
    this.stats = { received: 0, forwarded: 0, reverseForwarded: 0, ignored: 0, errors: 0 };
  }

  start() {
    if (this.started) return this;
    const lifecycle = this.runtime?.Browser?.lifecycle || this.runtime?.browser?.lifecycle || this.runtime?.lifecycle || null;
    if (!lifecycle?.on) return this;
    this.started = true;
    const handler = (payload, envelope = {}) => {
      const name = String(envelope.event || envelope.name || payload?.event || 'live:event');
      if (payload?.[BRIDGE_MARK] || !this.accepts(name)) { this.stats.ignored++; return; }
      this.stats.received++;
      this.forwarding++;
      try {
        const eventName = this.prefix ? `${this.prefix}${name}` : name;
        const value = this.fabric.dispatchAsync(eventName, payload, {
          context: { source: { runtime: 'browser', integration: 'live' }, nativeEvent: envelope },
        });
        Promise.resolve(value).then(() => { this.stats.forwarded++; }, () => { this.stats.errors++; });
      } finally { this.forwarding--; }
    };
    this.off = lifecycle.on('*', handler, { priority: -10_000 });

    if (this.mirrorToLive && this.fabric.dispatcher?.subscribeAny) {
      this.reverseHandle = this.fabric.dispatcher.subscribeAny((name, payload) => {
        if (this.forwarding || !this.accepts(name)) return;
        const mirrored = markPayload(payload);
        this.stats.reverseForwarded++;
        return lifecycle.emit?.(name, mirrored, { clone: false });
      }, { tag: 'rawnode-events:live-bridge', priority: -10_000 });
    }
    return this;
  }

  accepts(name) {
    return this.include.some((match) => match(name)) && !this.exclude.some((match) => match(name));
  }

  close() {
    try { this.off?.(); } catch {}
    try { this.reverseHandle?.dispose?.(); } catch {}
    this.off = null;
    this.reverseHandle = null;
    this.started = false;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({ id: 'live', available: !!this.runtime, started: this.started, mirrorToLive: this.mirrorToLive, stats: { ...this.stats } });
  }
}

function markPayload(payload) {
  if (!payload || typeof payload !== 'object') return { value: payload, [BRIDGE_MARK]: true };
  try { return Object.assign(Array.isArray(payload) ? [...payload] : { ...payload }, { [BRIDGE_MARK]: true }); }
  catch { return { value: payload, [BRIDGE_MARK]: true }; }
}
function compileList(patterns) { return (Array.isArray(patterns) ? patterns : [patterns]).map((pattern) => compileGlob(String(pattern))); }
function compileGlob(pattern) {
  if (pattern === '*' || pattern === '**') return () => true;
  const source = pattern.split('**').map((part) => part.split('*').map(escape).join('[^:]*')).join('.*');
  const regex = new RegExp(`^${source}$`);
  return (value) => regex.test(String(value));
}
function escape(value) { return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }
export default LiveEventsBridge;
