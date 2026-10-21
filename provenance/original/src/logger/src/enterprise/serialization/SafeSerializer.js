'use strict';

const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function finiteInteger(value, fallback, minimum = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : fallback;
}

function truncateUtf8(value, maxBytes) {
  const text = String(value);
  if (!Number.isFinite(maxBytes) || maxBytes <= 0 || Buffer.byteLength(text) <= maxBytes) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, low)}…[truncated]`;
}

function constructorName(value) {
  try { return value?.constructor?.name || 'Object'; }
  catch { return 'Object'; }
}

export class SafeSerializer {
  constructor(options = {}) {
    this.options = Object.freeze({
      maxDepth: finiteInteger(options.maxDepth, 24),
      maxKeys: finiteInteger(options.maxKeys, 4096),
      maxArrayItems: finiteInteger(options.maxArrayItems, 10_000),
      maxStringBytes: finiteInteger(options.maxStringBytes, 256 * 1024),
      maxBufferBytes: finiteInteger(options.maxBufferBytes, 256 * 1024),
      maxRecordBytes: finiteInteger(options.maxRecordBytes, 2 * 1024 * 1024),
      getterPolicy: options.getterPolicy || 'describe',
      functionPolicy: options.functionPolicy || 'describe',
      bigintPolicy: options.bigintPolicy || 'string',
      circularValue: options.circularValue || '[Circular]',
      blockedKeyPolicy: options.blockedKeyPolicy || 'drop',
      deterministic: options.deterministic === true,
      includeErrorStack: options.includeErrorStack !== false,
      includeNonEnumerable: options.includeNonEnumerable === true,
    });
  }

  normalize(value, overrides = {}) {
    const options = { ...this.options, ...(overrides || {}) };
    const state = {
      seen: new WeakMap(),
      keys: 0,
      options,
    };
    return this._visit(value, state, 0, '$');
  }

  stringify(value, overrides = {}) {
    const options = { ...this.options, ...(overrides || {}) };
    let normalized;
    try {
      normalized = this.normalize(value, options);
    } catch (error) {
      normalized = { serializerError: error?.message || String(error) };
    }

    let output;
    try {
      output = JSON.stringify(normalized);
    } catch (error) {
      output = JSON.stringify({ serializerError: error?.message || String(error) });
    }

    if (Buffer.byteLength(output) <= options.maxRecordBytes) return output;
    const truncated = {
      truncated: true,
      originalBytes: Buffer.byteLength(output),
      preview: truncateUtf8(output, Math.max(128, options.maxRecordBytes - 128)),
    };
    return JSON.stringify(truncated);
  }

  clone(value, overrides = {}) {
    return this.normalize(value, overrides);
  }

  _visit(value, state, depth, path) {
    const { options } = state;

    if (value === null || value === undefined) return value ?? null;
    if (typeof value === 'string') return truncateUtf8(value, options.maxStringBytes);
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return options.bigintPolicy === 'number' ? Number(value) : `${value}n`;
    if (typeof value === 'symbol') return `[Symbol(${value.description || ''})]`;
    if (typeof value === 'function') {
      if (options.functionPolicy === 'drop') return undefined;
      return `[Function${value.name ? `: ${value.name}` : ''}]`;
    }

    if (depth >= options.maxDepth) return `[MaxDepth:${constructorName(value)}]`;
    if (state.seen.has(value)) return `${options.circularValue} ${state.seen.get(value)}`;
    state.seen.set(value, path);

    if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
    if (value instanceof RegExp) return value.toString();
    if (value instanceof URL) return value.toString();

    if (value instanceof Error) {
      const output = Object.create(null);
      output.name = value.name || 'Error';
      output.message = truncateUtf8(value.message || '', options.maxStringBytes);
      if (options.includeErrorStack && value.stack) output.stack = truncateUtf8(value.stack, options.maxStringBytes);
      if (value.code !== undefined) output.code = this._visit(value.code, state, depth + 1, `${path}.code`);
      if (value.cause !== undefined) output.cause = this._visit(value.cause, state, depth + 1, `${path}.cause`);
      if (value instanceof AggregateError) {
        output.errors = this._visit(Array.from(value.errors || []), state, depth + 1, `${path}.errors`);
      }
      this._copyProperties(value, output, state, depth, path, new Set(['name', 'message', 'stack', 'code', 'cause', 'errors']));
      return output;
    }

    if (Buffer.isBuffer(value)) {
      const limit = Math.min(value.length, options.maxBufferBytes);
      return {
        type: 'Buffer',
        bytes: value.length,
        truncated: limit < value.length,
        data: value.subarray(0, limit).toString('base64'),
      };
    }

    if (ArrayBuffer.isView(value)) {
      const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      const limit = Math.min(bytes.length, options.maxBufferBytes);
      return {
        type: constructorName(value),
        bytes: bytes.length,
        truncated: limit < bytes.length,
        data: bytes.subarray(0, limit).toString('base64'),
      };
    }

    if (value instanceof ArrayBuffer) {
      const bytes = Buffer.from(value);
      const limit = Math.min(bytes.length, options.maxBufferBytes);
      return {
        type: 'ArrayBuffer',
        bytes: bytes.length,
        truncated: limit < bytes.length,
        data: bytes.subarray(0, limit).toString('base64'),
      };
    }

    if (value instanceof Map) {
      const entries = [];
      let index = 0;
      for (const [key, item] of value.entries()) {
        if (index >= options.maxArrayItems || state.keys >= options.maxKeys) break;
        state.keys++;
        entries.push([
          this._visit(key, state, depth + 1, `${path}.mapKey${index}`),
          this._visit(item, state, depth + 1, `${path}.mapValue${index}`),
        ]);
        index++;
      }
      return { type: 'Map', size: value.size, entries, truncated: index < value.size };
    }

    if (value instanceof Set) {
      const values = [];
      let index = 0;
      for (const item of value.values()) {
        if (index >= options.maxArrayItems || state.keys >= options.maxKeys) break;
        state.keys++;
        values.push(this._visit(item, state, depth + 1, `${path}.set${index}`));
        index++;
      }
      return { type: 'Set', size: value.size, values, truncated: index < value.size };
    }

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, options.maxArrayItems, Math.max(0, options.maxKeys - state.keys));
      const output = new Array(limit);
      for (let index = 0; index < limit; index++) {
        state.keys++;
        output[index] = this._visit(value[index], state, depth + 1, `${path}[${index}]`);
      }
      if (limit < value.length) output.push(`[${value.length - limit} more items]`);
      return output;
    }

    const output = Object.create(null);
    if (constructorName(value) !== 'Object') output.__type = constructorName(value);
    this._copyProperties(value, output, state, depth, path);
    return output;
  }

  _copyProperties(value, output, state, depth, path, excluded = new Set()) {
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(value); }
    catch { return output; }

    let keys = Object.keys(descriptors).filter((key) => !excluded.has(key) && (state.options.includeNonEnumerable || descriptors[key].enumerable));
    if (state.options.deterministic) keys.sort();

    for (const key of keys) {
      if (state.keys >= state.options.maxKeys) {
        output.__truncatedKeys = true;
        break;
      }
      if (BLOCKED_KEYS.has(key)) {
        if (state.options.blockedKeyPolicy === 'mark') output[`[blocked:${key}]`] = true;
        continue;
      }
      const descriptor = descriptors[key];
      state.keys++;
      if (!('value' in descriptor)) {
        if (state.options.getterPolicy === 'drop') continue;
        output[key] = descriptor.get ? '[Getter]' : '[Accessor]';
        continue;
      }
      const normalized = this._visit(descriptor.value, state, depth + 1, `${path}.${key}`);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  }
}

export { truncateUtf8 };
export const defaultSerializer = new SafeSerializer();
export default SafeSerializer;
