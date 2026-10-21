'use strict';

import { DEFAULT_HISTOGRAM_BUCKETS } from '../constants.js';
import { CardinalityLimitError, MetricDefinitionError } from '../errors.js';
import { labelsKey, normalizeLabels, sanitizeMetricName } from '../support.js';

class BaseInstrument {
  constructor(registry, type, name, options = {}) {
    this.registry = registry;
    this.type = type;
    this.name = sanitizeMetricName(name);
    this.description = options.description || '';
    this.unit = options.unit || '';
    this.monotonic = options.monotonic === true;
    this.maxSeries = Math.max(1, Number(options.maxSeries) || registry.options.maxSeriesPerInstrument);
    this.constantLabels = normalizeLabels(options.labels || options.constantLabels || {}, registry.labelOptions);
    this.series = new Map();
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;
    this.droppedSeries = 0;
    this.invalidValues = 0;
    this._frozen = false;
  }

  _labels(input = {}) {
    return normalizeLabels({ ...this.constantLabels, ...(input || {}) }, this.registry.labelOptions);
  }

  _series(labels, create) {
    const normalized = this._labels(labels);
    const key = labelsKey(normalized);
    let series = this.series.get(key);
    if (series) return series;
    if (this._frozen && !this.registry.options.allowLateSeries) return null;
    if (this.series.size >= this.maxSeries || !this.registry._admitSeries(this, key)) {
      this.droppedSeries++;
      if (this.registry.options.cardinalityPolicy === 'error') {
        throw new CardinalityLimitError(`Metric '${this.name}' exceeded its cardinality limit.`, { details: { metric: this.name, maxSeries: this.maxSeries } });
      }
      if (this.registry.options.cardinalityPolicy === 'aggregate') {
        const overflowLabels = Object.freeze({ _overflow: 'true' });
        const overflowKey = labelsKey(overflowLabels);
        series = this.series.get(overflowKey);
        if (!series) {
          series = create(overflowLabels);
          this.series.set(overflowKey, series);
          this.registry._commitSeries(this, overflowKey);
        }
        return series;
      }
      return null;
    }
    series = create(normalized);
    this.series.set(key, series);
    this.registry._commitSeries(this, key);
    return series;
  }

  _number(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) { this.invalidValues++; return null; }
    return number;
  }

  freeze() { this._frozen = true; return this; }
  reset() { this.registry._releaseSeries(this.series.size); this.series.clear(); this.updatedAt = Date.now(); return this; }

  definition() {
    return Object.freeze({ type: this.type, name: this.name, description: this.description, unit: this.unit, monotonic: this.monotonic, createdAt: this.createdAt, maxSeries: this.maxSeries });
  }

  _baseSnapshot() {
    return {
      ...this.definition(),
      updatedAt: this.updatedAt,
      cardinality: this.series.size,
      droppedSeries: this.droppedSeries,
      invalidValues: this.invalidValues,
    };
  }
}

export class Counter extends BaseInstrument {
  constructor(registry, name, options = {}) { super(registry, 'counter', name, { ...options, monotonic: true }); }
  _createSeries(labels) { return this._series(labels, (normalized) => ({ labels: normalized, value: 0, count: 0, updatedAt: 0, exemplar: null })); }
  _addSeries(series, value = 1, options = {}) {
    const number = this._number(value);
    if (number == null || !series) return false;
    if (number < 0 && options.allowNegative !== true) throw new MetricDefinitionError(`Counter '${this.name}' cannot decrease.`);
    series.value += number;
    series.count++;
    series.updatedAt = this.updatedAt = Date.now();
    series.exemplar = this.registry._exemplar(number, options);
    return true;
  }
  add(value = 1, labels = {}, options = {}) { return this._addSeries(this._createSeries(labels), value, options); }
  inc(labels = {}, options = {}) { return this.add(1, labels, options); }
  labels(labels = {}) {
    const series = this._createSeries(labels);
    return Object.freeze({
      labels: series?.labels || this._labels(labels),
      add: (value = 1, options = {}) => this._addSeries(series, value, options),
      inc: (options = {}) => this._addSeries(series, 1, options),
    });
  }
  bind(labels = {}) { return this.labels(labels); }
  snapshot() { return Object.freeze({ ...this._baseSnapshot(), series: Object.freeze(Array.from(this.series.values(), (entry) => Object.freeze({ ...entry }))) }); }
}

export class UpDownCounter extends BaseInstrument {
  constructor(registry, name, options = {}) { super(registry, 'updowncounter', name, options); }
  _createSeries(labels) { return this._series(labels, (normalized) => ({ labels: normalized, value: 0, count: 0, updatedAt: 0, exemplar: null })); }
  _addSeries(series, value = 1, options = {}) {
    const number = this._number(value);
    if (number == null || !series) return false;
    series.value += number;
    series.count++;
    series.updatedAt = this.updatedAt = Date.now();
    series.exemplar = this.registry._exemplar(number, options);
    return true;
  }
  add(value = 1, labels = {}, options = {}) { return this._addSeries(this._createSeries(labels), value, options); }
  inc(labels = {}, options = {}) { return this.add(1, labels, options); }
  dec(labels = {}, options = {}) { return this.add(-1, labels, options); }
  labels(labels = {}) {
    const series = this._createSeries(labels);
    return Object.freeze({
      labels: series?.labels || this._labels(labels),
      add: (value = 1, options = {}) => this._addSeries(series, value, options),
      inc: (options = {}) => this._addSeries(series, 1, options),
      dec: (options = {}) => this._addSeries(series, -1, options),
    });
  }
  bind(labels = {}) { return this.labels(labels); }
  snapshot() { return Object.freeze({ ...this._baseSnapshot(), series: Object.freeze(Array.from(this.series.values(), (entry) => Object.freeze({ ...entry }))) }); }
}

export class Gauge extends BaseInstrument {
  constructor(registry, name, options = {}) { super(registry, 'gauge', name, options); }
  _createSeries(labels) { return this._series(labels, (normalized) => ({ labels: normalized, value: 0, count: 0, updatedAt: 0, exemplar: null })); }
  _setSeries(series, value, options = {}) {
    const number = this._number(value);
    if (number == null || !series) return false;
    series.value = number;
    series.count++;
    series.updatedAt = this.updatedAt = Date.now();
    series.exemplar = this.registry._exemplar(number, options);
    return true;
  }
  _addSeries(series, value, options = {}) {
    const number = this._number(value);
    if (number == null || !series) return false;
    series.value += number;
    series.count++;
    series.updatedAt = this.updatedAt = Date.now();
    series.exemplar = this.registry._exemplar(number, options);
    return true;
  }
  set(value, labels = {}, options = {}) { return this._setSeries(this._createSeries(labels), value, options); }
  add(value, labels = {}, options = {}) { return this._addSeries(this._createSeries(labels), value, options); }
  labels(labels = {}) {
    const series = this._createSeries(labels);
    return Object.freeze({
      labels: series?.labels || this._labels(labels),
      set: (value, options = {}) => this._setSeries(series, value, options),
      add: (value, options = {}) => this._addSeries(series, value, options),
    });
  }
  bind(labels = {}) { return this.labels(labels); }
  snapshot() { return Object.freeze({ ...this._baseSnapshot(), series: Object.freeze(Array.from(this.series.values(), (entry) => Object.freeze({ ...entry }))) }); }
}

export class Histogram extends BaseInstrument {
  constructor(registry, name, options = {}) {
    super(registry, 'histogram', name, options);
    const input = options.buckets || registry.options.histogramBuckets || DEFAULT_HISTOGRAM_BUCKETS;
    this.buckets = Object.freeze(Array.from(new Set(input.map(Number).filter(Number.isFinite))).sort((a, b) => a - b));
    if (!this.buckets.length) throw new MetricDefinitionError(`Histogram '${this.name}' requires at least one bucket.`);
  }

  _createSeries(labels) {
    return this._series(labels, (normalized) => ({
      labels: normalized,
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      buckets: new Array(this.buckets.length).fill(0),
      updatedAt: 0,
      exemplar: null,
    }));
  }

  _recordSeries(series, value, options = {}) {
    const number = this._number(value);
    if (number == null || !series) return false;
    series.count++;
    series.sum += number;
    series.min = Math.min(series.min, number);
    series.max = Math.max(series.max, number);
    for (let index = 0; index < this.buckets.length; index++) if (number <= this.buckets[index]) series.buckets[index]++;
    series.updatedAt = this.updatedAt = Date.now();
    series.exemplar = this.registry._exemplar(number, options);
    return true;
  }

  record(value, labels = {}, options = {}) { return this._recordSeries(this._createSeries(labels), value, options); }
  observe(value, labels = {}, options = {}) { return this.record(value, labels, options); }
  labels(labels = {}) {
    const series = this._createSeries(labels);
    return Object.freeze({
      labels: series?.labels || this._labels(labels),
      record: (value, options = {}) => this._recordSeries(series, value, options),
      observe: (value, options = {}) => this._recordSeries(series, value, options),
    });
  }
  bind(labels = {}) { return this.labels(labels); }

  snapshot() {
    const series = Array.from(this.series.values(), (entry) => Object.freeze({
      labels: entry.labels,
      count: entry.count,
      sum: entry.sum,
      min: Number.isFinite(entry.min) ? entry.min : null,
      max: Number.isFinite(entry.max) ? entry.max : null,
      mean: entry.count ? entry.sum / entry.count : 0,
      buckets: Object.freeze(this.buckets.map((upperBound, index) => Object.freeze({ upperBound, count: entry.buckets[index] }))),
      updatedAt: entry.updatedAt,
      exemplar: entry.exemplar,
    }));
    return Object.freeze({ ...this._baseSnapshot(), buckets: this.buckets, series: Object.freeze(series) });
  }
}

export class Timer extends Histogram {
  constructor(registry, name, options = {}) { super(registry, name, { unit: options.unit || 'seconds', ...options }); this.type = 'timer'; }
  start(labels = {}, options = {}) {
    const series = this._createSeries(labels);
    const started = process.hrtime.bigint();
    let stopped = false;
    return (extraLabels = null, extraOptions = null) => {
      if (stopped) return 0;
      stopped = true;
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      if (extraLabels && Object.keys(extraLabels).length) this.record(seconds, { ...labels, ...extraLabels }, { ...options, ...(extraOptions || {}) });
      else this._recordSeries(series, seconds, { ...options, ...(extraOptions || {}) });
      return seconds;
    };
  }
  _startSeries(series, options = {}) {
    const started = process.hrtime.bigint();
    let stopped = false;
    return (extraOptions = null) => {
      if (stopped) return 0;
      stopped = true;
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      this._recordSeries(series, seconds, { ...options, ...(extraOptions || {}) });
      return seconds;
    };
  }
  async time(callback, labels = {}, options = {}) {
    const stop = this.start(labels, options);
    try { return await callback(); }
    finally { stop(); }
  }
  labels(labels = {}) {
    const series = this._createSeries(labels);
    return Object.freeze({
      labels: series?.labels || this._labels(labels),
      record: (value, options = {}) => this._recordSeries(series, value, options),
      observe: (value, options = {}) => this._recordSeries(series, value, options),
      start: (options = {}) => this._startSeries(series, options),
      time: async (callback, options = {}) => { const stop = this._startSeries(series, options); try { return await callback(); } finally { stop(); } },
    });
  }
  bind(labels = {}) { return this.labels(labels); }
}

export class ObservableGauge extends BaseInstrument {
  constructor(registry, name, callback, options = {}) {
    super(registry, 'observable_gauge', name, options);
    if (typeof callback !== 'function') throw new MetricDefinitionError(`Observable gauge '${this.name}' requires a callback.`);
    this.callback = callback;
    this.lastError = null;
  }

  async collect(context = {}) {
    const observations = [];
    const observe = (value, labels = {}) => observations.push({ value, labels });
    try {
      const result = await this.callback({ observe, instrument: this, context });
      if (typeof result === 'number') observations.push({ value: result, labels: {} });
      else if (Array.isArray(result)) observations.push(...result);
      for (const item of observations) this._set(item.value, item.labels);
      this.lastError = null;
    } catch (error) { this.lastError = { code: error.code || null, message: error.message || String(error), at: Date.now() }; }
    return this.snapshot();
  }

  _set(value, labels = {}) {
    const number = this._number(value);
    if (number == null) return false;
    const series = this._series(labels, (normalized) => ({ labels: normalized, value: 0, count: 0, updatedAt: 0, exemplar: null }));
    if (!series) return false;
    series.value = number;
    series.count++;
    series.updatedAt = this.updatedAt = Date.now();
    return true;
  }

  snapshot() { return Object.freeze({ ...this._baseSnapshot(), lastError: this.lastError, series: Object.freeze(Array.from(this.series.values(), (entry) => Object.freeze({ ...entry }))) }); }
}

export { BaseInstrument };
