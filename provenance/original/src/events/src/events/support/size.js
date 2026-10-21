'use strict';

const OBJECT_OVERHEAD = 8;
const ACCESSOR_OVERHEAD = 8;
const FUNCTION_FALLBACK = 'function';
const ERROR_NAME_FALLBACK = 'Error';

/**
 * Estimate a value's retained byte footprint without serializing it.
 *
 * This utility is intentionally defensive because event payloads can contain
 * callable proxies, framework facades, host objects, accessors, circular
 * references, and revoked proxies. Size estimation must never execute user
 * getters or escape as an infrastructure exception.
 */
export function approximateByteSize(value, options = {}) {
  const maximum = normalizeMaximum(options.maximum);
  const maxDepth = positiveInteger(options.maxDepth, 32);
  const maxItems = positiveInteger(options.maxItems, 100_000);
  const seen = new WeakSet();
  let items = 0;

  function visit(current, depth) {
    if (items++ > maxItems) return maximum;

    try {
      return visitUnsafe(current, depth);
    } catch {
      /*
       * Fail closed. Callers normally pass `limit + 1` as maximum, so an
       * uninspectable value is rejected as oversized instead of crashing the
       * application request that emitted the event.
       */
      return maximum;
    }
  }

  function visitUnsafe(current, depth) {
    if (current == null) return 4;

    switch (typeof current) {
      case 'string':
        return utf8Bytes(current);

      case 'number':
        return 8;

      case 'bigint':
        return utf8Bytes(current.toString()) + 1;

      case 'boolean':
        return 4;

      case 'undefined':
        return 0;

      case 'symbol':
        return utf8Bytes(safeSymbolText(current));

      case 'function':
        return utf8Bytes(safeFunctionName(current));

      default:
        break;
    }

    if (Buffer.isBuffer(current)) return current.byteLength;
    if (current instanceof Uint8Array) return current.byteLength;
    if (current instanceof ArrayBuffer) return current.byteLength;
    if (typeof SharedArrayBuffer !== 'undefined' && current instanceof SharedArrayBuffer) {
      return current.byteLength;
    }
    if (current instanceof Date) return 24;
    if (current instanceof RegExp) {
      return boundedAdd(
        utf8Bytes(safeStringProperty(current, 'source', '')),
        utf8Bytes(safeStringProperty(current, 'flags', '')),
        maximum,
      );
    }
    if (current instanceof Error) {
      return boundedAdd(
        utf8Bytes(safeStringProperty(current, 'name', ERROR_NAME_FALLBACK)),
        utf8Bytes(safeStringProperty(current, 'message', '')),
        maximum,
      );
    }

    if (depth >= maxDepth) return OBJECT_OVERHEAD;
    if (seen.has(current)) return OBJECT_OVERHEAD;
    seen.add(current);

    let total = OBJECT_OVERHEAD;
    const add = (bytes) => {
      total += bytes;
      if (total >= maximum) total = maximum;
      return total < maximum;
    };

    if (Array.isArray(current)) {
      const length = safeArrayLength(current);

      for (let index = 0; index < length; index++) {
        let item;
        try {
          item = current[index];
        } catch {
          item = '[ReadError]';
        }

        if (!add(visit(item, depth + 1))) break;
      }

      return total;
    }

    if (current instanceof Set) {
      try {
        for (const item of current) {
          if (!add(visit(item, depth + 1))) break;
        }
      } catch {
        return maximum;
      }

      return total;
    }

    if (current instanceof Map) {
      try {
        for (const [key, item] of current) {
          if (!add(visit(key, depth + 1))) break;
          if (!add(visit(item, depth + 1))) break;
        }
      } catch {
        return maximum;
      }

      return total;
    }

    let keys;
    try {
      keys = Object.keys(current);
    } catch {
      return maximum;
    }

    for (const key of keys) {
      if (!add(utf8Bytes(key))) break;

      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(current, key);
      } catch {
        return maximum;
      }

      if (!descriptor) continue;

      /*
       * Never invoke accessors while measuring an event. Getters can perform
       * I/O, mutate state, throw, or expose secrets. Count the accessor as a
       * bounded opaque slot instead.
       */
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        if (!add(ACCESSOR_OVERHEAD)) break;
        continue;
      }

      if (!add(visit(descriptor.value, depth + 1))) break;
    }

    return total;
  }

  return Math.min(maximum, visit(value, 0));
}

export function normalizeByteLimit(value, fallback = Infinity) {
  if (value === Infinity) return Infinity;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

export function normalizePositiveInteger(value, fallback, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  if (allowZero ? number < 0 : number < 1) return fallback;
  return number;
}

function safeFunctionName(value) {
  return safeStringProperty(value, 'name', FUNCTION_FALLBACK);
}

function safeStringProperty(target, key, fallback = '') {
  try {
    const value = Reflect.get(target, key);
    return typeof value === 'string' && value.length > 0
      ? value
      : fallback;
  } catch {
    return fallback;
  }
}

function safeSymbolText(value) {
  try {
    return String(value);
  } catch {
    return 'Symbol';
  }
}

function safeArrayLength(value) {
  try {
    const length = Number(value.length);
    return Number.isSafeInteger(length) && length >= 0 ? length : 0;
  } catch {
    return 0;
  }
}

function utf8Bytes(value) {
  return Buffer.byteLength(
    typeof value === 'string' ? value : '',
    'utf8',
  );
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function normalizeMaximum(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? number
    : Number.MAX_SAFE_INTEGER;
}

function boundedAdd(left, right, maximum) {
  return Math.min(maximum, left + right);
}

export function estimateValueBytes(value, options = {}) {
  return approximateByteSize(value, options);
}
