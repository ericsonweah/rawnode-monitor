'use strict';

import { Counter, Gauge, Histogram, ObservableGauge, Timer, UpDownCounter } from './Instruments.js';
import { MetricDefinitionError } from '../errors.js';
import { boundedInteger, deepFreeze, sanitizeMetricName } from '../support.js';

export class MetricRegistry {
  constructor(options = {}) {
    this.options = Object.freeze({
      enabled: options.enabled !== false,
      prefix: options.prefix ? sanitizeMetricName(options.prefix) : '',
      maxInstruments: boundedInteger(options.maxInstruments, 10_000, 1, 1_000_000),
      maxSeries: boundedInteger(options.maxSeries, 100_000, 1, 10_000_000),
      maxSeriesPerInstrument: boundedInteger(options.maxSeriesPerInstrument, 2_000, 1, 1_000_000),
      maxLabels: boundedInteger(options.maxLabels, 24, 0, 256),
      maxLabelValueBytes: boundedInteger(options.maxLabelValueBytes, 256, 1, 64 * 1024),
      cardinalityPolicy: options.cardinalityPolicy || 'drop',
      allowLateRegistration: options.allowLateRegistration !== false,
      allowLateSeries: options.allowLateSeries !== false,
      exemplars: options.exemplars !== false,
      collectionTimeoutMs: boundedInteger(options.collectionTimeoutMs, 5_000, 1, 300_000),
      histogramBuckets: options.histogramBuckets || null,
    });
    this.labelOptions = Object.freeze({ maxLabels: this.options.maxLabels, maxValueBytes: this.options.maxLabelValueBytes });
    this.instruments = new Map();
    this.seriesKeys = new Set();
    this.seriesCount = 0;
    this.frozen = false;
    this.contextProvider = options.contextProvider || (() => null);
    this.stats = { registrations: 0, duplicateRegistrations: 0, globalSeriesRejected: 0, collections: 0, collectionErrors: 0 };
  }

  counter(name, options = {}) { return this._instrument('counter', name, options, Counter); }
  upDownCounter(name, options = {}) { return this._instrument('updowncounter', name, options, UpDownCounter); }
  gauge(name, options = {}) { return this._instrument('gauge', name, options, Gauge); }
  histogram(name, options = {}) { return this._instrument('histogram', name, options, Histogram); }
  timer(name, options = {}) { return this._instrument('timer', name, options, Timer); }
  observableGauge(name, callback, options = {}) { return this._instrument('observable_gauge', name, { ...options, callback }, ObservableGauge, callback); }

  _instrument(type, inputName, options, Instrument, callback = null) {
    const name = this._name(inputName);
    const existing = this.instruments.get(name);
    if (existing) {
      if (existing.type !== type) throw new MetricDefinitionError(`Metric '${name}' is already registered as '${existing.type}', not '${type}'.`);
      this.stats.duplicateRegistrations++;
      return existing;
    }
    if (this.frozen || (!this.options.allowLateRegistration && this.instruments.size > 0)) throw new MetricDefinitionError(`Metric registry is frozen; '${name}' cannot be registered.`);
    if (this.instruments.size >= this.options.maxInstruments) throw new MetricDefinitionError(`Metric instrument limit of ${this.options.maxInstruments} exceeded.`);
    const instrument = callback ? new Instrument(this, name, callback, options) : new Instrument(this, name, options);
    this.instruments.set(name, instrument);
    this.stats.registrations++;
    return instrument;
  }

  get(name) { return this.instruments.get(this._name(name)) || this.instruments.get(String(name)) || null; }
  has(name) { return !!this.get(name); }
  remove(name) {
    const key = this._name(name);
    const instrument = this.instruments.get(key);
    if (!instrument) return false;
    this._releaseSeries(instrument);
    return this.instruments.delete(key);
  }
  names() { return Array.from(this.instruments.keys()).sort(); }
  freeze() { this.frozen = true; for (const instrument of this.instruments.values()) instrument.freeze(); return this; }

  async collect(context = {}) {
    this.stats.collections++;
    for (const instrument of this.instruments.values()) {
      if (typeof instrument.collect !== 'function') continue;
      try { await instrument.collect(context); }
      catch { this.stats.collectionErrors++; }
    }
    return this.snapshot();
  }

  snapshot(options = {}) {
    const names = options.names ? new Set(options.names.map((name) => this._name(name))) : null;
    const metrics = Object.create(null);
    for (const [name, instrument] of this.instruments) if (!names || names.has(name)) metrics[name] = instrument.snapshot();
    return deepFreeze({
      timestamp: Date.now(),
      prefix: this.options.prefix,
      instruments: this.instruments.size,
      series: this.seriesCount,
      frozen: this.frozen,
      metrics,
      stats: { ...this.stats },
    });
  }

  reset(options = {}) {
    for (const instrument of this.instruments.values()) instrument.reset();
    if (options.definitions === true) this.instruments.clear();
    this.seriesKeys.clear();
    this.seriesCount = 0;
    return this;
  }

  _name(value) {
    const name = sanitizeMetricName(value);
    return this.options.prefix && !name.startsWith(`${this.options.prefix}_`) && !name.startsWith(`${this.options.prefix}:`)
      ? `${this.options.prefix}_${name}`
      : name;
  }

  _admitSeries(instrument, key) {
    if (this.seriesCount >= this.options.maxSeries) { this.stats.globalSeriesRejected++; return false; }
    return !this.seriesKeys.has(`${instrument.name}\0${key}`);
  }
  _commitSeries(instrument, key) { this.seriesKeys.add(`${instrument.name}\0${key}`); this.seriesCount++; }
  _releaseSeries(instrument) {
    if (this.instruments.get(instrument.name) !== instrument) return;
    for (const key of instrument.series.keys()) this.seriesKeys.delete(`${instrument.name}\0${key}`);
    this.seriesCount = this.seriesKeys.size;
  }

  _exemplar(value, options = {}) {
    if (!this.options.exemplars) return null;
    const context = options.context || this.contextProvider?.() || null;
    if (!context?.traceId) return null;
    return Object.freeze({ traceId: context.traceId, spanId: context.spanId || null, value, timestamp: Date.now() });
  }

  definitionManifest() { return Object.freeze(this.names().map((name) => this.instruments.get(name).definition())); }
}

export default MetricRegistry;
