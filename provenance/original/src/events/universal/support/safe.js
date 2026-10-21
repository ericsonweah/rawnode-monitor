'use strict';

const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);
const REDACT = /^(?:password|passwd|secret|token|authorization|cookie|set-cookie|api[-_]?key|private[-_]?key|session)$/i;

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function deepMerge(base, ...sources) {
  const output = isPlainObject(base) ? { ...base } : {};
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (BLOCKED.has(key)) continue;
      if (isPlainObject(value) && isPlainObject(output[key])) output[key] = deepMerge(output[key], value);
      else if (isPlainObject(value)) output[key] = deepMerge({}, value);
      else if (Array.isArray(value)) output[key] = value.slice();
      else if (value !== undefined) output[key] = value;
    }
  }
  return output;
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    try { deepFreeze(value[key], seen); } catch {}
  }
  try { return Object.freeze(value); } catch { return value; }
}

export function byteLength(value) {
  if (value == null) return 0;
  if (typeof value === 'string') {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(value).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(value);
    return value.length * 2;
  }
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  try { return byteLength(JSON.stringify(value)); } catch { return 0; }
}

export function stableObject(value, seen = new WeakMap(), path = '$') {
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'bigint') return { __rnType: 'BigInt', value: String(value) };
    if (typeof value === 'number' && !Number.isFinite(value)) return { __rnType: 'Number', value: String(value) };
    return value;
  }
  if (seen.has(value)) return `[Circular:${seen.get(value)}]`;
  seen.set(value, path);
  if (value instanceof Date) return { __rnType: 'Date', value: Number.isFinite(value.getTime()) ? value.toISOString() : null };
  if (value instanceof Uint8Array) return { __rnType: 'Uint8Array', value: base64Encode(value) };
  if (value instanceof ArrayBuffer) return { __rnType: 'ArrayBuffer', value: base64Encode(new Uint8Array(value)) };
  if (Array.isArray(value)) return value.map((item, index) => stableObject(item, seen, `${path}[${index}]`));
  if (value instanceof Map) return { __rnType: 'Map', value: [...value].map(([key, item], index) => [stableObject(key, seen, `${path}.k${index}`), stableObject(item, seen, `${path}.v${index}`)]) };
  if (value instanceof Set) return { __rnType: 'Set', value: [...value].map((item, index) => stableObject(item, seen, `${path}.s${index}`)) };
  if (value instanceof Error) return { __rnType: 'Error', name: value.name, message: value.message, code: value.code, details: stableObject(value.details, seen, `${path}.details`) };
  const output = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (BLOCKED.has(key)) continue;
    let child;
    try { child = value[key]; } catch { child = '[GetterError]'; }
    output[key] = stableObject(child, seen, `${path}.${key}`);
  }
  return output;
}

export function stableStringify(value) { return JSON.stringify(stableObject(value)); }

export function cloneSafe(value, options = {}) {
  const maxDepth = Math.max(1, Number(options.maxDepth) || 16);
  const maxKeys = Math.max(1, Number(options.maxKeys) || 10_000);
  const maxArrayItems = Math.max(1, Number(options.maxArrayItems) || 1_000);
  const maxStringBytes = Math.max(16, Number(options.maxStringBytes) || 64 * 1024);
  const redact = options.redact !== false;
  const extra = Array.isArray(options.redactKeys) ? options.redactKeys : [];
  const seen = new WeakMap();
  let keys = 0;
  const visit = (input, depth, path) => {
    if (input == null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'string') return truncateUtf8(input, maxStringBytes);
    if (typeof input === 'bigint') return String(input);
    if (typeof input === 'function') return `[Function:${input.name || 'anonymous'}]`;
    if (typeof input === 'symbol') return `[Symbol:${input.description || ''}]`;
    if (depth >= maxDepth) return '[MaxDepth]';
    if (seen.has(input)) return `[Circular:${seen.get(input)}]`;
    seen.set(input, path);
    if (input instanceof Date) return Number.isFinite(input.getTime()) ? input.toISOString() : null;
    if (input instanceof Error) return { name: input.name, message: truncateUtf8(input.message || '', maxStringBytes), code: input.code, details: visit(input.details, depth + 1, `${path}.details`) };
    if (input instanceof ArrayBuffer) return { type: 'ArrayBuffer', bytes: input.byteLength };
    if (ArrayBuffer.isView(input)) return { type: input.constructor?.name || 'TypedArray', bytes: input.byteLength };
    if (Array.isArray(input)) {
      const size = Math.min(input.length, maxArrayItems);
      const output = new Array(size);
      for (let index = 0; index < size; index++) output[index] = visit(input[index], depth + 1, `${path}[${index}]`);
      if (size < input.length) output.push(`[Truncated:${input.length - size}]`);
      return output;
    }
    const output = Object.create(null);
    for (const key of Object.keys(input)) {
      if (++keys > maxKeys) { output.__truncated = true; break; }
      if (BLOCKED.has(key)) continue;
      const sensitive = REDACT.test(key) || extra.some((rule) => typeof rule === 'string' ? rule === key : rule instanceof RegExp ? rule.test(key) : false);
      if (redact && sensitive) { output[key] = '[redacted]'; continue; }
      let child;
      try { child = input[key]; } catch { child = '[GetterError]'; }
      output[key] = visit(child, depth + 1, `${path}.${key}`);
    }
    return output;
  };
  return visit(value, 0, '$');
}

export function truncateUtf8(value, maxBytes) {
  const text = String(value ?? '');
  if (!maxBytes || byteLength(text) <= maxBytes) return text;
  if (typeof TextEncoder !== 'function' || typeof TextDecoder !== 'function') return `${text.slice(0, Math.max(0, Math.floor(maxBytes / 2) - 3))}...`;
  const bytes = new TextEncoder().encode(text);
  return `${new TextDecoder().decode(bytes.subarray(0, Math.max(0, maxBytes - 3)))}...`;
}

export function randomId(prefix = 'evt') {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return `${prefix}_${crypto.randomUUID()}`;
  if (typeof crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
    return `${prefix}_${[...bytes].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function base64Encode(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (typeof Buffer !== 'undefined') return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < value.length; index += chunk) binary += String.fromCharCode(...value.subarray(index, index + chunk));
  return globalThis.btoa(binary);
}

export function base64Decode(value) {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(String(value || ''), 'base64'));
  const binary = globalThis.atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function toUint8Array(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value));
}

export function safeError(error) {
  return Object.freeze({
    name: error?.name || 'Error',
    message: String(error?.message || error || 'Unknown error'),
    code: error?.code || null,
    retryable: error?.retryable === true,
    delivery: error?.delivery || null,
  });
}

export function assertEventName(value, limits = {}) {
  const name = String(value || '').trim();
  if (!name) throw Object.assign(new TypeError('Event name is required.'), { code: 'EVENT_NAME_REQUIRED' });
  if (/\p{Cc}/u.test(name)) throw Object.assign(new TypeError('Event name contains control characters.'), { code: 'EVENT_NAME_CONTROL_CHARACTER' });
  const bytes = byteLength(name);
  if (limits.maxEventNameBytes > 0 && bytes > limits.maxEventNameBytes) {
    throw Object.assign(new RangeError(`Event name exceeds ${limits.maxEventNameBytes} bytes.`), { code: 'EVENT_NAME_TOO_LARGE', details: { bytes, maximum: limits.maxEventNameBytes } });
  }
  return name;
}

export function timeout(operation, milliseconds, options = {}) {
  const ms = Math.max(0, Number(milliseconds) || 0);
  if (!ms) return Promise.resolve(operation);
  let timer;
  return Promise.race([
    Promise.resolve(operation),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(options.message || `Event operation timed out after ${ms}ms.`), { name: 'EventTimeoutError', code: options.code || 'EVENT_TIMEOUT', timeoutMs: ms })), ms);
      timer?.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export function linkAbortSignals(signals = []) {
  const controller = new AbortController();
  const listeners = [];
  for (const signal of signals.filter(Boolean)) {
    if (signal.aborted) { controller.abort(signal.reason); break; }
    const listener = () => controller.abort(signal.reason);
    signal.addEventListener('abort', listener, { once: true });
    listeners.push([signal, listener]);
  }
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    dispose() { for (const [signal, listener] of listeners) signal.removeEventListener('abort', listener); },
  };
}
