'use strict';

import { errorRecord } from '../support.js';

export class ExporterRegistry {
  constructor(options = {}) {
    this.exporters = new Map();
    this.frozen = false;
    this.errorPolicy = options.errorPolicy || 'isolate';
  }

  register(name, exporter, options = {}) {
    if (this.frozen) throw new Error('Monitor exporter registry is frozen.');
    if (!name || !exporter) throw new TypeError('register(name, exporter) requires both values.');
    const key = String(name);
    if (this.exporters.has(key) && options.replace !== true) throw new Error(`Monitor exporter '${name}' is already registered.`);
    this.exporters.set(key, {
      name: key,
      exporter,
      required: options.required === true,
      signals: options.signals || null,
      priority: Number(options.priority || 0),
    });
    return exporter;
  }

  remove(name) { return this.exporters.delete(String(name)); }
  get(name) { return this.exporters.get(String(name))?.exporter || null; }
  list() { return Object.freeze(Array.from(this.exporters.values(), (entry) => ({ name: entry.name, required: entry.required, signals: entry.signals, priority: entry.priority, snapshot: entry.exporter.snapshot?.() || null }))); }
  freeze() { this.frozen = true; return this; }
  attach(pipeline) { for (const entry of this.exporters.values()) pipeline.addSink(`exporter:${entry.name}`, entry.exporter, entry); return pipeline; }
  async flush(options = {}) { return await this._lifecycle('flush', Array.from(this.exporters.values()), options); }
  async close(options = {}) { return await this._lifecycle('close', Array.from(this.exporters.values()).reverse(), options); }
  snapshot() { return Object.freeze({ frozen: this.frozen, errorPolicy: this.errorPolicy, exporters: this.list() }); }

  async _lifecycle(method, entries, options) {
    const settled = await Promise.allSettled(entries.map((entry) => entry.exporter[method]?.(options)));
    const failures = [];
    for (let index = 0; index < settled.length; index++) {
      const result = settled[index];
      if (result.status !== 'rejected') continue;
      failures.push({
        name: entries[index].name,
        required: entries[index].required,
        error: result.reason,
      });
    }
    const fatal = failures.filter((failure) => failure.required || options.throwOnError === true || this.errorPolicy === 'propagate');
    if (fatal.length) {
      const error = new AggregateError(fatal.map((failure) => failure.error), `One or more required Monitor exporters failed during ${method}().`);
      error.code = `MONITOR_EXPORTER_${method.toUpperCase()}_FAILED`;
      error.failures = fatal.map((failure) => ({ name: failure.name, required: failure.required, error: errorRecord(failure.error) }));
      throw error;
    }
    return Object.freeze({
      ok: failures.length === 0,
      operation: method,
      exporters: entries.length,
      failures: Object.freeze(failures.map((failure) => ({ name: failure.name, required: failure.required, error: errorRecord(failure.error) }))),
    });
  }
}
export default ExporterRegistry;
