'use strict';

import { EventTransportError } from '../errors/EventError.js';

const DEFAULT_REDACT = /^(?:password|passwd|secret|token|authorization|cookie|set-cookie|api[-_]?key|private[-_]?key)$/i;
const TYPED_ARRAYS = Object.freeze({
  Uint8Array,
  Uint8ClampedArray,
  Int8Array,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
  BigInt64Array: globalThis.BigInt64Array,
  BigUint64Array: globalThis.BigUint64Array,
});

function safeSet(target, key, value) {
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
    Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
  } else target[key] = value;
}

function truncateUtf8(value, maxBytes) {
  if (!maxBytes || Buffer.byteLength(value) <= maxBytes) return value;
  const buffer = Buffer.from(value);
  return `${buffer.subarray(0, Math.max(0, maxBytes - 3)).toString('utf8')}...`;
}

function shouldRedact(key, rules) {
  if (DEFAULT_REDACT.test(key)) return true;
  for (const rule of rules) {
    if (typeof rule === 'string' && rule === key) return true;
    if (rule instanceof RegExp && rule.test(key)) return true;
    if (typeof rule === 'function' && rule(key)) return true;
  }
  return false;
}

export class SafeJsonCodec {
  constructor(options = {}) {
    this.options = Object.freeze({
      maxDepth: Math.max(1, Number(options.maxDepth) || 32),
      maxKeys: Math.max(1, Number(options.maxKeys) || 100_000),
      maxStringBytes: Math.max(16, Number(options.maxStringBytes) || 2 * 1024 * 1024),
      maxBytes: Math.max(0, Number(options.maxBytes) || 0),
      getterPolicy: options.getterPolicy || 'skip',
      circularPolicy: options.circularPolicy || 'marker',
      unsupportedPolicy: options.unsupportedPolicy || 'marker',
      redact: options.redact !== false,
      redactWith: options.redactWith || '[redacted]',
      redactKeys: Array.isArray(options.redactKeys) ? options.redactKeys.slice() : [],
      reconstruct: options.reconstruct !== false,
    });
  }

  sanitize(input, overrides = {}) {
    const options = { ...this.options, ...overrides };
    const seen = new WeakMap();
    let keyCount = 0;
    let truncated = false;

    const visit = (value, depth, path) => {
      if (value === null) return null;
      if (value === undefined) return { __rnType: 'Undefined' };
      const type = typeof value;
      if (type === 'string') {
        const output = truncateUtf8(value, options.maxStringBytes);
        if (output !== value) truncated = true;
        return output;
      }
      if (type === 'number' || type === 'boolean') return value;
      if (type === 'bigint') return { __rnType: 'BigInt', value: value.toString() };
      if (type === 'symbol') return options.unsupportedPolicy === 'omit' ? undefined : `[Symbol:${value.description || ''}]`;
      if (type === 'function') return options.unsupportedPolicy === 'omit' ? undefined : `[Function:${value.name || 'anonymous'}]`;

      if (Buffer.isBuffer(value)) return { __rnType: 'Buffer', value: value.toString('base64') };
      if (value instanceof Uint8Array) return { __rnType: value.constructor?.name || 'Uint8Array', value: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
      if (value instanceof Date) return { __rnType: 'Date', value: Number.isFinite(value.getTime()) ? value.toISOString() : null };
      if (value instanceof RegExp) return { __rnType: 'RegExp', source: value.source, flags: value.flags };
      if (value instanceof Error) {
        return {
          __rnType: 'Error',
          name: value.name,
          message: truncateUtf8(value.message || '', options.maxStringBytes),
          stack: truncateUtf8(value.stack || '', options.maxStringBytes),
          code: value.code,
          details: depth < options.maxDepth ? visit(value.details, depth + 1, `${path}.details`) : '[MaxDepth]',
        };
      }

      if (depth >= options.maxDepth) { truncated = true; return '[MaxDepth]'; }
      if (seen.has(value)) {
        if (options.circularPolicy === 'throw') throw new EventTransportError(`Circular value at ${path}`, { code: 'EVENT_CODEC_CIRCULAR' });
        if (options.circularPolicy === 'omit') return undefined;
        return `[Circular:${seen.get(value)}]`;
      }
      seen.set(value, path || '$');

      if (value instanceof Map) {
        const entries = [];
        for (const [key, item] of value) {
          if (++keyCount > options.maxKeys) { truncated = true; break; }
          entries.push([visit(key, depth + 1, `${path}.<key>`), visit(item, depth + 1, `${path}.<value>`)]);
        }
        return { __rnType: 'Map', value: entries };
      }
      if (value instanceof Set) {
        const entries = [];
        for (const item of value) {
          if (++keyCount > options.maxKeys) { truncated = true; break; }
          entries.push(visit(item, depth + 1, `${path}[]`));
        }
        return { __rnType: 'Set', value: entries };
      }

      if (Array.isArray(value)) {
        const output = new Array(Math.min(value.length, options.maxKeys - keyCount));
        for (let index = 0; index < output.length; index++) {
          keyCount++;
          output[index] = visit(value[index], depth + 1, `${path}[${index}]`);
        }
        if (output.length < value.length) truncated = true;
        return output;
      }

      const output = Object.create(null);
      for (const key of Object.keys(value)) {
        if (++keyCount > options.maxKeys) { truncated = true; break; }
        if (options.redact && shouldRedact(key, options.redactKeys)) {
          output[key] = options.redactWith;
          continue;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor?.get && options.getterPolicy !== 'invoke') {
          if (options.getterPolicy !== 'omit') output[key] = '[Getter]';
          continue;
        }
        let item;
        try { item = value[key]; }
        catch (error) { item = `[GetterError:${error?.message || error}]`; }
        const encoded = visit(item, depth + 1, path ? `${path}.${key}` : key);
        if (encoded !== undefined) output[key] = encoded;
      }
      return output;
    };

    return { value: visit(input, 0, '$'), truncated, keyCount };
  }

  encode(input, overrides = {}) {
    const options = { ...this.options, ...overrides };
    const sanitized = this.sanitize(input, options);
    let text;
    try { text = JSON.stringify(sanitized.value); }
    catch (cause) {
      throw new EventTransportError('Could not encode event payload', { code: 'EVENT_CODEC_ENCODE_FAILED', cause });
    }
    const bytes = Buffer.byteLength(text);
    const maxBytes = Math.max(0, Number(options.maxBytes) || 0);
    if (maxBytes && bytes > maxBytes) {
      throw new EventTransportError(`Encoded event payload exceeds ${maxBytes} bytes`, {
        code: 'EVENT_CODEC_MAX_BYTES',
        details: { bytes, maxBytes },
      });
    }
    return { text, bytes, truncated: sanitized.truncated, keyCount: sanitized.keyCount };
  }

  stringify(input, overrides = {}) { return this.encode(input, overrides).text; }

  parse(text, overrides = {}) {
    const options = { ...this.options, ...overrides };
    const value = JSON.parse(Buffer.isBuffer(text) ? text.toString('utf8') : String(text));
    return options.reconstruct === false ? value : this._reconstruct(value);
  }

  _reconstruct(value) {
    if (Array.isArray(value)) return value.map((item) => this._reconstruct(item));
    if (!value || typeof value !== 'object') return value;
    const type = value.__rnType;
    if (type === 'Undefined') return undefined;
    if (type === 'BigInt') { try { return BigInt(value.value); } catch { return value.value; } }
    if (type === 'Buffer') return Buffer.from(value.value || '', 'base64');
    if (type === 'Date') return value.value ? new Date(value.value) : new Date(NaN);
    if (type === 'RegExp') return new RegExp(value.source || '', value.flags || '');
    if (type === 'Map') return new Map((value.value || []).map(([key, item]) => [this._reconstruct(key), this._reconstruct(item)]));
    if (type === 'Set') return new Set((value.value || []).map((item) => this._reconstruct(item)));
    if (type === 'Error') {
      const error = new Error(value.message || 'Event error');
      error.name = value.name || 'Error';
      error.stack = value.stack || error.stack;
      if (value.code !== undefined) error.code = value.code;
      if (value.details !== undefined) error.details = this._reconstruct(value.details);
      return error;
    }
    if (type && /Array$/.test(type) && typeof value.value === 'string') {
      const bytes = Buffer.from(value.value, 'base64');
      const Constructor = TYPED_ARRAYS[type];
      if (!Constructor || type === 'Uint8Array') return new Uint8Array(bytes);
      try {
        const owned = Uint8Array.from(bytes);
        return new Constructor(owned.buffer, 0, Math.floor(owned.byteLength / Constructor.BYTES_PER_ELEMENT));
      } catch { return new Uint8Array(bytes); }
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) safeSet(output, key, this._reconstruct(item));
    return output;
  }
}

export default SafeJsonCodec;
