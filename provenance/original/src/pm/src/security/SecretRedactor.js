'use strict';

const SECRET_KEY = /(?:secret|token|password|passwd|private[_-]?key|api[_-]?key|credential|authorization|cookie|session[_-]?key|pepper|dsn)/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]{1,8192}=*/gi;
// Bounded components avoid regex backtracking becoming quadratic on very long log lines.
const URI_CREDENTIALS = /\b([a-z][a-z0-9+.-]{0,31}:\/\/)([^:@/\s]{1,256}):([^@/\s]{1,256})@/gi;

export class SecretRedactor {
  constructor(options = {}) {
    this.placeholder = options.placeholder || '[redacted]';
    this.additionalKeys = new Set((options.keys || []).map((key) => String(key).toLowerCase()));
    this.maxDepth = Math.max(1, Number(options.maxDepth) || 16);
    this.maxArray = Math.max(1, Number(options.maxArray) || 1_000);
  }

  isSecretKey(key) {
    const value = String(key || '');
    return SECRET_KEY.test(value) || this.additionalKeys.has(value.toLowerCase());
  }

  text(value) {
    return String(value ?? '')
      .replace(BEARER, `Bearer ${this.placeholder}`)
      .replace(URI_CREDENTIALS, `$1${this.placeholder}:${this.placeholder}@`);
  }

  redact(value, key = '', depth = 0, seen = new WeakMap()) {
    if (this.isSecretKey(key) && value != null) return this.placeholder;
    if (typeof value === 'string') return this.text(value);
    if (typeof value === 'bigint') return `${value}n`;
    if (value == null || typeof value !== 'object') return value;
    if (depth >= this.maxDepth) return '[max-depth]';
    if (seen.has(value)) return '[circular]';
    seen.set(value, true);

    if (Buffer.isBuffer(value)) return `[buffer:${value.length}]`;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      return {
        name: value.name,
        code: value.code || null,
        message: this.text(value.message),
      };
    }
    if (Array.isArray(value)) {
      return value.slice(0, this.maxArray).map((item) => this.redact(item, '', depth + 1, seen));
    }

    const out = Object.create(null);
    for (const [childKey, childValue] of Object.entries(value)) {
      out[childKey] = this.redact(childValue, childKey, depth + 1, seen);
    }
    return out;
  }
}

export const defaultRedactor = new SecretRedactor();
export default SecretRedactor;
