'use strict';

import { assertEventName, byteLength, cloneSafe, deepFreeze, stableStringify, toUint8Array } from '../support/safe.js';

export const UNIVERSAL_EVENT_PROTOCOL = 'rawnode.events';
export const UNIVERSAL_EVENT_PROTOCOL_VERSION = 3;

export class UniversalEventEnvelope {
  constructor(value) { Object.assign(this, value); deepFreeze(this); }

  static async create(operation = {}, options = {}) {
    const runtime = options.runtime;
    const now = Number(operation.occurredAt || runtime?.now?.() || Date.now());
    const eventName = assertEventName(operation.name || operation.eventName, options.limits || {});
    const eventId = String(operation.id || operation.eventId || runtime?.randomId?.('evt') || `evt_${now.toString(36)}_${Math.random().toString(36).slice(2)}`);
    const context = operation.context && typeof operation.context === 'object' ? operation.context : {};
    const source = operation.source && typeof operation.source === 'object' ? operation.source : {};
    const delivery = operation.delivery && typeof operation.delivery === 'object' ? operation.delivery : {};
    const routing = operation.routing && typeof operation.routing === 'object' ? operation.routing : {};
    const securityInput = operation.security && typeof operation.security === 'object' ? operation.security : {};
    const content = operation.content && typeof operation.content === 'object'
      ? operation.content
      : {
          codec: operation.codec || 'json',
          contentType: operation.contentType || 'application/json',
          schema: operation.schema || `${eventName}@${Math.max(1, Number(operation.version) || 1)}`,
          payload: operation.payload,
        };
    const value = {
      protocol: UNIVERSAL_EVENT_PROTOCOL,
      protocolVersion: UNIVERSAL_EVENT_PROTOCOL_VERSION,
      id: eventId,
      name: eventName,
      version: Math.max(1, Number(operation.version) || 1),
      occurredAt: now,
      emittedAt: Number(operation.emittedAt) || Number(runtime?.now?.() || Date.now()),
      expiresAt: operation.expiresAt == null ? (operation.ttlMs > 0 ? now + Number(operation.ttlMs) : null) : Number(operation.expiresAt),
      source: {
        application: source.application || options.application || null,
        runtime: source.runtime || runtime?.name || options.runtimeName || 'universal',
        runtimeId: source.runtimeId || runtime?.id || null,
        nodeId: source.nodeId || options.nodeId || null,
        processId: source.processId || options.processId || null,
        tabId: source.tabId || context.tabId || null,
        connectionId: source.connectionId || context.connectionId || null,
      },
      context: {
        contextId: context.id || context.contextId || null,
        correlationId: context.correlationId || context.id || eventId,
        causationId: context.causationId || null,
        traceId: context.traceId || null,
        spanId: context.spanId || null,
        requestId: context.requestId || null,
        tenantId: context.tenantId || null,
        actorId: context.actorId || null,
        baggage: context.baggage || null,
      },
      delivery: {
        mode: delivery.mode || operation.deliveryMode || 'best-effort',
        attempt: Math.max(1, Number(delivery.attempt) || 1),
        partitionKey: delivery.partitionKey ?? operation.partitionKey ?? null,
        sequence: delivery.sequence == null ? null : Number(delivery.sequence),
        idempotencyKey: delivery.idempotencyKey || operation.idempotencyKey || null,
        replyTo: delivery.replyTo || operation.replyTo || null,
        requestId: delivery.requestId || operation.requestId || null,
      },
      routing: {
        channel: routing.channel || operation.channel || null,
        audience: routing.audience || operation.audience || 'local',
        transports: Object.freeze(normalizeStrings(routing.transports || operation.transports || operation.via)),
        fallback: Object.freeze(normalizeStrings(routing.fallback || operation.fallback)),
        hops: Object.freeze(normalizeStrings(routing.hops || [])),
      },
      content: {
        codec: content.codec || 'json',
        contentType: content.contentType || 'application/json',
        schema: content.schema || `${eventName}@${Math.max(1, Number(operation.version) || 1)}`,
        payload: content.payload,
      },
      security: {
        classification: securityInput.classification || operation.classification || 'internal',
        authenticated: securityInput.authenticated === true,
        principal: securityInput.principal || null,
        keyId: securityInput.keyId || null,
        algorithm: securityInput.algorithm || null,
        signature: securityInput.signature || null,
        nonce: securityInput.nonce || runtime?.randomId?.('nonce') || null,
      },
      metadata: operation.metadata && typeof operation.metadata === 'object' ? cloneSafe(operation.metadata, { redact: true }) : null,
    };
    if (options.cryptoProvider && options.sign !== false) {
      // Resolve signing metadata first, then sign the final canonical form so
      // keyId and algorithm cannot be substituted without invalidating it.
      const provisional = await options.cryptoProvider.sign(
        toUint8Array(UniversalEventEnvelope.canonical(value)),
        {
          keyId: securityInput.keyId || options.keyId,
          purpose: 'event-envelope',
          envelope: value,
        },
      );
      if (provisional) {
        value.security = {
          ...value.security,
          keyId: provisional.keyId || value.security.keyId,
          algorithm: provisional.algorithm || value.security.algorithm,
          signature: null,
        };
        const signed = await options.cryptoProvider.sign(
          toUint8Array(UniversalEventEnvelope.canonical(value)),
          {
            keyId: value.security.keyId,
            algorithm: value.security.algorithm,
            purpose: 'event-envelope',
            envelope: value,
          },
        );
        value.security = {
          ...value.security,
          keyId: signed?.keyId || value.security.keyId,
          algorithm: signed?.algorithm || value.security.algorithm,
          signature: signed?.signature || signed || null,
        };
      }
    }
    const envelope = new UniversalEventEnvelope(value);
    const bytes = byteLength(JSON.stringify(envelope));
    if (options.limits?.maxEnvelopeBytes > 0 && bytes > options.limits.maxEnvelopeBytes) throw envelopeError(`Event envelope exceeds ${options.limits.maxEnvelopeBytes} bytes.`, 'EVENT_ENVELOPE_TOO_LARGE', { bytes, maximum: options.limits.maxEnvelopeBytes });
    return envelope;
  }

  static canonical(value) {
    const security = { ...(value.security || {}) };
    delete security.signature;
    return stableStringify({ ...value, security });
  }

  static normalize(input, options = {}) {
    const source = typeof input === 'string' ? JSON.parse(input) : input;
    if (!source || typeof source !== 'object') throw envelopeError('Event envelope must be an object.', 'EVENT_ENVELOPE_INVALID');
    const protocolVersion = Math.max(1, Number(source.protocolVersion || source.v || source.version || 1));
    const accepted = options.acceptedVersions || [1, 2, 3];
    if (!accepted.includes(protocolVersion)) throw envelopeError(`Unsupported event protocol version ${protocolVersion}.`, 'EVENT_ENVELOPE_VERSION_UNSUPPORTED', { protocolVersion, accepted });
    if (protocolVersion === 3 && source.protocol === UNIVERSAL_EVENT_PROTOCOL) return new UniversalEventEnvelope(source);
    return new UniversalEventEnvelope(normalizeLegacy(source, protocolVersion, options));
  }

  static async verify(input, options = {}) {
    const envelope = input instanceof UniversalEventEnvelope ? input : UniversalEventEnvelope.normalize(input, options);
    const now = Number(options.now) || Date.now();
    if (envelope.expiresAt && envelope.expiresAt <= now - Math.max(0, Number(options.maxClockSkewMs) || 0)) throw envelopeError('Event envelope has expired.', 'EVENT_ENVELOPE_EXPIRED');
    if ((envelope.routing?.hops?.length || 0) > Math.max(1, Number(options.maxHops) || 8)) throw envelopeError('Event envelope exceeded its hop limit.', 'EVENT_ENVELOPE_HOP_LIMIT');
    if (options.namespace && envelope.routing?.namespace && options.namespace !== envelope.routing.namespace) throw envelopeError('Event envelope namespace mismatch.', 'EVENT_ENVELOPE_NAMESPACE');
    const signature = envelope.security?.signature;
    if (!signature) {
      if (options.requireSignature === true) throw envelopeError('Event envelope signature is required.', 'EVENT_ENVELOPE_SIGNATURE_REQUIRED');
      return { ok: true, signed: false, envelope };
    }
    if (!options.cryptoProvider) throw envelopeError('A crypto provider is required to verify the event envelope.', 'EVENT_ENVELOPE_CRYPTO_REQUIRED');
    const ok = await options.cryptoProvider.verify(toUint8Array(UniversalEventEnvelope.canonical(envelope)), signature, {
      keyId: envelope.security?.keyId,
      algorithm: envelope.security?.algorithm,
      purpose: 'event-envelope',
      envelope,
    });
    if (!ok) throw envelopeError('Event envelope signature is invalid.', 'EVENT_ENVELOPE_SIGNATURE_INVALID');
    return { ok: true, signed: true, envelope };
  }

  withHop(hop) {
    return new UniversalEventEnvelope({ ...this, routing: { ...this.routing, hops: Object.freeze([...this.routing.hops, String(hop)]) } });
  }

  toJSON() { return { ...this }; }
  encode() { return JSON.stringify(this); }
  byteLength() { return byteLength(this.encode()); }
}

function normalizeLegacy(source, protocolVersion, options) {
  const name = assertEventName(source.name || source.event || source.eventName || source.type, options.limits || {});
  const payload = source.content?.payload ?? source.payload ?? source.args?.[0] ?? source.data ?? null;
  const context = source.context || source.meta?.context || {};
  return {
    protocol: UNIVERSAL_EVENT_PROTOCOL,
    protocolVersion,
    id: String(source.id || source.messageId || source.eventId || `legacy_${Date.now().toString(36)}`),
    name,
    version: Math.max(1, Number(source.eventVersion || source.schemaVersion || 1)),
    occurredAt: Number(source.occurredAt || source.createdAt || source.timestamp) || Date.now(),
    emittedAt: Number(source.emittedAt || source.createdAt || source.timestamp) || Date.now(),
    expiresAt: source.expiresAt == null ? null : Number(source.expiresAt),
    source: { application: source.application || null, runtime: source.runtime || 'legacy', runtimeId: null, nodeId: source.nodeId || source.origin || null, processId: null, tabId: null, connectionId: source.connectionId || null },
    context: { contextId: context.id || null, correlationId: context.correlationId || source.correlationId || null, causationId: context.causationId || source.causationId || null, traceId: context.traceId || null, spanId: context.spanId || null, requestId: context.requestId || null, tenantId: context.tenantId || source.tenantId || null, actorId: context.actorId || source.actorId || null, baggage: context.baggage || null },
    delivery: { mode: source.delivery?.mode || 'best-effort', attempt: Number(source.attempt) || 1, partitionKey: source.partitionKey || null, sequence: source.sequence || null, idempotencyKey: source.idempotencyKey || null, replyTo: source.replyTo || null, requestId: source.requestId || null },
    routing: { channel: source.channel || null, audience: source.audience || 'internal', transports: Object.freeze(normalizeStrings(source.transports || [])), fallback: Object.freeze([]), hops: Object.freeze(normalizeStrings(source.hops || [])) },
    content: { codec: source.codec || 'json', contentType: source.contentType || 'application/json', schema: source.schema || `${name}@1`, payload },
    security: { classification: source.classification || 'internal', authenticated: source.authenticated === true, principal: source.principal || null, keyId: source.keyId || source.kid || null, algorithm: source.algorithm || source.alg || null, signature: source.signature || null, nonce: source.nonce || null },
    metadata: source.metadata || null,
  };
}
function normalizeStrings(value) { return [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map(String).filter(Boolean))]; }
function envelopeError(message, code, details = null) { return Object.assign(new Error(message), { name: 'EventEnvelopeError', code, details }); }
export default UniversalEventEnvelope;
