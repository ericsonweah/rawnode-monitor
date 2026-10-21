'use strict';

import { SignalKind } from '../constants.js';

/** Passive event observer; it does not replace or wrap dispatcher methods. */
export class EventMonitorBridge {
  constructor(events, monitor, options = {}) {
    this.events = events; this.monitor = monitor; this.options = options;
    this.include = options.include || ['**']; this.exclude = options.exclude || ['monitor:**', 'logger:**'];
    this.maxPayloadBytes = Math.max(1_024, Number(options.maxPayloadBytes) || 128 * 1024);
    this.unsubscribe = null; this.started = false; this.stats = { observed: 0, excluded: 0, rejected: 0 };
    this.metric = monitor.metrics.counter('events_observed_total');
  }
  start() {
    if (this.started || !this.events) return this;
    const handler = (...args) => this._observe(...args);
    if (typeof this.events.onAny === 'function') this.unsubscribe = normalizeUnsubscribe(this.events.onAny(handler), () => this.events.offAny?.(handler));
    else if (typeof this.events.onPattern === 'function') this.unsubscribe = normalizeUnsubscribe(this.events.onPattern('**', handler), () => this.events.offPattern?.('**', handler));
    else if (typeof this.events.on === 'function' && Array.isArray(this.options.names)) {
      for (const name of this.options.names) this.events.on(name, (...args) => this._observe(name, ...args));
      this.unsubscribe = () => {};
    }
    this.started = true; return this;
  }
  _observe(name, ...args) {
    const event = typeof name === 'string' ? name : name?.name || name?.event || 'event';
    if (!allowed(event, this.include, this.exclude)) { this.stats.excluded++; return; }
    const context = this.monitor.context.active();
    const payload = this.monitor.serializer.sanitize(args.length <= 1 ? args[0] : args, { maxPayloadBytes: this.maxPayloadBytes });
    const result = this.monitor.emitSignal(SignalKind.EVENT, { name: event, payload }, { context, attributes: { source: 'events' } });
    this.metric.inc({ event: normalizeEventLabel(event) }, { context });
    this.stats.observed++; if (result?.accepted === false) this.stats.rejected++;
  }
  async close() { try { await this.unsubscribe?.(); } catch {} this.unsubscribe = null; this.started = false; }
  snapshot() { return Object.freeze({ started: this.started, stats: Object.freeze({ ...this.stats }) }); }
}
function normalizeUnsubscribe(result, fallback) { return typeof result === 'function' ? result : result?.unsubscribe ? () => result.unsubscribe() : fallback; }
function allowed(name, include, exclude) { return include.some((pattern) => match(pattern, name)) && !exclude.some((pattern) => match(pattern, name)); }
function match(pattern, value) { if (pattern instanceof RegExp) return pattern.test(value); const text = String(pattern); if (text === '**' || text === '*') return true; if (text.endsWith('**')) return value.startsWith(text.slice(0, -2)); if (text.endsWith('*')) return value.startsWith(text.slice(0, -1)); return value === text; }
function normalizeEventLabel(value) { return String(value).replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 128); }
export default EventMonitorBridge;
