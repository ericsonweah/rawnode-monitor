'use strict';

import { SignalKind } from '../constants.js';
import { errorRecord } from '../support.js';

/** Passive EventEmitter bridge for WS/TCP/UDP/Unified lifecycle telemetry. */
export class ProtocolMonitorBridge {
  constructor(protocol, monitor, options = {}) {
    this.protocol = protocol; this.monitor = monitor; this.name = options.name || 'protocol'; this.options = options;
    this.events = options.events || ['connection', 'disconnect', 'close', 'error', 'message', 'packet', 'sendError', 'rejected', 'upgrade'];
    this.listeners = []; this.started = false;
    this.counter = monitor.metrics.counter(`${this.name}_events_total`);
  }
  start() {
    if (this.started || typeof this.protocol?.on !== 'function') return this;
    for (const event of this.events) {
      const listener = (...args) => this.observe(event, args);
      this.protocol.on(event, listener); this.listeners.push([event, listener]);
    }
    this.started = true; return this;
  }
  observe(event, args) {
    const isError = event === 'error' || event.endsWith('Error');
    this.counter.inc({ event, outcome: isError ? 'error' : 'ok' });
    const payload = isError ? { error: errorRecord(args[0]) } : this.monitor.serializer.sanitize(summarize(args), { maxPayloadBytes: this.options.maxPayloadBytes || 64 * 1024 });
    this.monitor.emitSignal(SignalKind.EVENT, { name: `${this.name}.${event}`, payload }, { attributes: { protocol: this.name }, priority: isError ? 10 : 0 });
  }
  async close() { for (const [event, listener] of this.listeners) this.protocol?.off?.(event, listener); this.listeners = []; this.started = false; }
  snapshot() { return Object.freeze({ name: this.name, started: this.started, events: Object.freeze([...this.events]) }); }
}
function summarize(args) { return args.slice(0, 4).map((value) => { if (value == null || typeof value !== 'object') return value; return { id: value.id || value.connectionId || value.socketId || null, type: value.type || value.event || value.constructor?.name || 'object', bytes: value.byteLength || value.length || value.bytes || null, address: value.address || value.remoteAddress || value.socket?.remoteAddress || null }; }); }
export default ProtocolMonitorBridge;
