'use strict';

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const DEFAULT_KEYS = Object.freeze([
  /pass(?:word|wd)?/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /session(?:[_-]?(?:id|key|secret))?/i,
  /credential/i,
  /signature/i,
  /(?:^|[_-])jwt(?:$|[_-])/i,
  /pepper/i,
  /client[_-]?secret/i,
  /card(?:[_-]?number)?/i,
  /cvv|cvc/i,
]);

const ANSI_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const BIDI_PATTERN = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const URI_PASSWORD_PATTERN = /(\w+:\/\/[^:/\s]+:)[^@/\s]+(@)/g;
const QUERY_SECRET_PATTERN = /([?&](?:token|access_token|refresh_token|api_key|apikey|secret|password|signature)=)[^&#\s]*/gi;

function patternMatches(pattern, value) {
  try {
    pattern.lastIndex = 0;
    return pattern.test(String(value));
  } catch { return false; }
}

function shouldRedactKey(key, patterns) {
  return patterns.some((pattern) => patternMatches(pattern, key));
}

export function sanitizeString(value, options = {}) {
  let output = String(value);
  output = output.replace(BEARER_PATTERN, 'Bearer [REDACTED]');
  output = output.replace(JWT_PATTERN, '[REDACTED_JWT]');
  output = output.replace(URI_PASSWORD_PATTERN, '$1[REDACTED]$2');
  output = output.replace(QUERY_SECRET_PATTERN, '$1[REDACTED]');
  if (options.sanitizeControls) {
    output = output
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\0/g, '\\0')
      .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  }
  if (options.stripAnsi) output = output.replace(ANSI_PATTERN, '');
  if (options.blockBidiControls) output = output.replace(BIDI_PATTERN, '');
  return output;
}

export class Redactor {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.replacement = options.replacement || '[REDACTED]';
    this.keyPatterns = [...DEFAULT_KEYS, ...(options.keyPatterns || [])];
    this.paths = new Set((options.paths || []).map(String));
    this.allowPaths = new Set((options.allowPaths || []).map(String));
    this.sanitizeControls = options.sanitizeControls === true;
    this.stripAnsi = options.stripAnsi === true;
    this.blockBidiControls = options.blockBidiControls !== false;
    this.maxDepth = Math.max(1, Number(options.maxDepth) || 64);
  }

  redact(value, options = {}) {
    if (!this.enabled) return value;
    if (options.inPlace === true) return this._visitInPlace(value, '$', 0, new WeakMap());
    return this._visit(value, '$', 0, new WeakMap());
  }

  _visitInPlace(value, path, depth, seen) {
    if (typeof value === 'string') return sanitizeString(value, this);
    if (value == null || typeof value !== 'object') return value;
    if (depth >= this.maxDepth) return '[MaxRedactionDepth]';
    if (seen.has(value)) return seen.get(value);
    seen.set(value, value);

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        value[index] = this._visitInPlace(value[index], `${path}[${index}]`, depth + 1, seen);
      }
      return value;
    }

    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(value); }
    catch { return '[Uninspectable]'; }

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue;
      if (BLOCKED_KEYS.has(key)) {
        try { delete value[key]; } catch {}
        continue;
      }
      const itemPath = `${path}.${key}`;
      let next;
      if (!('value' in descriptor)) {
        next = '[Accessor]';
      } else if (this.allowPaths.has(itemPath)) {
        next = typeof descriptor.value === 'string' ? sanitizeString(descriptor.value, this) : descriptor.value;
      } else if (this.paths.has(itemPath) || shouldRedactKey(key, this.keyPatterns)) {
        next = this.replacement;
      } else {
        next = this._visitInPlace(descriptor.value, itemPath, depth + 1, seen);
      }

      try { value[key] = next; }
      catch {
        try {
          Object.defineProperty(value, key, {
            value: next,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
            writable: true,
          });
        } catch {}
      }
    }
    return value;
  }

  _visit(value, path, depth, seen) {
    if (typeof value === 'string') return sanitizeString(value, this);
    if (value == null || typeof value !== 'object') return value;
    if (depth >= this.maxDepth) return '[MaxRedactionDepth]';
    if (seen.has(value)) return seen.get(value);

    if (Array.isArray(value)) {
      const output = [];
      seen.set(value, output);
      for (let index = 0; index < value.length; index++) {
        output.push(this._visit(value[index], `${path}[${index}]`, depth + 1, seen));
      }
      return output;
    }

    const output = Object.create(null);
    seen.set(value, output);
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(value); }
    catch { return '[Uninspectable]'; }

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (BLOCKED_KEYS.has(key)) continue;
      const itemPath = `${path}.${key}`;
      if (!('value' in descriptor)) {
        output[key] = '[Accessor]';
        continue;
      }
      const item = descriptor.value;
      if (this.allowPaths.has(itemPath)) {
        output[key] = typeof item === 'string' ? sanitizeString(item, this) : item;
      } else if (this.paths.has(itemPath) || shouldRedactKey(key, this.keyPatterns)) {
        output[key] = this.replacement;
      } else {
        output[key] = this._visit(item, itemPath, depth + 1, seen);
      }
    }
    return output;
  }
}

export { DEFAULT_KEYS, ANSI_PATTERN, BIDI_PATTERN };
export default Redactor;
