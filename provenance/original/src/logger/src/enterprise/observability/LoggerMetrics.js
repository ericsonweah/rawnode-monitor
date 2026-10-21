'use strict';

function metricName(value) {
  return String(value || 'rawnode_logger').replace(/[^a-zA-Z0-9_:]/g, '_');
}

export class LoggerMetrics {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.prefix = metricName(options.prefix || 'rawnode_logger');
    this.createdAt = Date.now();
    this.counters = Object.create(null);
    this.gauges = Object.create(null);
    this.histograms = Object.create(null);
  }

  increment(name, amount = 1) {
    if (!this.enabled) return 0;
    const key = metricName(name);
    this.counters[key] = (this.counters[key] || 0) + Number(amount || 0);
    return this.counters[key];
  }

  gauge(name, value) {
    if (!this.enabled) return value;
    this.gauges[metricName(name)] = Number(value) || 0;
    return value;
  }

  observe(name, value) {
    if (!this.enabled) return;
    const key = metricName(name);
    const number = Number(value) || 0;
    const current = this.histograms[key] || { count: 0, sum: 0, min: Infinity, max: -Infinity };
    current.count++;
    current.sum += number;
    current.min = Math.min(current.min, number);
    current.max = Math.max(current.max, number);
    this.histograms[key] = current;
  }

  snapshot() {
    const histograms = Object.create(null);
    for (const [key, value] of Object.entries(this.histograms)) {
      histograms[key] = {
        ...value,
        min: Number.isFinite(value.min) ? value.min : 0,
        max: Number.isFinite(value.max) ? value.max : 0,
        average: value.count ? value.sum / value.count : 0,
      };
    }
    return {
      enabled: this.enabled,
      uptimeMs: Date.now() - this.createdAt,
      counters: { ...this.counters },
      gauges: { ...this.gauges },
      histograms,
    };
  }

  toPrometheus(labels = {}) {
    const baseLabels = Object.entries(labels).map(([key, value]) => `${metricName(key)}=${JSON.stringify(String(value))}`).join(',');
    const labelText = baseLabels ? `{${baseLabels}}` : '';
    const lines = [];
    for (const [key, value] of Object.entries(this.counters)) lines.push(`${this.prefix}_${key}_total${labelText} ${value}`);
    for (const [key, value] of Object.entries(this.gauges)) lines.push(`${this.prefix}_${key}${labelText} ${value}`);
    for (const [key, value] of Object.entries(this.histograms)) {
      lines.push(`${this.prefix}_${key}_count${labelText} ${value.count}`);
      lines.push(`${this.prefix}_${key}_sum${labelText} ${value.sum}`);
      lines.push(`${this.prefix}_${key}_min${labelText} ${Number.isFinite(value.min) ? value.min : 0}`);
      lines.push(`${this.prefix}_${key}_max${labelText} ${Number.isFinite(value.max) ? value.max : 0}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

export default LoggerMetrics;
