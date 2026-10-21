'use strict';

export function createEventContext(meta = {}, parent = null, idFactory = null) {
  const id = meta.id ?? (typeof idFactory === 'function' ? idFactory() : null);
  const parentId = meta.parentId ?? parent?.id ?? null;
  const correlationId = meta.correlationId ?? parent?.correlationId ?? parent?.id ?? id;
  const context = {
    ...meta,
    id,
    parentId,
    correlationId,
    causationId: meta.causationId ?? parent?.id ?? parentId,
    transport: meta.transport ?? parent?.transport ?? 'internal',
    tenantId: meta.tenantId ?? parent?.tenantId ?? null,
    actorId: meta.actorId ?? parent?.actorId ?? null,
    traceId: meta.traceId ?? parent?.traceId ?? null,
    spanId: meta.spanId ?? null,
    requestId: meta.requestId ?? parent?.requestId ?? null,
    source: meta.source ?? parent?.source ?? null,
    remote: meta.remote === true,
    originTransport: meta.originTransport ?? parent?.originTransport ?? null,
    originNode: meta.originNode ?? parent?.originNode ?? null,
    envelopeId: meta.envelopeId ?? parent?.envelopeId ?? null,
    hop: Math.max(0, Number(meta.hop ?? parent?.hop ?? 0) || 0),
    ts: meta.ts ?? Date.now(),
    headers: meta.headers && typeof meta.headers === 'object' ? { ...meta.headers } : (parent?.headers || null),
  };
  return context;
}

export function shallowEventContext(context) {
  if (!context || typeof context !== 'object') return null;
  return {
    id: context.id ?? null,
    parentId: context.parentId ?? null,
    correlationId: context.correlationId ?? null,
    causationId: context.causationId ?? null,
    transport: context.transport ?? null,
    tenantId: context.tenantId ?? null,
    actorId: context.actorId ?? null,
    traceId: context.traceId ?? null,
    spanId: context.spanId ?? null,
    requestId: context.requestId ?? null,
    source: context.source ?? null,
    remote: context.remote === true,
    originTransport: context.originTransport ?? null,
    originNode: context.originNode ?? null,
    envelopeId: context.envelopeId ?? null,
    hop: context.hop ?? 0,
  };
}
