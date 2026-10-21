'use strict';

import { TraceContext } from './TraceContext.js';
import { resolveSampler, SamplingDecision } from './Sampler.js';
import { NoopSpan, Span } from './Span.js';
import InMemorySpanStore from './InMemorySpanStore.js';
import { SpanKind, SpanStatus } from '../constants.js';
import { randomHex } from '../support.js';

export class Tracer {
  constructor(options = {}) {
    this.options = Object.freeze({
      enabled: options.enabled !== false,
      sampleRate: Math.max(0, Math.min(1, Number(options.sampleRate) || 0)),
      parentBased: options.parentBased !== false,
      maxAttributes: Math.max(0, Number(options.maxAttributes) || 64),
      maxAttributeBytes: Math.max(16, Number(options.maxAttributeBytes) || 4_096),
      maxEvents: Math.max(0, Number(options.maxEvents) || 64),
      maxLinks: Math.max(0, Number(options.maxLinks) || 16),
      captureStack: options.captureStack === true,
      resource: Object.freeze({ ...(options.resource || {}) }),
    });
    this.contextManager = options.contextManager;
    this.sampler = resolveSampler({ ...this.options, sampler: options.sampler });
    this.store = options.store || new InMemorySpanStore(options);
    this.processor = options.processor || null;
    this.stats = { started: 0, ended: 0, sampled: 0, dropped: 0, errors: 0 };
  }

  activeSpan() { return this.contextManager?.active?.()?.span || null; }
  activeContext() { return this.activeSpan()?.spanContext?.() || this.contextManager?.active?.()?.traceContext || null; }

  startSpan(name, options = {}) {
    const active = this.activeContext();
    const parent = options.root === true ? null : options.parent || active || null;
    const traceId = parent?.traceId || randomHex(16);
    const candidate = new TraceContext({ traceId, spanId: randomHex(8), traceState: parent?.traceState, baggage: parent?.baggage, sampled: true });
    const sampling = this.options.enabled ? this.sampler.shouldSample(candidate, { parent, name, kind: options.kind, attributes: options.attributes }) : { decision: SamplingDecision.DROP };
    const sampled = sampling.decision === SamplingDecision.RECORD_AND_SAMPLE;
    const context = new TraceContext({ ...candidate, traceFlags: sampled ? 1 : 0 });
    this.stats.started++;
    if (!sampled) { this.stats.dropped++; return new NoopSpan(context); }
    this.stats.sampled++;
    return new Span(this, name, context, { ...options, parent, attributes: { ...sampling.attributes, ...options.attributes } });
  }

  startActiveSpan(name, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (typeof callback !== 'function') throw new TypeError('Tracer.startActiveSpan() requires a callback.');
    const span = this.startSpan(name, options || {});
    const context = { span, traceContext: span.spanContext(), traceId: span.traceId, spanId: span.spanId };
    return this.contextManager?.run ? this.contextManager.run(context, callback, span) : callback(span);
  }

  async trace(name, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    return await this.startActiveSpan(name, options || {}, async (span) => {
      try {
        const result = await callback(span);
        if (span.isRecording()) span.setStatus(SpanStatus.OK);
        return result;
      } catch (error) {
        span.recordException(error).setStatus(SpanStatus.ERROR, error?.message);
        throw error;
      } finally { span.end(); }
    });
  }

  onEnd(span) {
    this.stats.ended++;
    const record = span.toJSON();
    this.store.add(record);
    try { this.processor?.onEnd?.(record); }
    catch { this.stats.errors++; }
  }

  sanitizeAttribute(value) {
    if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.slice(0, 256).map((item) => this.sanitizeAttribute(item)).filter((item) => item !== undefined);
    const text = typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : JSON.stringify(value);
    if (text == null) return undefined;
    if (Buffer.byteLength(text) <= this.options.maxAttributeBytes) return text;
    let end = Math.min(text.length, this.options.maxAttributeBytes);
    while (end > 0 && Buffer.byteLength(text.slice(0, end)) > this.options.maxAttributeBytes) end = Math.floor(end * 0.9);
    return `${text.slice(0, end)}[Truncated]`;
  }
  sanitizeAttributes(values = {}) {
    const output = Object.create(null);
    for (const [key, value] of Object.entries(values).slice(0, this.options.maxAttributes)) {
      const sanitized = this.sanitizeAttribute(value);
      if (sanitized !== undefined) output[key] = sanitized;
    }
    return Object.freeze(output);
  }

  query(options = {}) { return this.store.query(options); }
  traceById(traceId) { return this.store.trace(traceId); }
  snapshot(options = {}) { return Object.freeze({ enabled: this.options.enabled, sampler: this.sampler.description?.() || 'custom', store: this.store.snapshot(), stats: Object.freeze({ ...this.stats }), recent: options.includeRecent ? this.query({ limit: options.limit || 100 }) : undefined }); }
  async forceFlush() { await this.processor?.forceFlush?.(); }
  async close() { await this.forceFlush(); await this.processor?.shutdown?.(); }
}

export default Tracer;
