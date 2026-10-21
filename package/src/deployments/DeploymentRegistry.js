'use strict';

import { SignalKind } from '../constants.js';
import { deepFreeze, randomId, sha256 } from '../support.js';

export class DeploymentRegistry {
  constructor(options = {}) { this.signal = options.signal || null; this.limit = Math.max(1, Number(options.limit) || 1_000); this.deployments = []; this.current = null; this.stats = { recorded: 0, rollbacks: 0 }; }
  record(input = {}) {
    const record = deepFreeze({ id: input.id || randomId('deploy'), service: input.service || null, environment: input.environment || null, version: input.version || null, commit: input.commit || input.gitSha || null, buildId: input.buildId || null, instanceId: input.instanceId || null, region: input.region || null, actor: input.actor || null, strategy: input.strategy || null, status: input.status || 'deployed', metadata: input.metadata || null, fingerprint: input.fingerprint || sha256({ version: input.version, commit: input.commit || input.gitSha, buildId: input.buildId }), deployedAt: Number(input.deployedAt || Date.now()) });
    this.deployments.push(record); if (this.deployments.length > this.limit) this.deployments.splice(0, this.deployments.length - this.limit); this.current = record; this.stats.recorded++;
    if (record.status === 'rolled_back') this.stats.rollbacks++;
    this.signal?.(SignalKind.DEPLOYMENT, record, { priority: record.status === 'failed' ? 20 : 5 });
    return record;
  }
  latest() { return this.current; }
  around(timestamp = Date.now(), options = {}) { const at = Number(timestamp) || Date.now(); const windowMs = Math.max(0, Number(options.windowMs) || 15 * 60_000); const rows = this.deployments.filter((item) => Math.abs(item.deployedAt - at) <= windowMs).sort((left, right) => Math.abs(left.deployedAt - at) - Math.abs(right.deployedAt - at)); return deepFreeze(rows.slice(0, Math.max(1, Number(options.limit) || 20))); }
  list(options = {}) { let rows = [...this.deployments]; if (options.service) rows = rows.filter((row) => row.service === options.service); if (options.environment) rows = rows.filter((row) => row.environment === options.environment); return deepFreeze(rows.sort((a, b) => b.deployedAt - a.deployedAt).slice(0, Math.max(1, Number(options.limit) || 100))); }
  compare(leftId, rightId) { const left = this.deployments.find((item) => item.id === leftId); const right = this.deployments.find((item) => item.id === rightId); if (!left || !right) return null; return deepFreeze({ left, right, changed: Object.fromEntries(Object.keys({ ...left, ...right }).filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key])).map((key) => [key, { left: left[key], right: right[key] }])) }); }
  snapshot() { return deepFreeze({ current: this.current, deployments: this.list({ limit: this.limit }), stats: { ...this.stats } }); }
}
export default DeploymentRegistry;
