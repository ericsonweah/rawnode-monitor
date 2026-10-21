'use strict';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { MONITOR_SCHEMA_VERSION } from '../constants.js';
import { bytesOf, deepFreeze, randomId, stableJson } from '../support.js';

export function createMonitorClusterEnvelope(type, payload, options = {}) {
  const envelope = {
    schemaVersion: MONITOR_SCHEMA_VERSION,
    id: options.id || randomId('monmsg'),
    type: String(type || 'signal'),
    namespace: String(options.namespace || 'default'),
    source: options.source || `${process.pid}`,
    timestamp: Number(options.timestamp || Date.now()),
    expiresAt: Number(options.expiresAt || (Date.now() + (Number(options.ttlMs) || 60_000))),
    nonce: options.nonce || randomId('nonce'),
    payload,
  };
  const maxBytes = Math.max(1_024, Number(options.maxBytes) || 2 * 1024 * 1024);
  if (bytesOf(envelope, maxBytes + 1) > maxBytes) throw Object.assign(new Error('Monitor cluster envelope exceeds the configured byte limit.'), { code: 'MONITOR_CLUSTER_ENVELOPE_TOO_LARGE' });
  if (options.secret) envelope.signature = signEnvelope(envelope, options.secret);
  return deepFreeze(envelope);
}

export function signEnvelope(envelope, secret) {
  return createHmac('sha256', secret).update(canonical(envelope)).digest('base64url');
}

export function verifyMonitorClusterEnvelope(envelope, options = {}) {
  if (!envelope || typeof envelope !== 'object') return { ok: false, reason: 'invalid-envelope' };
  if (Number(envelope.schemaVersion) !== MONITOR_SCHEMA_VERSION) return { ok: false, reason: 'schema-version' };
  if (options.namespace && String(envelope.namespace) !== String(options.namespace)) return { ok: false, reason: 'namespace' };
  if (Number(envelope.expiresAt || 0) <= Date.now()) return { ok: false, reason: 'expired' };
  const maxClockSkewMs = Math.max(0, Number(options.maxClockSkewMs) || 60_000);
  if (Math.abs(Date.now() - Number(envelope.timestamp || 0)) > Math.max(maxClockSkewMs, Number(options.maxAgeMs) || 5 * 60_000)) return { ok: false, reason: 'timestamp' };
  if (options.secret) {
    if (!envelope.signature) return { ok: false, reason: 'signature-missing' };
    const expected = Buffer.from(signEnvelope(envelope, options.secret));
    const actual = Buffer.from(String(envelope.signature));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, reason: 'signature-invalid' };
  }
  return { ok: true, envelope };
}

function canonical(envelope) {
  const { signature: _signature, ...unsigned } = envelope;
  return stableJson(unsigned);
}

export default createMonitorClusterEnvelope;
