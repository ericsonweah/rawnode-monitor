'use strict';

export function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function safeError(error) {
  if (!error) return null;
  return Object.freeze({
    name: error.name || 'Error',
    message: error.message || String(error),
    code: error.code || null,
  });
}

export function clonePublic(value, options = {}, depth = 0, seen = new WeakSet()) {
  const maxDepth = Math.max(1, Number(options.maxDepth) || 12);
  const maxKeys = Math.max(1, Number(options.maxKeys) || 2_048);
  const maxArray = Math.max(1, Number(options.maxArray) || 1_000);
  const sensitive = options.sensitive || /secret|password|token|authorization|cookie|signature|private|credential/i;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 8_192 ? `${value.slice(0, 8_192)}…` : value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (depth >= maxDepth) return '[DepthLimit]';
  if (seen.has(value)) return '[Circular]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[Uint8Array ${value.byteLength} bytes]`;
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, maxArray).map((entry) => clonePublic(entry, options, depth + 1, seen));
  const output = Object.create(null);
  let count = 0;
  for (const [key, child] of Object.entries(value)) {
    if (++count > maxKeys) { output.__truncated__ = true; break; }
    output[key] = sensitive.test(key) ? '[redacted]' : clonePublic(child, options, depth + 1, seen);
  }
  return output;
}
