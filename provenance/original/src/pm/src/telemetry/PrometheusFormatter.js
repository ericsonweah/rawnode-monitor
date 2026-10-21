'use strict';

function metricName(value) {
  return String(value || 'rawnode_pm_metric').replace(/[^a-zA-Z0-9_:]/g, '_').replace(/^[^a-zA-Z_:]/, '_');
}

function escapeLabel(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labels(value) {
  const entries = Object.entries(value || {}).filter(([, v]) => v != null);
  if (!entries.length) return '';
  return `{${entries.map(([key, item]) => `${metricName(key)}="${escapeLabel(item)}"`).join(',')}}`;
}

function line(out, name, value, labelSet = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return;
  out.push(`${metricName(name)}${labels(labelSet)} ${number}`);
}

export function formatPrometheus({ registry, metrics }) {
  const out = [
    '# HELP rawnode_pm_up Whether the RawNode PM daemon is running.',
    '# TYPE rawnode_pm_up gauge',
    'rawnode_pm_up 1',
  ];
  const groups = registry?.list?.() || [];
  for (const group of groups) {
    const base = { app: group.name, namespace: group.namespace, mode: group.mode };
    line(out, 'rawnode_pm_desired_instances', group.desiredInstances, base);
    line(out, 'rawnode_pm_active_instances', group.activeInstances, base);
    line(out, 'rawnode_pm_quarantined', group.quarantined ? 1 : 0, base);
    for (const process of group.processes) {
      const labelSet = { ...base, slot: process.slot, pid: process.pid || 0, state: process.state };
      line(out, 'rawnode_pm_process_up', ['ready', 'running', 'online'].includes(process.state) ? 1 : 0, labelSet);
      line(out, 'rawnode_pm_process_uptime_milliseconds', process.uptimeMs, labelSet);
      const latest = process.metrics;
      if (!latest) continue;
      line(out, 'rawnode_pm_process_resident_memory_bytes', latest.memory?.rss, labelSet);
      line(out, 'rawnode_pm_process_heap_used_bytes', latest.memory?.heapUsed, labelSet);
      line(out, 'rawnode_pm_process_cpu_percent', latest.cpu?.percent, labelSet);
      line(out, 'rawnode_pm_process_event_loop_utilization_ratio', latest.eventLoop?.utilization, labelSet);
      line(out, 'rawnode_pm_process_event_loop_delay_p99_milliseconds', latest.eventLoop?.delayP99Ms, labelSet);
      line(out, 'rawnode_pm_process_active_requests', latest.adapter?.activeRequests, labelSet);
      line(out, 'rawnode_pm_process_open_sockets', latest.adapter?.openSockets, labelSet);
    }
  }
  const aggregate = metrics?.snapshot?.() || metrics || {};
  line(out, 'rawnode_pm_daemon_uptime_milliseconds', aggregate.uptimeMs || 0);
  for (const [name, value] of Object.entries(aggregate.counters || {})) line(out, `rawnode_pm_${name}`, value);
  return `${out.join('\n')}\n`;
}

export class PrometheusFormatter {
  format(input) { return formatPrometheus(input); }
}

export default PrometheusFormatter;
