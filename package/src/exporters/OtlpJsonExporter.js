'use strict';

import HttpJsonExporter from './HttpJsonExporter.js';

export class OtlpJsonExporter extends HttpJsonExporter {
  constructor(options = {}) { super({ ...options, format: options.format || ((signals) => formatOtlpJson(signals, options.resource || {})) }); }
}

export function formatOtlpJson(signals = [], resource = {}) {
  const spans = signals.filter((signal) => signal.kind === 'span').map((signal) => signal.payload || signal);
  const metrics = signals.filter((signal) => signal.kind === 'metrics').flatMap((signal) => toOtlpMetrics(signal.payload || signal));
  const logs = signals.filter((signal) => ['event', 'log', 'alert', 'incident', 'health', 'resource'].includes(signal.kind)).map(toOtlpLog);
  const output = { resource };
  if (spans.length) output.resourceSpans = [{ resource: { attributes: attributes(resource) }, scopeSpans: [{ scope: { name: 'rawnode-monitor', version: '1.0.0' }, spans: spans.map(toOtlpSpan) }] }];
  if (metrics.length) output.resourceMetrics = [{ resource: { attributes: attributes(resource) }, scopeMetrics: [{ scope: { name: 'rawnode-monitor', version: '1.0.0' }, metrics }] }];
  if (logs.length) output.resourceLogs = [{ resource: { attributes: attributes(resource) }, scopeLogs: [{ scope: { name: 'rawnode-monitor', version: '1.0.0' }, logRecords: logs }] }];
  return output;
}

function toOtlpSpan(span) {
  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId || undefined,
    name: span.name,
    kind: spanKind(span.kind),
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: attributes(span.attributes),
    events: (span.events || []).map((event) => ({ name: event.name, timeUnixNano: String(BigInt(event.timestamp) * 1_000_000n), attributes: attributes(event.attributes) })),
    links: (span.links || []).map((link) => ({ traceId: link.traceId, spanId: link.spanId, attributes: attributes(link.attributes) })),
    status: { code: span.status?.code === 'error' ? 2 : span.status?.code === 'ok' ? 1 : 0, message: span.status?.message || undefined },
  };
}
function toOtlpMetrics(snapshot) {
  const output = [];
  for (const metric of Object.values(snapshot?.metrics || {})) {
    if (metric.type === 'histogram' || metric.type === 'timer') {
      output.push({ name: metric.name, description: metric.description, unit: metric.unit, histogram: { aggregationTemporality: 2, dataPoints: (metric.series || []).map((series) => ({ attributes: attributes(series.labels), timeUnixNano: String(BigInt(series.updatedAt || Date.now()) * 1_000_000n), count: String(series.count), sum: series.sum, bucketCounts: (series.buckets || []).map((bucket, index, all) => String(index ? bucket.count - all[index - 1].count : bucket.count)), explicitBounds: (series.buckets || []).map((bucket) => bucket.upperBound), min: series.min, max: series.max })) } });
    } else {
      output.push({ name: metric.name, description: metric.description, unit: metric.unit, gauge: { dataPoints: (metric.series || []).map((series) => ({ attributes: attributes(series.labels), timeUnixNano: String(BigInt(series.updatedAt || Date.now()) * 1_000_000n), asDouble: series.value })) } });
    }
  }
  return output;
}
function toOtlpLog(signal) { return { timeUnixNano: String(BigInt(signal.timestamp || Date.now()) * 1_000_000n), observedTimeUnixNano: String(BigInt(signal.observedAt || Date.now()) * 1_000_000n), severityText: signal.payload?.severity || signal.payload?.level || signal.kind.toUpperCase(), body: { stringValue: JSON.stringify(signal.payload) }, attributes: attributes({ kind: signal.kind, service: signal.service, environment: signal.environment, tenantId: signal.tenantId }), traceId: signal.traceId || undefined, spanId: signal.spanId || undefined }; }
function attributes(values = {}) { return Object.entries(values || {}).filter(([, value]) => value != null).map(([key, value]) => ({ key, value: anyValue(value) })); }
function anyValue(value) { if (typeof value === 'boolean') return { boolValue: value }; if (typeof value === 'number') return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value }; if (Array.isArray(value)) return { arrayValue: { values: value.map(anyValue) } }; if (value && typeof value === 'object') return { kvlistValue: { values: attributes(value) } }; return { stringValue: String(value) }; }
function spanKind(kind) { return { internal: 1, server: 2, client: 3, producer: 4, consumer: 5 }[kind] || 1; }
export default OtlpJsonExporter;
