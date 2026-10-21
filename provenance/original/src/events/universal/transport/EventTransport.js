'use strict';

import { deepFreeze } from '../support/safe.js';

export const EVENT_TRANSPORT_CAPABILITIES = Object.freeze({
  local: false,
  remote: true,
  ordered: false,
  orderedByPartition: false,
  acknowledged: false,
  durable: false,
  fanout: false,
  binary: false,
  requestReply: false,
  browser: false,
  server: false,
  maxPacketBytes: 0,
});

export class EventTransport {
  constructor(id, options = {}) {
    const value = String(id || options.id || '').trim();
    if (!value) throw new TypeError('Event transport id is required.');
    this.id = value;
    this.options = options;
    this.state = 'idle';
    this.startedAt = 0;
    this.lastError = null;
    this.stats = { published: 0, received: 0, rejected: 0, errors: 0, bytesOut: 0, bytesIn: 0, starts: 0, closes: 0 };
    this._capabilities = deepFreeze({ ...EVENT_TRANSPORT_CAPABILITIES, ...(options.capabilities || {}) });
  }
  capabilities() { return this._capabilities; }
  async start() { if (this.state === 'started') return this; if (this.state === 'closed') throw transportError(`Transport '${this.id}' is closed.`, 'EVENT_TRANSPORT_CLOSED'); this.state = 'started'; this.startedAt ||= Date.now(); this.stats.starts++; return this; }
  subscribe() { return () => {}; }
  async publish() { throw transportError(`Transport '${this.id}' does not implement publish().`, 'EVENT_TRANSPORT_NOT_IMPLEMENTED'); }
  async flush() { return true; }
  health() { return deepFreeze({ ok: this.state !== 'failed' && this.state !== 'closed', ready: this.state === 'started', state: this.state, id: this.id, uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0, capabilities: this.capabilities(), stats: { ...this.stats }, lastError: this.lastError }); }
  diagnostics() { return this.health(); }
  async close() { if (this.state === 'closed') return this.health(); this.state = 'closed'; this.stats.closes++; return this.health(); }
  async [Symbol.asyncDispose]() { await this.close(); }
  _error(error) { this.stats.errors++; this.lastError = { at: Date.now(), name: error?.name || 'Error', message: error?.message || String(error), code: error?.code || null }; this.state = 'failed'; return error; }
}
export function transportError(message, code = 'EVENT_TRANSPORT_ERROR', options = {}) { return Object.assign(new Error(message), { name: 'EventTransportError', code, retryable: options.retryable === true, details: options.details || null, cause: options.cause }); }
export default EventTransport;
