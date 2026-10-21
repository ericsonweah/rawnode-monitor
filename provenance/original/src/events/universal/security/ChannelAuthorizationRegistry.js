'use strict';

import { globToRegExp } from '../../support/glob.js';
import { deepFreeze } from '../support/safe.js';

export class ChannelAuthorizationRegistry {
  constructor(options = {}) { this.defaultEffect = options.defaultEffect || 'deny'; this.maxPolicies = Math.max(1, Number(options.maxPolicies) || 10_000); this.policies = []; this.sequence = 0; this.frozen = false; }
  define(pattern, authorize, options = {}) {
    if (this.frozen) throw authorizationError('Channel authorization registry is frozen.', 'EVENT_CHANNEL_POLICIES_FROZEN');
    if (typeof authorize !== 'function') throw new TypeError('Channel authorization policy must be a function.');
    if (this.policies.length >= this.maxPolicies) throw authorizationError('Channel authorization policy limit exceeded.', 'EVENT_CHANNEL_POLICY_LIMIT');
    const policy = { id: options.id || `channel-policy-${++this.sequence}`, pattern: String(pattern), matcher: globToRegExp(String(pattern)), authorize, priority: Number(options.priority) || 0, owner: options.owner || null, metadata: options.metadata || null };
    this.policies.push(policy); this.policies.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    return Object.freeze({ id: policy.id, dispose: () => this.remove(policy.id), [Symbol.dispose]: () => this.remove(policy.id) });
  }
  remove(id) { const index = this.policies.findIndex((entry) => entry.id === id); if (index === -1) return false; this.policies.splice(index, 1); return true; }
  removeOwner(owner) { let removed = 0; for (const policy of [...this.policies]) if (policy.owner === owner && this.remove(policy.id)) removed++; return removed; }
  async authorize(channel, context = {}) {
    const name = String(channel || '');
    const matches = this.policies.filter((policy) => policy.matcher.test(name));
    if (!matches.length) return { allowed: this.defaultEffect === 'allow', effect: this.defaultEffect, policy: null, reason: 'default' };
    for (const policy of matches) {
      const result = await policy.authorize({ ...context, channel: name, policy });
      if (result === undefined || result === null) continue;
      if (result === true || result?.allowed === true || result?.effect === 'allow') return { allowed: true, effect: 'allow', policy: policy.id, result };
      if (result === false || result?.allowed === false || result?.effect === 'deny') return { allowed: false, effect: 'deny', policy: policy.id, reason: result?.reason || 'denied', result };
    }
    return { allowed: this.defaultEffect === 'allow', effect: this.defaultEffect, policy: null, reason: 'no-decision' };
  }
  freeze() { this.frozen = true; return this; }
  snapshot() { return deepFreeze({ frozen: this.frozen, defaultEffect: this.defaultEffect, policies: this.policies.map(({ matcher, authorize, ...value }) => ({ ...value, handler: authorize.name || 'anonymous' })) }); }
}
function authorizationError(message, code) { return Object.assign(new Error(message), { name: 'EventAuthorizationError', code }); }
export default ChannelAuthorizationRegistry;
