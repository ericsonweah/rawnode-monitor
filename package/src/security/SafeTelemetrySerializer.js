'use strict';

import { BLOCKED_OBJECT_KEYS } from '../constants.js';
import { bytesOf, boundedInteger, errorRecord } from '../support.js';

export class SafeTelemetrySerializer {
  constructor(options = {}) {
    this.maxDepth = boundedInteger(options.maxDepth, 16, 1, 128);
    this.maxKeys = boundedInteger(options.maxKeys, 4_096, 1, 1_000_000);
    this.maxArrayItems = boundedInteger(options.maxArrayItems, 10_000, 1, 1_000_000);
    this.maxStringBytes = boundedInteger(options.maxStringBytes, 64 * 1024, 16, 16 * 1024 * 1024);
    this.maxPayloadBytes = boundedInteger(options.maxPayloadBytes, 2 * 1024 * 1024, 1_024, 256 * 1024 * 1024);
    this.circular = options.circular || '[Circular]';
    this.truncated = options.truncated || '[Truncated]';
    this.includeErrorStack = options.includeErrorStack === true;
    this.stats = { serialized: 0, truncated: 0, circular: 0, blockedKeys: 0, errors: 0 };
  }

  sanitize(value, options = {}) {
    const state = { seen: new WeakSet(), keys: 0, bytes: 0, truncated: false };
    try {
      let output = this._visit(value, 0, state, options);
      const json = JSON.stringify(output ?? null);
      if (Buffer.byteLength(json) > (options.maxPayloadBytes || this.maxPayloadBytes)) { state.truncated = true; output = { truncated: true, bytes: Buffer.byteLength(json) }; }
      this.stats.serialized++;
      if (state.truncated) this.stats.truncated++;
      return output;
    } catch (error) {
      this.stats.errors++;
      return { serializationError: error?.message || String(error) };
    }
  }

  stringify(value, options = {}) {
    const sanitized = this.sanitize(value, options);
    const json = JSON.stringify(sanitized ?? null);
    if (Buffer.byteLength(json) <= (options.maxPayloadBytes || this.maxPayloadBytes)) return json;
    this.stats.truncated++;
    return JSON.stringify({ truncated: true, bytes: Buffer.byteLength(json), preview: json.slice(0, Math.min(32_768, this.maxStringBytes)) });
  }

  _visit(value, depth, state, options) {
    if (state.bytes >= (options.maxPayloadBytes || this.maxPayloadBytes)) { state.truncated = true; return this.truncated; }
    if (value == null || typeof value === 'boolean' || typeof value === 'number') { state.bytes += 16; return Number.isFinite(value) || typeof value !== 'number' ? value : String(value); }
    if (typeof value === 'bigint') { const text = value.toString(); state.bytes += text.length; return text; }
    if (typeof value === 'string') return this._string(value, state, options);
    if (typeof value === 'symbol' || typeof value === 'function') return `[${typeof value}]`;
    if (depth >= (options.maxDepth || this.maxDepth)) { state.truncated = true; return this.truncated; }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      const maximum = Math.min(value.byteLength, options.maxBinaryBytes || 4_096);
      state.bytes += maximum;
      return { type: value.constructor?.name || 'Uint8Array', bytes: value.byteLength, base64: Buffer.from(value.subarray(0, maximum)).toString('base64'), truncated: maximum < value.byteLength };
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (value instanceof URL) return value.toString();
    if (value instanceof RegExp) return String(value);
    if (value instanceof Error) return this._visit(errorRecord(value, { stack: options.includeErrorStack ?? this.includeErrorStack }), depth + 1, state, options);
    if (state.seen.has(value)) { this.stats.circular++; return this.circular; }
    state.seen.add(value);
    try {
      if (Array.isArray(value)) {
        const maximum = Math.min(value.length, options.maxArrayItems || this.maxArrayItems);
        const output = new Array(maximum);
        for (let index = 0; index < maximum; index++) output[index] = this._visit(value[index], depth + 1, state, options);
        if (maximum < value.length) { output.push(this.truncated); state.truncated = true; }
        return output;
      }
      if (value instanceof Map) return this._visit(Object.fromEntries(Array.from(value.entries()).slice(0, this.maxKeys)), depth + 1, state, options);
      if (value instanceof Set) return this._visit(Array.from(value).slice(0, this.maxArrayItems), depth + 1, state, options);
      const output = Object.create(null);
      let keys;
      try { keys = Object.keys(value); } catch { return '[Uninspectable]'; }
      for (const key of keys) {
        if (state.bytes >= (options.maxPayloadBytes || this.maxPayloadBytes) || state.keys >= (options.maxKeys || this.maxKeys)) { output.$truncated = true; state.truncated = true; break; }
        if (BLOCKED_OBJECT_KEYS.has(key)) { this.stats.blockedKeys++; continue; }
        if (Buffer.byteLength(key) > this.maxStringBytes) { state.truncated = true; continue; }
        state.bytes += Buffer.byteLength(key);
        state.keys++;
        let item;
        try { item = value[key]; } catch (error) { item = `[GetterError:${error?.message || error}]`; }
        output[key] = this._visit(item, depth + 1, state, options);
      }
      return output;
    } finally { state.seen.delete(value); }
  }

  _string(value, state, options) {
    const limit = Math.max(0, Math.min(options.maxStringBytes || this.maxStringBytes, (options.maxPayloadBytes || this.maxPayloadBytes) - state.bytes));
    const bytes = Buffer.byteLength(value);
    state.bytes += Math.min(bytes, limit);
    if (bytes <= limit) return value;
    state.truncated = true;
    let end = Math.min(value.length, limit);
    while (end > 0 && Buffer.byteLength(value.slice(0, end)) > limit) end = Math.floor(end * 0.9);
    return `${value.slice(0, end)}${this.truncated}`;
  }

  snapshot() { return Object.freeze({ ...this.stats }); }
}

export default SafeTelemetrySerializer;
