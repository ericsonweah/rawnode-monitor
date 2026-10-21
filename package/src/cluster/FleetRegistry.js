'use strict';

import { EventEmitter } from 'node:events';
import { deepFreeze } from '../support.js';

export class FleetRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    this.leaseMs = Math.max(2_000, Number(options.leaseMs) || 30_000);
    this.maxInstances = Math.max(1, Number(options.maxInstances) || 100_000);
    this.instances = new Map();
    this.stats = { heartbeats: 0, joined: 0, left: 0, expired: 0, rejected: 0 };
  }

  heartbeat(input = {}) {
    const id = String(input.instanceId || input.id || '');
    if (!id) throw new TypeError('Fleet heartbeat requires instanceId.');
    const existing = this.instances.get(id);
    if (!existing && this.instances.size >= this.maxInstances) { this.stats.rejected++; return false; }
    const now = Number(input.timestamp || Date.now());
    const record = {
      instanceId: id,
      service: input.service || null,
      environment: input.environment || null,
      host: input.host || input.hostname || null,
      pid: input.pid || null,
      region: input.region || null,
      zone: input.zone || null,
      version: input.version || null,
      state: input.state || 'running',
      health: input.health || null,
      metadata: input.metadata || null,
      firstSeenAt: existing?.firstSeenAt || now,
      lastSeenAt: now,
      expiresAt: Number(input.expiresAt || now + this.leaseMs),
    };
    this.instances.set(id, record);
    this.stats.heartbeats++;
    if (!existing) { this.stats.joined++; this.emit('joined', deepFreeze({ ...record })); }
    this.emit('heartbeat', deepFreeze({ ...record }));
    return true;
  }

  leave(instanceId, reason = 'graceful') {
    const record = this.instances.get(String(instanceId));
    if (!record) return false;
    this.instances.delete(String(instanceId)); this.stats.left++;
    this.emit('left', deepFreeze({ ...record, reason, leftAt: Date.now() }));
    return true;
  }

  prune(now = Date.now()) {
    const expired = [];
    for (const [id, record] of this.instances) {
      if (record.expiresAt > now) continue;
      this.instances.delete(id); this.stats.expired++; expired.push({ ...record, expiredAt: now });
    }
    for (const record of expired) this.emit('expired', deepFreeze(record));
    return expired.length;
  }

  get(instanceId) { const value = this.instances.get(String(instanceId)); return value ? deepFreeze({ ...value }) : null; }
  list(options = {}) {
    this.prune();
    let rows = Array.from(this.instances.values());
    if (options.service) rows = rows.filter((row) => row.service === options.service);
    if (options.environment) rows = rows.filter((row) => row.environment === options.environment);
    if (options.region) rows = rows.filter((row) => row.region === options.region);
    if (options.healthy != null) rows = rows.filter((row) => Boolean(row.health?.ok ?? row.health?.healthy) === Boolean(options.healthy));
    rows.sort((a, b) => a.service?.localeCompare?.(b.service || '') || a.instanceId.localeCompare(b.instanceId));
    return deepFreeze(rows.slice(0, Math.max(1, Number(options.limit) || 10_000)).map((row) => ({ ...row })));
  }
  topology() {
    const services = Object.create(null);
    for (const item of this.list()) {
      const key = item.service || 'unknown';
      const service = services[key] ||= { instances: 0, healthy: 0, degraded: 0, unhealthy: 0, regions: Object.create(null), versions: Object.create(null) };
      service.instances++;
      const state = item.health?.ok === false ? 'unhealthy' : item.health?.degraded ? 'degraded' : 'healthy';
      service[state]++;
      const region = item.region || 'unknown'; service.regions[region] = (service.regions[region] || 0) + 1;
      const version = item.version || 'unknown'; service.versions[version] = (service.versions[version] || 0) + 1;
    }
    return deepFreeze({ timestamp: Date.now(), totalInstances: this.instances.size, services });
  }
  snapshot() { return deepFreeze({ leaseMs: this.leaseMs, instances: this.list(), topology: this.topology(), stats: { ...this.stats } }); }
}
export default FleetRegistry;
