'use strict';

import { randomId } from '../support.js';

export class SilenceManager {
  constructor(options = {}) { this.maxSilences = Math.max(1, Number(options.maxSilences) || 10_000); this.silences = new Map(); this.stats = { created: 0, expired: 0, matched: 0 }; }
  create(options = {}) {
    if (this.silences.size >= this.maxSilences) throw new Error('Monitor silence limit exceeded.');
    const now = Date.now();
    const record = Object.freeze({ id: options.id || randomId('silence'), ruleIds: Object.freeze([...(options.ruleIds || [])]), severities: Object.freeze([...(options.severities || [])]), tags: Object.freeze({ ...(options.tags || {}) }), startsAt: Number(options.startsAt || now), endsAt: Number(options.endsAt || now + Number(options.durationMs || 60 * 60_000)), reason: options.reason || '', createdBy: options.createdBy || null, createdAt: now });
    this.silences.set(record.id, record); this.stats.created++; return record;
  }
  remove(id) { return this.silences.delete(String(id)); }
  match(rule, now = Date.now()) {
    this.prune(now);
    for (const silence of this.silences.values()) {
      if (now < silence.startsAt || now >= silence.endsAt) continue;
      if (silence.ruleIds.length && !silence.ruleIds.includes(rule.id)) continue;
      if (silence.severities.length && !silence.severities.includes(rule.severity)) continue;
      if (Object.keys(silence.tags).length && !Object.entries(silence.tags).every(([key, value]) => rule.annotations?.[key] === value || rule.tags?.includes(`${key}:${value}`))) continue;
      this.stats.matched++; return silence;
    }
    return null;
  }
  prune(now = Date.now()) { let count = 0; for (const [id, record] of this.silences) if (record.endsAt <= now) { this.silences.delete(id); count++; } this.stats.expired += count; return count; }
  snapshot() { return Object.freeze({ silences: Object.freeze([...this.silences.values()]), stats: Object.freeze({ ...this.stats }) }); }
}
export default SilenceManager;
