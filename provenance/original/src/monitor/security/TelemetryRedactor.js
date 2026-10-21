'use strict';

import { createHash } from 'node:crypto';
import { BLOCKED_OBJECT_KEYS } from '../constants.js';

const DEFAULT_KEYS = Object.freeze([
  'password', 'passwd', 'passphrase', 'secret', 'token', 'authorization', 'cookie',
  'set-cookie', 'api_key', 'apikey', 'private_key', 'privatekey', 'client_secret',
  'credit_card', 'card_number', 'cvv', 'pin', 'session', 'session_id', 'access_token',
  'refresh_token', 'jwt', 'signature', 'pepper', 'salt',
]);
const DEFAULT_PATTERNS = Object.freeze([
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+\b/g,
]);

export class TelemetryRedactor {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.placeholder = options.placeholder || '[REDACTED]';
    this.keys = new Set([...DEFAULT_KEYS, ...(options.keys || options.secretKeys || [])].map((key) => String(key).toLowerCase()));
    this.patterns = [...DEFAULT_PATTERNS, ...(options.patterns || [])];
    this.hashTenantIds = options.hashTenantIds === true;
    this.hashUserIds = options.hashUserIds === true;
    this.hashKey = options.hashKey || null;
    this.maxDepth = Number(options.maxDepth) || 20;
    this.stats = { redactedFields: 0, redactedPatterns: 0, hashedIdentifiers: 0 };
  }

  redact(value) {
    if (!this.enabled) return value;
    return this._visit(value, null, 0, new WeakSet());
  }

  _visit(value, key, depth, seen) {
    if (value == null) return value;
    if (key && this._sensitive(key)) { this.stats.redactedFields++; return this.placeholder; }
    if (typeof value === 'string') {
      let output = value;
      for (const pattern of this.patterns) {
        const next = output.replace(pattern, this.placeholder);
        if (next !== output) this.stats.redactedPatterns++;
        output = next;
      }
      if ((key === 'tenantId' || key === 'tenant_id') && this.hashTenantIds) return this.hash(output);
      if ((key === 'userId' || key === 'user_id' || key === 'actorId') && this.hashUserIds) return this.hash(output);
      return output;
    }
    if (typeof value !== 'object' || depth >= this.maxDepth) return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map((item) => this._visit(item, null, depth + 1, seen));
      if (Buffer.isBuffer(value) || value instanceof Uint8Array || value instanceof Date || value instanceof Error) return value;
      const output = Object.create(null);
      for (const property of Object.keys(value)) {
        if (BLOCKED_OBJECT_KEYS.has(property)) continue;
        output[property] = this._visit(value[property], property, depth + 1, seen);
      }
      return output;
    } finally { seen.delete(value); }
  }

  _sensitive(key) {
    const normalized = String(key)
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[.\-\s]+/g, '_');
    return this.keys.has(normalized) || [...this.keys].some((candidate) => normalized.endsWith(`_${candidate}`));
  }

  hash(value) {
    this.stats.hashedIdentifiers++;
    const hash = createHash('sha256');
    if (this.hashKey) hash.update(String(this.hashKey));
    return `sha256:${hash.update(String(value)).digest('hex').slice(0, 24)}`;
  }

  snapshot() { return Object.freeze({ enabled: this.enabled, keys: this.keys.size, patterns: this.patterns.length, stats: Object.freeze({ ...this.stats }) }); }
}

export default TelemetryRedactor;
