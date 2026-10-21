'use strict';

import { EventDeliveryResult, EventDeliveryState, deliveryError } from '../delivery/EventDelivery.js';
import { deepFreeze, safeError, timeout } from '../support/safe.js';

export class EventTransportRouter {
  constructor(registry, options = {}) {
    if (!registry) throw new TypeError('EventTransportRouter requires a transport registry.');
    this.registry = registry;
    this.defaultTransport = options.defaultTransport || 'local';
    this.fallbackEnabled = options.fallback !== false;
    this.defaultTimeoutMs = Math.max(0, Number(options.timeoutMs) || 30_000);
    this.policies = [];
    this.sequence = 0;
    this.stats = { published: 0, accepted: 0, rejected: 0, failed: 0, fallbacks: 0, fanouts: 0 };
  }

  policy(pattern, config = {}) { const entry = { id: `transport-policy-${++this.sequence}`, pattern: String(pattern || '**'), regex: globRegex(pattern || '**'), priority: Number(config.priority) || 0, config: { ...config } }; this.policies.push(entry); this.policies.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)); return () => { const index = this.policies.indexOf(entry); if (index !== -1) this.policies.splice(index, 1); }; }
  resolve(envelope, options = {}) {
    const eventName = String(envelope?.name || envelope?.eventName || envelope || '');
    const definition = options.definition || null;
    const matchedPolicy = this.policies.find((entry) => entry.regex.test(eventName)) || null;
    const policy = matchedPolicy?.config || {};
    const primary = unique(firstNonEmpty(
      options.via,
      envelope?.routing?.transports,
      definition?.transports,
      policy.via,
      policy.transports,
      [this.defaultTransport],
    ));
    const fallback = unique(firstNonEmpty(
      options.fallback,
      envelope?.routing?.fallback,
      policy.fallback,
      [],
    ));
    const fanout = options.fanout === true || policy.fanout === true;
    return {
      eventName,
      policyId: matchedPolicy?.id || null,
      policyPattern: matchedPolicy?.pattern || null,
      primary,
      fallback,
      fanout,
      required: options.required === true || policy.required === true,
      timeoutMs: Math.max(0, Number(options.timeoutMs ?? policy.timeoutMs ?? this.defaultTimeoutMs) || 0),
    };
  }

  explain(eventOrEnvelope, options = {}) {
    const envelope = typeof eventOrEnvelope === 'string'
      ? {
          name: eventOrEnvelope,
          routing: {
            transports: options.transports || options.via || [],
            fallback: options.fallback || [],
          },
          delivery: {
            mode: options.deliveryMode || (options.durable === true ? 'at-least-once' : 'best-effort'),
            partitionKey: options.partitionKey || null,
          },
          byteLength: () => Math.max(0, Number(options.bytes) || 0),
        }
      : eventOrEnvelope;
    const route = this.resolve(envelope, options);
    const candidates = unique([...route.primary, ...(this.fallbackEnabled ? route.fallback : [])]);
    const transports = candidates.map((id, index) => {
      const transport = this.registry.get(id);
      const capabilities = transport?.capabilities?.() || null;
      const mismatch = transport ? capabilityMismatch(capabilities || {}, envelope, options) : {
        code: 'EVENT_TRANSPORT_UNKNOWN',
        reason: 'unknown-transport',
      };
      return {
        id,
        role: index < route.primary.length ? 'primary' : 'fallback',
        registered: !!transport,
        state: transport?.state || transport?.health?.()?.state || null,
        capabilities,
        compatible: !mismatch,
        rejection: mismatch,
      };
    });
    return deepFreeze({
      ...route,
      fallbackEnabled: this.fallbackEnabled,
      transports,
      acceptedCandidates: transports.filter((entry) => entry.compatible).map((entry) => entry.id),
    });
  }

  async publish(envelope, options = {}) {
    const startedAt = Date.now();
    const route = this.resolve(envelope, options);
    this.stats.published++;
    if (route.fanout) return this._fanout(envelope, route, options, startedAt);
    const candidates = [...route.primary, ...(this.fallbackEnabled ? route.fallback : [])];
    const results = [];
    for (let index = 0; index < candidates.length; index++) {
      const id = candidates[index];
      const transport = this.registry.get(id);
      if (!transport) { results.push(EventDeliveryResult.rejected({ transport: id, eventId: envelope.id, code: 'EVENT_TRANSPORT_UNKNOWN', reason: 'unknown-transport' })); continue; }
      const compatibility = capabilityMismatch(transport.capabilities?.() || {}, envelope, options);
      if (compatibility) { results.push(EventDeliveryResult.rejected({ transport: id, eventId: envelope.id, code: compatibility.code, reason: compatibility.reason })); continue; }
      const result = await this._publishOne(transport, envelope, route, options);
      results.push(result);
      if (result.accepted) {
        this.stats.accepted++;
        if (index > 0) this.stats.fallbacks++;
        return new EventDeliveryResult({ ...result, results: results.map((value) => value.toJSON?.() || value), startedAt, finishedAt: Date.now() });
      }
    }
    this.stats.rejected++;
    const result = EventDeliveryResult.rejected({ transport: candidates[0] || null, eventId: envelope.id, state: EventDeliveryState.REJECTED, code: results.at(-1)?.code || 'EVENT_DELIVERY_REJECTED', reason: results.at(-1)?.reason || 'no-compatible-transport', retryable: results.some((entry) => entry.retryable), results: results.map((value) => value.toJSON?.() || value), startedAt, finishedAt: Date.now() });
    if (route.required || options.failurePolicy === 'throw') throw deliveryError(`No event transport accepted '${envelope.name}'.`, result);
    return result;
  }

  async _fanout(envelope, route, options, startedAt) {
    this.stats.fanouts++;
    const ids = unique([...route.primary, ...route.fallback]);
    const results = await Promise.all(ids.map(async (id) => {
      const transport = this.registry.get(id);
      if (!transport) return EventDeliveryResult.rejected({ transport: id, eventId: envelope.id, code: 'EVENT_TRANSPORT_UNKNOWN', reason: 'unknown-transport' });
      const mismatch = capabilityMismatch(transport.capabilities?.() || {}, envelope, options);
      return mismatch ? EventDeliveryResult.rejected({ transport: id, eventId: envelope.id, code: mismatch.code, reason: mismatch.reason }) : this._publishOne(transport, envelope, route, options);
    }));
    const accepted = results.filter((entry) => entry.accepted);
    this.stats.accepted += accepted.length;
    this.stats.rejected += results.length - accepted.length;
    const result = new EventDeliveryResult({ accepted: accepted.length > 0 && (!route.required || accepted.length === results.length), state: accepted.length === results.length ? EventDeliveryState.SENT : accepted.length ? EventDeliveryState.OUTCOME_UNKNOWN : EventDeliveryState.REJECTED, eventId: envelope.id, acknowledged: accepted.every((entry) => entry.acknowledged), persisted: accepted.some((entry) => entry.persisted), retryable: results.some((entry) => entry.retryable), results: results.map((entry) => entry.toJSON?.() || entry), startedAt, finishedAt: Date.now() });
    if ((!result.accepted || (route.required && accepted.length !== results.length)) && options.failurePolicy === 'throw') throw deliveryError(`Event fanout failed for '${envelope.name}'.`, result);
    return result;
  }

  async _publishOne(transport, envelope, route, options) {
    const startedAt = Date.now();
    try {
      await transport.start?.(options.context || {});
      const value = await timeout(transport.publish(envelope, options), route.timeoutMs, { code: 'EVENT_TRANSPORT_TIMEOUT', message: `Event transport '${transport.id}' timed out after ${route.timeoutMs}ms.` });
      if (value instanceof EventDeliveryResult) return value;
      if (value?.accepted === false) return EventDeliveryResult.rejected({ ...value, transport: transport.id, eventId: envelope.id, startedAt, finishedAt: Date.now() });
      return EventDeliveryResult.accepted({ transport: transport.id, eventId: envelope.id, state: value?.state || (value?.acknowledged ? EventDeliveryState.ACKNOWLEDGED : value?.persisted ? EventDeliveryState.PERSISTED : EventDeliveryState.SENT), acknowledged: value?.acknowledged === true, persisted: value?.persisted === true, value, startedAt, finishedAt: Date.now() });
    } catch (error) { this.stats.failed++; return EventDeliveryResult.rejected({ transport: transport.id, eventId: envelope.id, state: error?.delivery || EventDeliveryState.FAILED, code: error?.code || 'EVENT_TRANSPORT_PUBLISH_FAILED', reason: error?.message || String(error), retryable: error?.retryable === true, error: safeError(error), startedAt, finishedAt: Date.now() }); }
  }

  snapshot() { return deepFreeze({ defaultTransport: this.defaultTransport, fallbackEnabled: this.fallbackEnabled, policies: this.policies.map(({ regex, ...entry }) => entry), stats: { ...this.stats } }); }
}
function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      if (value.length) return value;
      continue;
    }
    if (value != null && value !== '') return value;
  }
  return [];
}
function unique(value) { return [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map(String).filter(Boolean))]; }
function capabilityMismatch(capabilities, envelope, options) {
  if (options.requireAcknowledgement === true && capabilities.acknowledged !== true) return { code: 'EVENT_TRANSPORT_ACK_UNSUPPORTED', reason: 'acknowledgement-required' };
  if ((options.durable === true || envelope.delivery?.mode === 'at-least-once' || envelope.delivery?.mode === 'effectively-once') && capabilities.durable !== true && options.allowNonDurable !== true) return { code: 'EVENT_TRANSPORT_DURABILITY_UNSUPPORTED', reason: 'durability-required' };
  if (envelope.delivery?.partitionKey && options.requireOrdering === true && capabilities.orderedByPartition !== true) return { code: 'EVENT_TRANSPORT_ORDERING_UNSUPPORTED', reason: 'partition-ordering-required' };
  const bytes = envelope.byteLength?.() || 0;
  if (capabilities.maxPacketBytes > 0 && bytes > capabilities.maxPacketBytes) return { code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE', reason: 'packet-too-large' };
  return null;
}
function globRegex(value) { let source = '^'; const text = String(value); for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '*') { if (text[i + 1] === '*') { source += '.*'; i++; } else source += '[^:]*'; } else if (c === '?') source += '[^:]'; else source += '\\.^$|()[]{}+'.includes(c) ? `\\${c}` : c; } return new RegExp(`${source}$`); }
export default EventTransportRouter;
