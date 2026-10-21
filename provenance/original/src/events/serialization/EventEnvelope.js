'use strict';

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { EventTransportError } from '../errors/EventError.js';

export const EVENT_ENVELOPE_VERSION = 2;

const TYPED_ARRAY_NAMES = new Set([
  'Uint8Array', 'Uint8ClampedArray', 'Int8Array',
  'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
]);

function encodeString(value) {
  return JSON.stringify(String(value));
}

function numberToken(value) {
  if (Number.isNaN(value)) return 'd:NaN';
  if (value === Infinity) return 'd:+Infinity';
  if (value === -Infinity) return 'd:-Infinity';
  if (Object.is(value, -0)) return 'd:-0';
  return `d:${String(value)}`;
}

function taggedToken(value, state, depth, path) {
  const type = value?.__rnType;
  if (typeof type !== 'string') return null;

  switch (type) {
    case 'Undefined': return 'u';
    case 'BigInt': return `i:${String(value.value || '0')}`;
    case 'Buffer': return `x:Buffer:${String(value.value || '')}`;
    case 'Date': return `t:${encodeString(value.value || '')}`;
    case 'RegExp': return `g:${encodeString(value.source || '')}:${encodeString(value.flags || '')}`;
    case 'Map': {
      const entries = Array.isArray(value.value) ? value.value : [];
      return `m:[${entries.map((entry, index) => {
        const pair = Array.isArray(entry) ? entry : [undefined, undefined];
        return `${canonicalToken(pair[0], state, depth + 1, `${path}.map[${index}].key`)}=>${canonicalToken(pair[1], state, depth + 1, `${path}.map[${index}].value`)}`;
      }).join(',')}]`;
    }
    case 'Set': {
      const entries = Array.isArray(value.value) ? value.value : [];
      return `q:[${entries.map((entry, index) => canonicalToken(entry, state, depth + 1, `${path}.set[${index}]`)).join(',')}]`;
    }
    case 'Error':
      return `e:${canonicalToken({
        name: value.name || 'Error',
        message: value.message || '',
        stack: value.stack || '',
        code: value.code,
        details: value.details,
      }, state, depth + 1, `${path}.error`)}`;
    default:
      if (TYPED_ARRAY_NAMES.has(type) && typeof value.value === 'string') {
        return `x:${type}:${value.value}`;
      }
      return null;
  }
}

/**
 * Deterministic, type-aware canonicalization used only for signing.
 *
 * It intentionally does not depend on JSON.stringify so BigInt, Buffer, Error,
 * Date, Map, Set and typed arrays are valid envelope values. Object keys are
 * sorted, special numeric values are distinct, and cycles are represented by a
 * stable first-seen path. SafeJsonCodec tagged wire values canonicalize to the
 * same tokens as their reconstructed runtime counterparts.
 */
function canonicalToken(value, state, depth, path) {
  if (depth > state.maxDepth) return `z:${encodeString('[MaxDepth]')}`;
  if (value === null) return 'n';
  if (value === undefined) return 'u';

  const primitive = typeof value;
  if (primitive === 'string') return `s:${encodeString(value)}`;
  if (primitive === 'boolean') return value ? 'b:1' : 'b:0';
  if (primitive === 'number') return numberToken(value);
  if (primitive === 'bigint') return `i:${value.toString()}`;
  if (primitive === 'symbol') return `y:${encodeString(value.description || '')}`;
  if (primitive === 'function') return `f:${encodeString(value.name || 'anonymous')}`;

  const tagged = taggedToken(value, state, depth, path);
  if (tagged !== null) return tagged;

  if (Buffer.isBuffer(value)) return `x:Buffer:${value.toString('base64')}`;
  if (value instanceof Uint8Array) {
    const name = value.constructor?.name || 'Uint8Array';
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
    return `x:${name}:${bytes}`;
  }
  if (value instanceof Date) {
    return `t:${encodeString(Number.isFinite(value.getTime()) ? value.toISOString() : '')}`;
  }
  if (value instanceof RegExp) return `g:${encodeString(value.source)}:${encodeString(value.flags)}`;
  if (value instanceof Error) {
    return `e:${canonicalToken({
      name: value.name || 'Error',
      message: value.message || '',
      stack: value.stack || '',
      code: value.code,
      details: value.details,
    }, state, depth + 1, `${path}.error`)}`;
  }

  if (state.seen.has(value)) return `r:${encodeString(state.seen.get(value))}`;
  state.seen.set(value, path);

  if (Array.isArray(value)) {
    return `a:${value.length}:[${value.map((entry, index) => canonicalToken(entry, state, depth + 1, `${path}[${index}]`)).join(',')}]`;
  }

  if (value instanceof Map) {
    const entries = [];
    let index = 0;
    for (const [key, entry] of value) {
      entries.push(`${canonicalToken(key, state, depth + 1, `${path}.map[${index}].key`)}=>${canonicalToken(entry, state, depth + 1, `${path}.map[${index}].value`)}`);
      index++;
    }
    return `m:[${entries.join(',')}]`;
  }

  if (value instanceof Set) {
    const entries = [];
    let index = 0;
    for (const entry of value) {
      entries.push(canonicalToken(entry, state, depth + 1, `${path}.set[${index++}]`));
    }
    return `q:[${entries.join(',')}]`;
  }

  const keys = Object.keys(value).sort();
  const entries = [];
  for (const key of keys) {
    let entry;
    try { entry = value[key]; }
    catch (error) { entry = `[GetterError:${error?.message || error}]`; }
    entries.push(`${encodeString(key)}:${canonicalToken(entry, state, depth + 1, `${path}.${key}`)}`);
  }
  return `o:{${entries.join(',')}}`;
}

export function canonicalizeEventEnvelope(envelope, options = {}) {
  const selected = {
    v: Number(envelope?.v) || 0,
    id: envelope?.id == null ? '' : String(envelope.id),
    node: envelope?.node == null ? '' : String(envelope.node),
    ts: Number(envelope?.ts) || 0,
    expiresAt: Number(envelope?.expiresAt) || 0,
    hop: Number(envelope?.hop) || 0,
    namespace: envelope?.namespace == null ? '' : String(envelope.namespace),
    event: envelope?.event == null ? '' : String(envelope.event),
    args: Array.isArray(envelope?.args) ? envelope.args : [],
    ctx: envelope?.ctx ?? null,
    headers: envelope?.headers ?? null,
  };
  return canonicalToken(selected, {
    seen: new WeakMap(),
    maxDepth: Math.max(8, Number(options.maxDepth) || 128),
  }, 0, '$');
}

export function signEventEnvelope(envelope, secret) {
  if (!secret) return null;
  return createHmac('sha256', secret)
    .update(canonicalizeEventEnvelope(envelope))
    .digest('base64url');
}

export function verifyEventEnvelopeSignature(envelope, secret) {
  if (!secret) return true;
  if (typeof envelope?.signature !== 'string' || !envelope.signature) return false;

  let expected;
  let actual;
  try {
    expected = Buffer.from(signEventEnvelope({ ...envelope, signature: undefined }, secret), 'base64url');
    actual = Buffer.from(envelope.signature, 'base64url');
  } catch {
    return false;
  }
  return expected.length === actual.length && expected.length > 0 && timingSafeEqual(expected, actual);
}

export function createEventEnvelope(eventName, args = [], options = {}) {
  const now = Number(options.ts) || Date.now();
  const envelope = {
    v: EVENT_ENVELOPE_VERSION,
    id: options.id || randomUUID(),
    node: String(options.nodeId || options.node || ''),
    ts: now,
    expiresAt: Number(options.expiresAt) || (Number(options.ttlMs) > 0 ? now + Number(options.ttlMs) : 0),
    hop: Math.max(0, Number(options.hop) || 0),
    namespace: options.namespace ? String(options.namespace) : 'default',
    event: String(eventName),
    args: Array.isArray(args) ? args : [args],
    ctx: options.context && typeof options.context === 'object' ? options.context : null,
    headers: options.headers && typeof options.headers === 'object' ? options.headers : null,
  };
  if (options.secret) envelope.signature = signEventEnvelope(envelope, options.secret);
  return envelope;
}

export function normalizeEventEnvelope(input) {
  if (!input || typeof input !== 'object') return null;
  if (Number(input.v) === 1) {
    return {
      v: 1,
      id: input.id,
      node: input.node,
      ts: input.ts,
      expiresAt: input.expiresAt || 0,
      hop: input.hop || 0,
      // Old v1 producers did not include a namespace. Preserve that absence so
      // a configured receiver can adopt its local namespace compatibly.
      namespace: input.namespace == null ? null : String(input.namespace),
      event: input.event,
      args: Array.isArray(input.args) ? input.args : [],
      ctx: input.ctx && typeof input.ctx === 'object' ? input.ctx : null,
      headers: input.headers && typeof input.headers === 'object' ? input.headers : null,
      signature: input.signature,
    };
  }
  return input;
}

export function validateEventEnvelope(input, options = {}) {
  const envelope = normalizeEventEnvelope(input);
  const fail = (reason, code = 'EVENT_ENVELOPE_INVALID') => ({ ok: false, reason, code, envelope });
  if (!envelope) return fail('Envelope must be an object');

  const version = Number(envelope.v);
  const acceptedVersions = options.acceptedVersions || [1, EVENT_ENVELOPE_VERSION];
  if (!acceptedVersions.includes(version)) return fail(`Unsupported envelope version ${envelope.v}`, 'EVENT_ENVELOPE_VERSION');
  if (typeof envelope.id !== 'string' || !envelope.id || Buffer.byteLength(envelope.id) > (options.maxIdBytes || 256)) return fail('Invalid envelope id');
  if (typeof envelope.node !== 'string' || !envelope.node || Buffer.byteLength(envelope.node) > (options.maxNodeBytes || 256)) return fail('Invalid origin node');
  if (typeof envelope.event !== 'string' || !envelope.event) return fail('Invalid event name');
  if (Buffer.byteLength(envelope.event) > (options.maxEventNameBytes || 512)) return fail('Event name is too large', 'EVENT_ENVELOPE_EVENT_NAME_BYTES');
  if (!Array.isArray(envelope.args)) return fail('Envelope args must be an array');
  if (envelope.args.length > (options.maxArgs || 128)) return fail('Envelope has too many arguments', 'EVENT_ENVELOPE_MAX_ARGS');

  const now = Number(options.now) || Date.now();
  const maxAgeMs = Math.max(0, Number(options.maxAgeMs) || 0);
  if (!Number.isFinite(Number(envelope.ts))) return fail('Invalid envelope timestamp');
  if (maxAgeMs && now - Number(envelope.ts) > maxAgeMs) return fail('Envelope is too old', 'EVENT_ENVELOPE_EXPIRED');
  if (Number(envelope.ts) - now > (Number(options.maxClockSkewMs) || 30_000)) return fail('Envelope timestamp is in the future', 'EVENT_ENVELOPE_CLOCK_SKEW');
  if (Number(envelope.expiresAt) > 0 && now >= Number(envelope.expiresAt)) return fail('Envelope expired', 'EVENT_ENVELOPE_EXPIRED');
  if ((Number(envelope.hop) || 0) > (Number(options.maxHops) || 4)) return fail('Envelope exceeded hop limit', 'EVENT_ENVELOPE_HOPS');

  if (options.namespace) {
    if (version === 1 && envelope.namespace == null) {
      envelope.namespace = String(options.namespace);
    } else if (String(envelope.namespace || 'default') !== String(options.namespace)) {
      return fail('Envelope namespace mismatch', 'EVENT_ENVELOPE_NAMESPACE');
    }
  }

  const unsignedLegacyAccepted = version === 1 && options.acceptUnsignedV1 !== false && !envelope.signature;
  if (options.secret && !unsignedLegacyAccepted && !verifyEventEnvelopeSignature(envelope, options.secret)) {
    return fail('Envelope signature is invalid', 'EVENT_ENVELOPE_SIGNATURE');
  }
  return { ok: true, envelope };
}

export function assertEventEnvelope(input, options = {}) {
  const result = validateEventEnvelope(input, options);
  if (!result.ok) {
    throw new EventTransportError(result.reason, {
      code: result.code,
      details: { envelopeId: result.envelope?.id },
    });
  }
  return result.envelope;
}
