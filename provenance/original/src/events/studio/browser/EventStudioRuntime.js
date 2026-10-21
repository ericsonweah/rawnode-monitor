'use strict';

export class EventStudioRuntime {
  constructor(options = {}) {
    this.fabric = options.fabric || globalThis.RawNode?.eventFabric || globalThis.RawNode?.events?.fabric?.() || null;
    this.historyLimit = Math.max(10, Number(options.historyLimit) || 1_000);
    this.records = [];
    this.subscriptions = [];
    this.started = false;
  }
  start() {
    if (this.started || !this.fabric) return this;
    this.started = true;
    const bus = this.fabric.dispatcher;
    if (typeof bus?.subscribeAny === 'function') this.subscriptions.push(bus.subscribeAny((eventName, ...args) => this.record(eventName, args)) || null);
    else if (typeof bus?.onAny === 'function') this.subscriptions.push(bus.onAny((eventName, ...args) => this.record(eventName, args)) || null);
    return this;
  }
  record(name, args = []) { this.records.push({ name: String(name), args: summarize(args), at: Date.now(), context: summarize(this.fabric?.getContext?.()) }); if (this.records.length > this.historyLimit) this.records.splice(0, this.records.length - this.historyLimit); }
  snapshot() { return Object.freeze({ started: this.started, fabric: this.fabric?.snapshot?.() || null, records: Object.freeze([...this.records]) }); }
  stop() { for (const value of this.subscriptions.splice(0)) { try { if (typeof value === 'function') value(); else value?.dispose?.(); } catch {} } this.started = false; return this; }
}
function summarize(value, depth = 0) { if (value == null || typeof value !== 'object') return value; if (depth >= 4) return '[depth]'; if (Array.isArray(value)) return value.slice(0, 20).map((entry) => summarize(entry, depth + 1)); const output = {}; for (const [key, child] of Object.entries(value).slice(0, 50)) output[key] = /secret|token|password|cookie|authorization/i.test(key) ? '[redacted]' : summarize(child, depth + 1); return output; }
export default EventStudioRuntime;
