'use strict';

import { SpanKind, SpanStatus } from '../constants.js';
import { errorRecord } from '../support.js';

export class Span {
  constructor(tracer, name, context, options = {}) {
    this.tracer = tracer;
    this.name = String(name || 'span');
    this.context = context;
    this.parentSpanId = options.parent?.spanId || options.parentSpanId || null;
    this.kind = options.kind || SpanKind.INTERNAL;
    this.startTimeUnixNano = options.startTimeUnixNano ? BigInt(options.startTimeUnixNano) : BigInt(Date.now()) * 1_000_000n;
    this.startHrtime = process.hrtime.bigint();
    this.endTimeUnixNano = null;
    this.durationNs = null;
    this.attributes = Object.create(null);
    this.events = [];
    this.links = [];
    this.status = { code: SpanStatus.UNSET, message: null };
    this.recording = options.recording !== false;
    this.ended = false;
    this.droppedAttributes = 0;
    this.droppedEvents = 0;
    this.droppedLinks = 0;
    if (options.attributes) this.setAttributes(options.attributes);
    for (const link of options.links || []) this.addLink(link.context || link, link.attributes);
  }

  get traceId() { return this.context.traceId; }
  get spanId() { return this.context.spanId; }
  isRecording() { return this.recording && !this.ended; }
  spanContext() { return this.context; }

  setAttribute(key, value) {
    if (!this.isRecording()) return this;
    if (Object.keys(this.attributes).length >= this.tracer.options.maxAttributes && !(key in this.attributes)) { this.droppedAttributes++; return this; }
    const sanitized = this.tracer.sanitizeAttribute(value);
    if (sanitized === undefined) { this.droppedAttributes++; return this; }
    this.attributes[String(key)] = sanitized;
    return this;
  }
  setAttributes(values = {}) { for (const [key, value] of Object.entries(values)) this.setAttribute(key, value); return this; }

  addEvent(name, attributes = {}, timestamp = Date.now()) {
    if (!this.isRecording()) return this;
    if (this.events.length >= this.tracer.options.maxEvents) { this.droppedEvents++; return this; }
    this.events.push(Object.freeze({ name: String(name), timestamp: Number(timestamp), attributes: this.tracer.sanitizeAttributes(attributes) }));
    return this;
  }

  addLink(context, attributes = {}) {
    if (!this.isRecording() || !context?.traceId || !context?.spanId) return this;
    if (this.links.length >= this.tracer.options.maxLinks) { this.droppedLinks++; return this; }
    this.links.push(Object.freeze({ traceId: context.traceId, spanId: context.spanId, traceFlags: context.traceFlags || 0, attributes: this.tracer.sanitizeAttributes(attributes) }));
    return this;
  }

  setStatus(code, message = null) {
    if (typeof code === 'object') this.status = { code: code.code || SpanStatus.UNSET, message: code.message || null };
    else this.status = { code: code || SpanStatus.UNSET, message: message ? String(message) : null };
    return this;
  }
  updateName(name) { if (!this.ended) this.name = String(name || this.name); return this; }

  recordException(error, attributes = {}) {
    if (!error) return this;
    const normalized = errorRecord(error, { stack: this.tracer.options.captureStack, maxStackBytes: this.tracer.options.maxAttributeBytes });
    this.addEvent('exception', { ...attributes, 'exception.type': normalized.name, 'exception.message': normalized.message, 'exception.stacktrace': normalized.stack, 'exception.code': normalized.code });
    this.setStatus(SpanStatus.ERROR, normalized.message);
    return this;
  }

  end(options = {}) {
    if (this.ended) return this;
    this.ended = true;
    this.endTimeUnixNano = options.endTimeUnixNano ? BigInt(options.endTimeUnixNano) : BigInt(Date.now()) * 1_000_000n;
    this.durationNs = process.hrtime.bigint() - this.startHrtime;
    this.tracer.onEnd(this);
    return this;
  }

  toJSON() {
    return Object.freeze({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      traceFlags: this.context.traceFlags,
      sampled: this.context.sampled,
      name: this.name,
      kind: this.kind,
      startTimeUnixNano: this.startTimeUnixNano.toString(),
      endTimeUnixNano: this.endTimeUnixNano?.toString() || null,
      durationNs: this.durationNs?.toString() || null,
      durationMs: this.durationNs == null ? null : Number(this.durationNs) / 1e6,
      status: Object.freeze({ ...this.status }),
      attributes: Object.freeze({ ...this.attributes }),
      events: Object.freeze(this.events.slice()),
      links: Object.freeze(this.links.slice()),
      droppedAttributes: this.droppedAttributes,
      droppedEvents: this.droppedEvents,
      droppedLinks: this.droppedLinks,
    });
  }
}

export class NoopSpan {
  constructor(context) { this.context = context; this.ended = false; }
  get traceId() { return this.context.traceId; }
  get spanId() { return this.context.spanId; }
  isRecording() { return false; }
  spanContext() { return this.context; }
  setAttribute() { return this; } setAttributes() { return this; } addEvent() { return this; } addLink() { return this; }
  setStatus() { return this; } updateName() { return this; } recordException() { return this; }
  end() { this.ended = true; return this; }
  toJSON() { return { traceId: this.traceId, spanId: this.spanId, sampled: false, recording: false }; }
}

export default Span;
