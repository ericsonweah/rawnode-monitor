'use strict';

import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { BLOCKED_OBJECT_KEYS } from './constants.js';
import { MonitorTimeoutError } from './errors.js';

export const noop = () => {};
export const nowNs = () => process.hrtime.bigint();
export const elapsedMs = (started) => Number(process.hrtime.bigint() - started) / 1e6;
export const epochNanos = () => BigInt(Date.now()) * 1_000_000n;

// Trace and telemetry identifiers require global uniqueness, not secrecy. A
// process-seeded xoshiro generator avoids a synchronous operating-system entropy
// request on every request/span hot path. Authentication keys, signatures and
// operator tokens continue to use node:crypto in their dedicated components.
const RANDOM_SEED = `${Date.now()}:${process.hrtime.bigint()}:${process.pid}:${process.ppid}:${Math.random()}:${process.uptime()}`;
let randomState0 = seedWord(RANDOM_SEED, 0x243f6a88);
let randomState1 = seedWord(RANDOM_SEED, 0x85a308d3);
let randomState2 = seedWord(RANDOM_SEED, 0x13198a2e);
let randomState3 = seedWord(RANDOM_SEED, 0x03707344);
if ((randomState0 | randomState1 | randomState2 | randomState3) === 0) randomState3 = 1;
let identifierCounter = 0;
const PROCESS_IDENTIFIER = nextRandomHex(6);

export const randomId = (prefix = '') => {
  identifierCounter = identifierCounter >= Number.MAX_SAFE_INTEGER ? 1 : identifierCounter + 1;
  const head = prefix ? `${prefix}_` : '';
  return `${head}${Date.now().toString(36)}-${process.pid.toString(36)}-${identifierCounter.toString(36)}-${PROCESS_IDENTIFIER}`;
};
export const randomHex = (bytes) => nextRandomHex(bytes);
export const sha256 = (value) => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stableJson(value)).digest('hex');

function seedWord(seed, salt) {
  let hash = (0x811c9dc5 ^ salt) >>> 0;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || (salt >>> 0) || 1;
}
function rotateLeft(value, shift) { return ((value << shift) | (value >>> (32 - shift))) >>> 0; }
function nextRandomWord() {
  const result = Math.imul(rotateLeft(Math.imul(randomState1, 5) >>> 0, 7), 9) >>> 0;
  const temporary = (randomState1 << 9) >>> 0;
  randomState2 ^= randomState0;
  randomState3 ^= randomState1;
  randomState1 ^= randomState2;
  randomState0 ^= randomState3;
  randomState2 ^= temporary;
  randomState3 = rotateLeft(randomState3, 11);
  return result;
}
function nextRandomHex(bytes) {
  const length = Number(bytes);
  if (!Number.isSafeInteger(length) || length < 1 || length > 1_048_576) throw new TypeError('randomHex(bytes) requires a positive safe byte count no greater than 1 MiB.');
  let output = '';
  let remaining = length;
  while (remaining >= 4) {
    output += nextRandomWord().toString(16).padStart(8, '0');
    remaining -= 4;
  }
  if (remaining > 0) output += nextRandomWord().toString(16).padStart(8, '0').slice(0, remaining * 2);
  return output;
}

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

export function cloneValue(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch {}
  }
  return JSON.parse(JSON.stringify(value));
}

export function stableValue(value, seen = new WeakSet()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => stableValue(item, seen));
  const output = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (BLOCKED_OBJECT_KEYS.has(key)) continue;
    output[key] = stableValue(value[key], seen);
  }
  return output;
}

export function stableJson(value) { return JSON.stringify(stableValue(value)); }

export function safeGet(value, path, fallback = undefined) {
  if (!path) return value === undefined ? fallback : value;
  let current = value;
  for (const part of Array.isArray(path) ? path : String(path).split('.')) {
    if (BLOCKED_OBJECT_KEYS.has(part) || current == null || typeof current !== 'object') return fallback;
    current = current[part];
  }
  return current === undefined ? fallback : current;
}

export function safeResolve(app, key, fallback = null) {
  try {
    if (typeof app?.tryResolve === 'function') return app.tryResolve(key, fallback);
    if (typeof app?.resolve === 'function') {
      const value = app.resolve(key);
      return value === undefined ? fallback : value;
    }
    if (typeof app?.container?.resolve === 'function') {
      const value = app.container.resolve(key);
      return value === undefined ? fallback : value;
    }
  } catch {}
  return fallback;
}

export function hasBinding(app, key) {
  try {
    return app?.bound?.(key) === true || app?.has?.(key) === true || app?.container?.bound?.(key) === true || app?.container?.has?.(key) === true;
  } catch { return false; }
}

export function bytesOf(value, max = Number.MAX_SAFE_INTEGER) {
  if (value == null) return 0;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return Math.min(max, value.byteLength);
  if (value instanceof ArrayBuffer) return Math.min(max, value.byteLength);
  if (typeof value === 'string') return Math.min(max, Buffer.byteLength(value));
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') return 16;
  try { return Math.min(max, Buffer.byteLength(JSON.stringify(value))); }
  catch { return Math.min(max, 512); }
}

export function boundedInteger(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

export function boundedNumber(value, fallback, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

export function bool(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

export function list(value, fallback = []) {
  if (Array.isArray(value)) return Array.from(new Set(value.map(String).map((item) => item.trim()).filter(Boolean)));
  if (value == null || value === '') return [...fallback];
  return Array.from(new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean)));
}

export function parseDuration(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value === 'number') return boundedInteger(Math.trunc(value), fallback, minimum, maximum);
  const match = /^(-?\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(String(value ?? '').trim());
  if (!match) return fallback;
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[(match[2] || 'ms').toLowerCase()];
  return boundedInteger(Math.trunc(Number(match[1]) * scale), fallback, minimum, maximum);
}

export function parseBytes(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value === 'number') return boundedInteger(Math.trunc(value), fallback, minimum, maximum);
  const match = /^(-?\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/i.exec(String(value ?? '').trim());
  if (!match) return fallback;
  const scale = { b: 1, kb: 1_000, kib: 1_024, mb: 1_000_000, mib: 1_048_576, gb: 1_000_000_000, gib: 1_073_741_824 }[(match[2] || 'b').toLowerCase()];
  return boundedInteger(Math.trunc(Number(match[1]) * scale), fallback, minimum, maximum);
}

export function sanitizeMetricName(value, fallback = 'rawnode_monitor_metric') {
  const name = String(value || '').trim().replace(/[^a-zA-Z0-9_:]/g, '_').replace(/^[^a-zA-Z_:]+/, '');
  return name || fallback;
}

export function sanitizeLabelName(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[^a-zA-Z_]+/, '') || 'label';
}

export function normalizeLabels(labels = {}, options = {}) {
  const output = Object.create(null);
  const maxLabels = boundedInteger(options.maxLabels, 32, 0, 256);
  const maxValueBytes = boundedInteger(options.maxValueBytes, 256, 1, 16_384);
  let count = 0;
  for (const key of Object.keys(labels || {}).sort()) {
    if (count >= maxLabels || BLOCKED_OBJECT_KEYS.has(key)) break;
    if (Buffer.byteLength(key) > 128) continue;
    const name = sanitizeLabelName(key);
    const value = String(labels[key] ?? '');
    if (Buffer.byteLength(value) > maxValueBytes) continue;
    output[name] = value;
    count++;
  }
  return Object.freeze(output);
}

export function labelsKey(labels = {}) {
  return Object.entries(labels).map(([key, value]) => `${key.length}:${key}=${String(value).length}:${value}`).join('|');
}

export function errorRecord(error, options = {}) {
  if (!error) return null;
  const record = {
    name: error.name || 'Error',
    code: error.code || null,
    message: error.message || String(error),
    retryable: error.retryable === true,
  };
  if (options.stack === true && error.stack) record.stack = String(error.stack).slice(0, options.maxStackBytes || 64 * 1024);
  if (error.details && typeof error.details === 'object') record.details = error.details;
  return record;
}

export async function withTimeout(task, timeoutMs, options = {}) {
  const ms = boundedInteger(timeoutMs, 5_000, 1, 24 * 60 * 60_000);
  const controller = new AbortController();
  const external = options.signal;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { const error = external.reason || Object.assign(new Error('Operation aborted.'), { name: 'AbortError', code: 'ABORT_ERR' }); controller.abort(error); rejectAbort(error); };
  if (external?.aborted) { controller.abort(external.reason); throw external.reason || Object.assign(new Error('Operation aborted.'), { name: 'AbortError', code: 'ABORT_ERR' }); }
  external?.addEventListener?.('abort', onAbort, { once: true });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new MonitorTimeoutError(options.message || `Operation exceeded ${ms}ms.`, { details: { timeoutMs: ms } });
      controller.abort(error);
      reject(error);
    }, ms);
    if (options.ref === false) timer.unref?.();
  });
  try {
    const operation = typeof task === 'function' ? task(controller.signal) : task;
    return await Promise.race([Promise.resolve(operation), timeout, aborted]);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener?.('abort', onAbort);
  }
}

export async function cooperativeYield(signal = null) {
  signal?.throwIfAborted?.();
  await new Promise((resolve) => setImmediate(resolve));
  signal?.throwIfAborted?.();
}

export async function retry(operation, options = {}) {
  const attempts = boundedInteger(options.attempts, 3, 1, 100);
  const baseMs = boundedInteger(options.baseMs, 50, 0, 60_000);
  const maxMs = boundedInteger(options.maxMs, 5_000, baseMs, 300_000);
  let last;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    options.signal?.throwIfAborted?.();
    try { return await operation(attempt, options.signal); }
    catch (error) {
      last = error;
      if (attempt >= attempts || options.retryWhen?.(error, attempt) === false) break;
      const wait = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
      await delay(wait + Math.floor(Math.random() * Math.max(1, wait / 4)), undefined, { signal: options.signal, ref: options.ref !== false });
    }
  }
  throw last;
}

export function dispatchEvent(events, name, payload) {
  if (!events) return false;
  try {
    const result = typeof events.dispatch === 'function' ? events.dispatch(name, payload) : events.emit?.(name, payload);
    result?.catch?.(noop);
    return true;
  } catch { return false; }
}

export function callFirst(value, methods, ...args) {
  for (const name of methods) {
    if (typeof value?.[name] === 'function') return value[name](...args);
  }
  return undefined;
}
