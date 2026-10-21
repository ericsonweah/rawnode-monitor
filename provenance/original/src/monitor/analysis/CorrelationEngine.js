'use strict';

import { deepFreeze, safeGet } from '../support.js';

const DEFAULT_KINDS = Object.freeze(['span', 'log', 'event', 'health', 'alert', 'incident', 'slo', 'resource', 'deployment', 'anomaly', 'synthetic']);

/** Builds a ranked incident/request timeline across otherwise separate signals. */
export class CorrelationEngine {
  constructor(options = {}) {
    this.store = options.store || null;
    this.tracer = options.tracer || null;
    this.deployments = options.deployments || null;
    this.maxKinds = Math.max(1, Number(options.maxKinds) || 32);
    this.maxCandidates = Math.max(10, Number(options.maxCandidates) || 10_000);
    this.windowMs = Math.max(1_000, Number(options.windowMs) || 15 * 60_000);
    this.stats = { correlations: 0, candidates: 0, returned: 0, errors: 0 };
  }

  async correlate(input = {}, options = {}) {
    const timestamp = Number(input.timestamp || input.at || input.createdAt || Date.now());
    const windowMs = Math.max(1_000, Number(options.windowMs || input.windowMs || this.windowMs));
    const since = timestamp - windowMs;
    const until = timestamp + windowMs;
    const traceId = input.traceId || safeGet(input, 'context.traceId') || safeGet(input, 'payload.traceId');
    const requestId = input.requestId || safeGet(input, 'context.requestId') || safeGet(input, 'payload.context.requestId');
    const tenantId = input.tenantId || safeGet(input, 'context.tenantId') || safeGet(input, 'payload.tenantId');
    const service = input.service || safeGet(input, 'context.service');
    const kinds = Array.from(new Set(options.kinds || DEFAULT_KINDS)).slice(0, this.maxKinds);
    const perKind = Math.max(1, Math.min(Number(options.perKindLimit) || 250, Math.floor(this.maxCandidates / Math.max(1, kinds.length))));
    const candidates = [];
    this.stats.correlations++;

    if (traceId && this.tracer?.trace) {
      const trace = this.tracer.trace(traceId);
      if (trace) for (const span of trace) candidates.push({ kind: 'span', timestamp: span.startTimeUnixNano ? Number(BigInt(span.startTimeUnixNano) / 1_000_000n) : timestamp, payload: span, traceId });
    }

    if (this.store?.query) {
      const results = await Promise.all(kinds.map(async (kind) => {
        try { return await this.store.query({ kind, traceId, since, until, limit: perKind }); }
        catch { this.stats.errors++; return { items: [] }; }
      }));
      for (const result of results) candidates.push(...(result?.items || []));
    }

    const scored = [];
    const seen = new Set();
    for (const candidate of candidates.slice(0, this.maxCandidates)) {
      const id = candidate.id || `${candidate.kind}:${candidate.timestamp}:${JSON.stringify(candidate.payload || {}).slice(0, 200)}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const score = correlationScore(candidate, { timestamp, windowMs, traceId, requestId, tenantId, service });
      if (score.score <= 0 && options.includeUnmatched !== true) continue;
      scored.push({ ...candidate, correlation: score });
    }
    this.stats.candidates += candidates.length;
    scored.sort((left, right) => right.correlation.score - left.correlation.score || Number(left.timestamp || 0) - Number(right.timestamp || 0));
    const limit = Math.max(1, Number(options.limit) || 500);
    const items = scored.slice(0, limit);
    this.stats.returned += items.length;
    const deployment = this.deployments?.around?.(timestamp, { windowMs }) || this.deployments?.latest?.() || null;
    return deepFreeze({ timestamp, windowMs, query: { traceId: traceId || null, requestId: requestId || null, tenantId: tenantId || null, service: service || null }, deployment, totalCandidates: candidates.length, matched: scored.length, items });
  }

  snapshot() { return deepFreeze({ windowMs: this.windowMs, maxKinds: this.maxKinds, maxCandidates: this.maxCandidates, stats: { ...this.stats } }); }
}

function correlationScore(candidate, input) {
  let score = 0; const reasons = [];
  const traceId = candidate.traceId || safeGet(candidate, 'context.traceId') || safeGet(candidate, 'payload.traceId') || safeGet(candidate, 'payload.context.traceId');
  const requestId = candidate.requestId || safeGet(candidate, 'context.requestId') || safeGet(candidate, 'payload.requestId') || safeGet(candidate, 'payload.context.requestId');
  const tenantId = candidate.tenantId || safeGet(candidate, 'context.tenantId') || safeGet(candidate, 'payload.tenantId') || safeGet(candidate, 'payload.context.tenantId');
  const service = candidate.service || safeGet(candidate, 'context.service');
  if (input.traceId && String(traceId) === String(input.traceId)) { score += 100; reasons.push('trace'); }
  if (input.requestId && String(requestId) === String(input.requestId)) { score += 80; reasons.push('request'); }
  if (input.tenantId && String(tenantId) === String(input.tenantId)) { score += 30; reasons.push('tenant'); }
  if (input.service && String(service) === String(input.service)) { score += 10; reasons.push('service'); }
  const distance = Math.abs(Number(candidate.timestamp || input.timestamp) - input.timestamp);
  if (distance <= input.windowMs) { const temporal = Math.max(0, 20 * (1 - distance / input.windowMs)); score += temporal; reasons.push('time'); }
  if (candidate.kind === 'deployment') { score += 15; reasons.push('deployment'); }
  if (['alert', 'incident', 'anomaly'].includes(candidate.kind)) { score += 10; reasons.push('operational-signal'); }
  return deepFreeze({ score: Number(score.toFixed(6)), reasons: Object.freeze(reasons), distanceMs: distance });
}
export default CorrelationEngine;
