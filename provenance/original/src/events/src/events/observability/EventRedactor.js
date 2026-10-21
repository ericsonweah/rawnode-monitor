'use strict';

const DEFAULT_KEYS = /^(?:password|passwd|secret|token|authorization|cookie|set-cookie|api[-_]?key|private[-_]?key|session|csrf)$/i;

function truncate(value, maxBytes) {
  if (!(maxBytes > 0) || Buffer.byteLength(value) <= maxBytes) return value;
  const bytes = Buffer.from(value);
  return `${bytes.subarray(0, Math.max(0, maxBytes - 3)).toString('utf8')}...`;
}

function matchesRule(key, path, rules) {
  if (DEFAULT_KEYS.test(key)) return true;
  for (const rule of rules) {
    if (typeof rule === 'string' && (rule === key || rule === path)) return true;
    if (rule instanceof RegExp && (rule.test(key) || rule.test(path))) return true;
    if (typeof rule === 'function' && rule({ key, path }) === true) return true;
  }
  return false;
}

/** Non-mutating, cycle-safe redaction for diagnostics, logs, and manifests. */
export class EventRedactor {
  constructor(options = {}) {
    this.replacement = options.replacement || '[redacted]';
    this.maxDepth = Math.max(1, Number(options.maxDepth) || 12);
    this.maxKeys = Math.max(1, Number(options.maxKeys) || 10_000);
    this.maxStringBytes = Math.max(16, Number(options.maxStringBytes) || 16 * 1024);
    this.rules = Array.isArray(options.keys || options.rules) ? [...(options.keys || options.rules)] : [];
    this.includeErrorStack = options.includeErrorStack === true;
    this.describeBinary = options.describeBinary !== false;
  }

  redact(input) {
    const seen = new WeakMap();
    let keys = 0;

    const visit = (value, depth, path) => {
      if (value == null) return value;
      const type = typeof value;
      if (type === 'string') return truncate(value, this.maxStringBytes);
      if (type === 'number' || type === 'boolean') return value;
      if (type === 'bigint') return `${value}n`;
      if (type === 'symbol') return `[Symbol:${value.description || ''}]`;
      if (type === 'function') return `[Function:${value.name || 'anonymous'}]`;
      if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        if (!this.describeBinary) return this.replacement;
        return `[${value.constructor?.name || 'Uint8Array'} ${value.byteLength} bytes]`;
      }
      if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : 'Invalid Date';
      if (value instanceof RegExp) return String(value);
      if (value instanceof Error) {
        const output = {
          name: value.name || 'Error',
          message: truncate(value.message || '', this.maxStringBytes),
        };
        if (value.code !== undefined) output.code = value.code;
        if (value.details !== undefined && depth < this.maxDepth) output.details = visit(value.details, depth + 1, `${path}.details`);
        if (this.includeErrorStack && value.stack) output.stack = truncate(value.stack, this.maxStringBytes);
        return output;
      }
      if (depth >= this.maxDepth) return '[MaxDepth]';
      if (seen.has(value)) return `[Circular:${seen.get(value)}]`;
      seen.set(value, path);

      if (Array.isArray(value)) {
        const output = [];
        for (let index = 0; index < value.length; index++) {
          if (++keys > this.maxKeys) { output.push('[MaxKeys]'); break; }
          output.push(visit(value[index], depth + 1, `${path}[${index}]`));
        }
        return output;
      }
      if (value instanceof Map) {
        const output = [];
        for (const [key, child] of value) {
          if (++keys > this.maxKeys) { output.push(['[MaxKeys]', null]); break; }
          output.push([visit(key, depth + 1, `${path}.<key>`), visit(child, depth + 1, `${path}.<value>`)]);
        }
        return { type: 'Map', entries: output };
      }
      if (value instanceof Set) {
        const output = [];
        for (const child of value) {
          if (++keys > this.maxKeys) { output.push('[MaxKeys]'); break; }
          output.push(visit(child, depth + 1, `${path}[]`));
        }
        return { type: 'Set', values: output };
      }

      const output = Object.create(null);
      for (const key of Object.keys(value)) {
        if (++keys > this.maxKeys) { output.__truncated = '[MaxKeys]'; break; }
        const childPath = path === '$' ? key : `${path}.${key}`;
        if (matchesRule(key, childPath, this.rules)) {
          output[key] = this.replacement;
          continue;
        }
        let child;
        try { child = value[key]; }
        catch (error) { child = `[GetterError:${error?.message || error}]`; }
        output[key] = visit(child, depth + 1, childPath);
      }
      return output;
    };

    return visit(input, 0, '$');
  }
}

export default EventRedactor;
