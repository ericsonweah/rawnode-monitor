'use strict';

import { TraceContextError } from '../errors.js';
import { randomHex } from '../support.js';

const TRACEPARENT = /^(?<version>[\da-f]{2})-(?<traceId>[\da-f]{32})-(?<spanId>[\da-f]{16})-(?<flags>[\da-f]{2})(?:-(?<extra>.*))?$/i;
const ZERO_TRACE = '00000000000000000000000000000000';
const ZERO_SPAN = '0000000000000000';

export class TraceContext {
  constructor(options = {}) {
    this.traceId = validateTraceId(options.traceId || randomHex(16));
    this.spanId = validateSpanId(options.spanId || randomHex(8));
    this.traceFlags = Number(options.traceFlags ?? (options.sampled === false ? 0 : 1)) & 0xff;
    this.traceState = options.traceState ? String(options.traceState).slice(0, 512) : null;
    this.baggage = Object.freeze({ ...(options.baggage || {}) });
    this.remote = options.remote === true;
    this.version = options.version || '00';
    Object.freeze(this);
  }

  get sampled() { return (this.traceFlags & 1) === 1; }
  traceparent() { return `${this.version}-${this.traceId}-${this.spanId}-${this.traceFlags.toString(16).padStart(2, '0')}`; }
  child(spanId = randomHex(8), options = {}) { return new TraceContext({ ...this, ...options, traceId: this.traceId, spanId, remote: false }); }
  toJSON() { return { traceId: this.traceId, spanId: this.spanId, traceFlags: this.traceFlags, sampled: this.sampled, traceState: this.traceState, baggage: this.baggage, remote: this.remote }; }
}

export function parseTraceParent(value, options = {}) {
  if (!value) return null;
  const input = String(value).trim().toLowerCase();
  const match = TRACEPARENT.exec(input);
  if (!match?.groups || match.groups.version === 'ff') {
    if (options.strict) throw new TraceContextError('Invalid W3C traceparent header.');
    return null;
  }
  if (match.groups.version === '00' && match.groups.extra) {
    if (options.strict) throw new TraceContextError('W3C traceparent version 00 cannot contain extension fields.');
    return null;
  }
  try {
    return new TraceContext({
      version: match.groups.version,
      traceId: match.groups.traceId,
      spanId: match.groups.spanId,
      traceFlags: parseInt(match.groups.flags, 16),
      traceState: options.traceState || null,
      baggage: options.baggage || {},
      remote: true,
    });
  } catch (error) {
    if (options.strict) throw error;
    return null;
  }
}

export function parseBaggage(value, options = {}) {
  if (!value) return Object.freeze({});
  const maxItems = Math.max(1, Number(options.maxItems) || 64);
  const maxBytes = Math.max(1, Number(options.maxBytes) || 8_192);
  const input = String(value).slice(0, maxBytes);
  const output = Object.create(null);
  for (const part of input.split(',').slice(0, maxItems)) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey || !rest.length) continue;
    let key;
    try { key = decodeURIComponent(rawKey.trim()); } catch { continue; }
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key)) continue;
    const rawValue = rest.join('=').split(';')[0].trim();
    try { output[key] = decodeURIComponent(rawValue); } catch { output[key] = rawValue; }
  }
  return Object.freeze(output);
}

export function formatBaggage(baggage = {}, options = {}) {
  const maxItems = Math.max(1, Number(options.maxItems) || 64);
  const maxBytes = Math.max(1, Number(options.maxBytes) || 8_192);
  const parts = [];
  for (const [key, value] of Object.entries(baggage).slice(0, maxItems)) {
    const part = `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
    if (Buffer.byteLength([...parts, part].join(',')) > maxBytes) break;
    parts.push(part);
  }
  return parts.join(',');
}

export function extractTraceContext(carrier = {}, options = {}) {
  const get = options.get || ((source, key) => source?.[key] ?? source?.[key.toLowerCase()] ?? source?.[key.toUpperCase()]);
  const baggage = parseBaggage(get(carrier, 'baggage'), options.baggage);
  return parseTraceParent(get(carrier, 'traceparent'), { strict: options.strict, traceState: get(carrier, 'tracestate'), baggage });
}

export function injectTraceContext(context, carrier = {}, options = {}) {
  if (!context) return carrier;
  const set = options.set || ((target, key, value) => { target[key] = value; });
  const traceparent = typeof context.traceparent === 'function'
    ? context.traceparent()
    : `${context.version || '00'}-${validateTraceId(context.traceId)}-${validateSpanId(context.spanId)}-${Number(context.traceFlags ?? (context.sampled === false ? 0 : 1)).toString(16).padStart(2, '0')}`;
  set(carrier, 'traceparent', traceparent);
  if (context.traceState) set(carrier, 'tracestate', context.traceState);
  const baggage = formatBaggage(context.baggage, options.baggage);
  if (baggage) set(carrier, 'baggage', baggage);
  return carrier;
}

function validateTraceId(value) {
  const text = String(value).toLowerCase();
  if (!/^[\da-f]{32}$/.test(text) || text === ZERO_TRACE) throw new TraceContextError('Trace ID must be 32 non-zero hexadecimal characters.');
  return text;
}
function validateSpanId(value) {
  const text = String(value).toLowerCase();
  if (!/^[\da-f]{16}$/.test(text) || text === ZERO_SPAN) throw new TraceContextError('Span ID must be 16 non-zero hexadecimal characters.');
  return text;
}

export default TraceContext;
