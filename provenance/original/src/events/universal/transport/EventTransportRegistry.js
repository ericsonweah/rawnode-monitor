'use strict';

import { deepFreeze } from '../support/safe.js';

export class EventTransportRegistry {
  constructor(options = {}) { this.maxTransports = Math.max(1, Number(options.maxTransports) || 128); this.transports = new Map(); this.owned = new Set(); this.frozen = false; this.generation = 0; }
  register(transport, options = {}) {
    if (this.frozen) throw registryError('Event transport registration is frozen.', 'EVENT_TRANSPORTS_FROZEN');
    if (!transport?.id || typeof transport.publish !== 'function') throw new TypeError('Event transport must expose id and publish().');
    const id = String(options.id || transport.id);
    if (this.transports.has(id) && options.replace !== true) throw registryError(`Event transport already exists: ${id}`, 'EVENT_TRANSPORT_DUPLICATE');
    if (!this.transports.has(id) && this.transports.size >= this.maxTransports) throw registryError('Event transport limit exceeded.', 'EVENT_TRANSPORT_LIMIT');
    this.transports.set(id, transport); if (options.owned !== false) this.owned.add(id); else this.owned.delete(id); this.generation++; return transport;
  }
  get(id) { return this.transports.get(String(id)) || null; }
  require(id) { const value = this.get(id); if (!value) throw registryError(`Unknown event transport: ${id}`, 'EVENT_TRANSPORT_UNKNOWN'); return value; }
  has(id) { return this.transports.has(String(id)); }
  remove(id) { if (this.frozen) throw registryError('Event transport registration is frozen.', 'EVENT_TRANSPORTS_FROZEN'); const key = String(id); const value = this.transports.get(key); this.transports.delete(key); this.owned.delete(key); if (value) this.generation++; return value || null; }
  names() { return [...this.transports.keys()]; }
  all() { return [...this.transports.values()]; }
  freeze() { this.frozen = true; return this; }
  unfreeze() { this.frozen = false; return this; }
  async startAll(context = {}) { const results = []; for (const transport of this.transports.values()) results.push(await transport.start?.(context) || transport); return results; }
  async close(options = {}) { const results = []; for (const [id, transport] of [...this.transports].reverse()) { if (!this.owned.has(id) && options.closeExternal !== true) continue; try { results.push(await transport.close?.(options)); } catch (error) { results.push({ id, error }); } } return results; }
  snapshot() { return deepFreeze({ frozen: this.frozen, generation: this.generation, maxTransports: this.maxTransports, transports: Object.fromEntries([...this.transports].map(([id, transport]) => [id, transport.health?.() || { id, state: transport.state || 'unknown', capabilities: transport.capabilities?.() || null }])) }); }
}
function registryError(message, code) { return Object.assign(new Error(message), { name: 'EventTransportRegistryError', code }); }
export default EventTransportRegistry;
