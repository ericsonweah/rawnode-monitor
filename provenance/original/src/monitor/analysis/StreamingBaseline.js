'use strict';

import { boundedInteger, boundedNumber, deepFreeze } from '../support.js';

/**
 * Bounded streaming baseline with EWMA and robust median/MAD statistics.
 * The ring never grows after construction and all updates are O(1); robust
 * statistics are calculated only when an analysis or snapshot is requested.
 */
export class StreamingBaseline {
  constructor(options = {}) {
    this.maxSamples = boundedInteger(options.maxSamples, 256, 4, 100_000);
    this.minSamples = boundedInteger(options.minSamples, 20, 2, this.maxSamples);
    this.alpha = boundedNumber(options.alpha, 0.2, 0.001, 1);
    this.epsilon = boundedNumber(options.epsilon, 1e-9, Number.MIN_VALUE, 1);
    this.values = new Float64Array(this.maxSamples);
    this.timestamps = new Float64Array(this.maxSamples);
    this.length = 0;
    this.cursor = 0;
    this.total = 0;
    this.ewma = null;
    this.ewVariance = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.last = null;
  }

  observe(input, timestamp = Date.now()) {
    const value = Number(input);
    if (!Number.isFinite(value)) return false;
    if (this.ewma == null) this.ewma = value;
    else {
      const delta = value - this.ewma;
      this.ewma += this.alpha * delta;
      this.ewVariance = (1 - this.alpha) * (this.ewVariance + this.alpha * delta * delta);
    }
    this.values[this.cursor] = value;
    this.timestamps[this.cursor] = Number(timestamp) || Date.now();
    this.cursor = (this.cursor + 1) % this.maxSamples;
    this.length = Math.min(this.maxSamples, this.length + 1);
    this.total++;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
    this.last = value;
    return true;
  }

  analyze(input, options = {}) {
    const value = Number(input);
    if (!Number.isFinite(value)) return deepFreeze({ valid: false, warm: false, value: null });
    const stats = this.statistics();
    const method = String(options.method || 'mad').toLowerCase();
    const center = method === 'zscore' ? stats.ewma : stats.median;
    const spread = method === 'zscore' ? stats.ewStddev : (stats.robustStddev || stats.stddev);
    const delta = value - (Number.isFinite(center) ? center : value);
    const zScore = delta / Math.max(Math.abs(spread || 0), this.epsilon);
    const relativeDeviation = Math.abs(delta) / Math.max(Math.abs(center || 0), this.epsilon);
    return deepFreeze({
      valid: true,
      warm: this.length >= (options.minSamples || this.minSamples),
      value,
      method,
      center,
      spread,
      delta,
      zScore,
      absoluteScore: Math.abs(zScore),
      relativeDeviation,
      samples: this.length,
      totalSamples: this.total,
      statistics: stats,
    });
  }

  observeAndAnalyze(input, options = {}) {
    const analysis = this.analyze(input, options);
    this.observe(input, options.timestamp);
    return analysis;
  }

  samples() {
    const output = [];
    const start = this.length < this.maxSamples ? 0 : this.cursor;
    for (let index = 0; index < this.length; index++) {
      const position = (start + index) % this.maxSamples;
      output.push({ value: this.values[position], timestamp: this.timestamps[position] });
    }
    return output;
  }

  statistics() {
    if (!this.length) return deepFreeze({ count: 0, mean: null, stddev: 0, median: null, mad: 0, robustStddev: 0, ewma: null, ewStddev: 0, min: null, max: null, last: null });
    const values = this.samples().map((item) => item.value).sort((a, b) => a - b);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
    const median = quantile(values, 0.5);
    const deviations = values.map((value) => Math.abs(value - median)).sort((a, b) => a - b);
    const mad = quantile(deviations, 0.5);
    return deepFreeze({
      count: values.length,
      mean,
      stddev: Math.sqrt(Math.max(0, variance)),
      median,
      mad,
      robustStddev: mad * 1.4826,
      ewma: this.ewma,
      ewStddev: Math.sqrt(Math.max(0, this.ewVariance)),
      min: values[0],
      max: values.at(-1),
      last: this.last,
    });
  }

  reset() {
    this.values.fill(0);
    this.timestamps.fill(0);
    this.length = 0;
    this.cursor = 0;
    this.total = 0;
    this.ewma = null;
    this.ewVariance = 0;
    this.min = Infinity;
    this.max = -Infinity;
    this.last = null;
    return this;
  }

  snapshot(options = {}) {
    return deepFreeze({
      maxSamples: this.maxSamples,
      minSamples: this.minSamples,
      alpha: this.alpha,
      statistics: this.statistics(),
      samples: options.includeSamples === true ? this.samples() : undefined,
    });
  }
}

function quantile(sorted, value) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * value;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export default StreamingBaseline;
