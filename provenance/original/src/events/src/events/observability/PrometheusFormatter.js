'use strict';

export function sanitizeMetricName(value) {
  return String(value || 'rawnode_events').replace(/[^a-zA-Z0-9_:]/g, '_').replace(/^[^a-zA-Z_:]/, '_$&');
}

export function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

export function formatPrometheusSnapshot(snapshot, prefix = 'rawnode_events') {
  const name = sanitizeMetricName(prefix);
  const lines = [];
  const add = (metric, value, labels = null) => {
    const labelText = labels && Object.keys(labels).length
      ? `{${Object.entries(labels).map(([key, item]) => `${sanitizeMetricName(key)}="${escapeLabel(item)}"`).join(',')}}`
      : '';
    lines.push(`${name}_${metric}${labelText} ${Number.isFinite(Number(value)) ? Number(value) : 0}`);
  };

  for (const [key, value] of Object.entries(snapshot.counters || {})) add(key, value);
  for (const series of snapshot.series || []) {
    const labels = { event: series.eventName };
    add('dispatch_total', series.count, labels);
    add('dispatch_errors_total', series.errorCount, labels);
    add('dispatch_duration_ms_sum', series.totalMs, labels);
    add('dispatch_duration_ms_min', Number.isFinite(series.minMs) ? series.minMs : 0, labels);
    add('dispatch_duration_ms_max', series.maxMs, labels);
  }
  for (const [bucket, value] of Object.entries(snapshot.histogram || {})) add('dispatch_duration_ms_bucket', value, { le: bucket });
  return `${lines.join('\n')}\n`;
}
