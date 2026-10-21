'use strict';

import { sanitizeLabelName, sanitizeMetricName } from '../support.js';

function escapeHelp(value) { return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n'); }
function escapeLabel(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"'); }
function labelsText(labels = {}, extra = null) {
  const entries = [...Object.entries(labels), ...(extra ? Object.entries(extra) : [])];
  if (!entries.length) return '';
  return `{${entries.map(([key, value]) => `${sanitizeLabelName(key)}="${escapeLabel(value)}"`).join(',')}}`;
}
function number(value) { return Number.isFinite(Number(value)) ? String(Number(value)) : '0'; }
function exemplarText(exemplar) {
  if (!exemplar?.traceId) return '';
  const labels = { trace_id: exemplar.traceId };
  if (exemplar.spanId) labels.span_id = exemplar.spanId;
  return ` # ${labelsText(labels).slice(1, -1)} ${number(exemplar.value)} ${Math.trunc(exemplar.timestamp)}`;
}

export function formatPrometheus(snapshot, options = {}) {
  const lines = [];
  for (const metric of Object.values(snapshot?.metrics || snapshot?.metrics?.metrics || {})) {
    const name = sanitizeMetricName(metric.name);
    if (metric.description) lines.push(`# HELP ${name} ${escapeHelp(metric.description)}`);
    const type = metric.type === 'timer' || metric.type === 'histogram' ? 'histogram' : metric.type === 'counter' ? 'counter' : 'gauge';
    lines.push(`# TYPE ${name} ${type}`);
    if (metric.unit) lines.push(`# UNIT ${name} ${sanitizeMetricName(metric.unit)}`);

    for (const series of metric.series || []) {
      if (type === 'histogram') {
        for (const bucket of series.buckets || []) lines.push(`${name}_bucket${labelsText(series.labels, { le: bucket.upperBound })} ${number(bucket.count)}`);
        lines.push(`${name}_bucket${labelsText(series.labels, { le: '+Inf' })} ${number(series.count)}`);
        lines.push(`${name}_sum${labelsText(series.labels)} ${number(series.sum)}`);
        lines.push(`${name}_count${labelsText(series.labels)} ${number(series.count)}${options.exemplars !== false ? exemplarText(series.exemplar) : ''}`);
      } else {
        lines.push(`${name}${labelsText(series.labels)} ${number(series.value)}${options.exemplars !== false ? exemplarText(series.exemplar) : ''}`);
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

export default formatPrometheus;
