'use strict';

import { safeError } from '../errors/UnifiedError.js';

const SECRET = /(secret|password|passwd|token|private.?key|certificate|authorization|cookie|api.?key)/i;

function redact(value, depth = 0, seen = new WeakSet()) {
  if (depth > 8) return '[depth-limit]';
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[bytes:${value.byteLength}]`;
  if (Array.isArray(value)) return value.map((entry) => redact(entry, depth + 1, seen));
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SECRET.test(key) ? '[redacted]' : redact(entry, depth + 1, seen);
  }
  return output;
}

export class UnifiedDiagnostics {
  constructor(options = {}) {
    this.limit = Math.max(0, Number(options.historyLimit) || 256);
    this.entries = [];
    this.sequence = 0;
    this.lastError = null;
  }

  record(type, details = null, level = 'info') {
    const entry = Object.freeze({
      sequence: ++this.sequence,
      at: Date.now(),
      type: String(type || 'event'),
      level: String(level || 'info'),
      details: redact(details),
    });
    if (level === 'error' && details?.error) this.lastError = safeError(details.error);
    if (this.limit > 0) {
      this.entries.push(entry);
      if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    }
    return entry;
  }

  snapshot(extra = null) {
    return {
      sequence: this.sequence,
      lastError: this.lastError,
      history: this.entries.slice(),
      ...(extra && typeof extra === 'object' ? redact(extra) : {}),
    };
  }
}

export { redact as redactUnifiedDiagnostics };
export default UnifiedDiagnostics;
