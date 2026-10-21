'use strict';

export class CompositeTelemetryStore {
  constructor(stores = [], options = {}) {
    this.stores = [];
    this.errorPolicy = options.errorPolicy || 'isolate';
    this.requireDurable = options.requireDurable === true || options.required === true;
    this.queryStore = options.queryStore || options.preferredQueryStore || null;
    this.stats = {
      written: 0,
      storeWrites: 0,
      batches: 0,
      partialBatches: 0,
      failedBatches: 0,
      errors: 0,
      queries: 0,
    };
    for (const [index, entry] of stores.entries()) this._addEntry(entry, index);
    this.queryStore ||= this._preferredQueryStore();
  }

  _addEntry(entry, index = this.stores.length) {
    const record = normalizeEntry(entry, index);
    record.name = uniqueName(record.name, this.stores);
    this.stores.push(record);
    return record;
  }

  add(name, store, options = {}) {
    this._addEntry({ name, store, ...options });
    this.queryStore ||= this._preferredQueryStore();
    return this;
  }

  async writeMany(signals = [], options = {}) {
    const results = [];
    let successfulStores = 0;
    let successfulDurableStores = 0;
    let logicalWritten = 0;
    let storeWrites = 0;
    const failures = [];

    for (const entry of this.stores) {
      try {
        const result = await entry.store.writeMany(signals, options);
        const written = Number(result?.written ?? signals.length);
        if (result === false || result?.closed === true || !Number.isSafeInteger(written) || written !== signals.length) {
          throw Object.assign(new Error(`Telemetry store '${entry.name}' did not acknowledge the complete batch.`), {
            code: 'MONITOR_STORAGE_INCOMPLETE_WRITE', retryable: false,
            details: { expected: signals.length, written: Number.isSafeInteger(written) ? written : null, closed: result?.closed === true },
          });
        }
        results.push({ name: entry.name, durable: entry.durable, result });
        successfulStores++;
        if (entry.durable) successfulDurableStores++;
        logicalWritten = Math.max(logicalWritten, written);
        storeWrites += written;
      } catch (error) {
        this.stats.errors++;
        const failure = { entry, error };
        failures.push(failure);
        results.push({ name: entry.name, durable: entry.durable, error: errorRecord(error) });
      }
    }

    this.stats.batches++;
    this.stats.storeWrites += storeWrites;
    if (successfulStores > 0 && failures.length > 0) this.stats.partialBatches++;

    const fatal = failures.filter(({ entry }) => entry.required);
    if (this.errorPolicy === 'propagate') fatal.push(...failures.filter((failure) => !fatal.includes(failure)));
    if (this.requireDurable && successfulDurableStores === 0) {
      const error = new AggregateError(failures.map(({ error }) => error), 'Composite telemetry storage did not persist the batch to any durable store.');
      error.code = 'MONITOR_DURABLE_STORAGE_UNAVAILABLE';
      error.retryable = false;
      error.results = results;
      this.stats.failedBatches++;
      throw error;
    }
    if (fatal.length) {
      const error = new AggregateError(fatal.map((failure) => failure.error), 'One or more required telemetry stores failed.');
      error.code = 'MONITOR_REQUIRED_STORAGE_FAILED';
      error.retryable = false;
      error.results = results;
      this.stats.failedBatches++;
      throw error;
    }
    if (successfulStores === 0 && this.stores.length > 0) {
      this.stats.failedBatches++;
      return { written: 0, stores: results, durable: false };
    }

    this.stats.written += logicalWritten;
    return { written: logicalWritten, stores: results, durable: successfulDurableStores > 0 };
  }

  async write(signal, options = {}) { return await this.writeMany([signal], options); }

  async query(options = {}) {
    this.stats.queries++;
    const requested = options.store || options.queryStore || this.queryStore;
    const entry = requested
      ? this.stores.find((item) => item.name === requested)
      : this.stores.find((item) => item.durable) || this.stores[0];
    if (!entry) return { items: [], total: 0, offset: 0, limit: options.limit || 100 };
    const query = { ...options };
    delete query.store;
    delete query.queryStore;
    const result = await entry.store.query(query);
    return result && typeof result === 'object'
      ? { ...result, store: entry.name, durable: entry.durable }
      : result;
  }

  async prune(options = {}) {
    const { results, failures } = await this._fanout('prune', [options]);
    this._throwLifecycleFailures('prune', failures);
    return results.reduce((sum, result) => sum + Number(result.value || 0), 0);
  }

  async flush(options = {}) {
    const { failures } = await this._fanout('flush', [options]);
    this._throwLifecycleFailures('flush', failures);
    return this.snapshot();
  }

  async close(options = {}) {
    const { failures } = await this._fanout('close', [options], { reverse: true });
    this._throwLifecycleFailures('close', failures);
    return this.snapshot();
  }

  async _fanout(method, args, options = {}) {
    const source = options.reverse ? [...this.stores].reverse() : this.stores;
    const results = [];
    const failures = [];
    for (const entry of source) {
      if (typeof entry.store?.[method] !== 'function') continue;
      try { results.push({ name: entry.name, value: await entry.store[method](...args) }); }
      catch (error) { this.stats.errors++; failures.push({ entry, error }); }
    }
    return { results, failures };
  }

  _throwLifecycleFailures(method, failures) {
    const fatal = failures.filter(({ entry }) => entry.required || this.errorPolicy === 'propagate');
    if (!fatal.length) return;
    const error = new AggregateError(fatal.map((failure) => failure.error), `One or more required telemetry stores failed during ${method}().`);
    error.code = 'MONITOR_REQUIRED_STORAGE_LIFECYCLE_FAILED';
    error.operation = method;
    throw error;
  }

  _preferredQueryStore() {
    return this.stores.find((entry) => entry.durable)?.name || this.stores[0]?.name || null;
  }

  snapshot() {
    return Object.freeze({
      driver: 'composite',
      queryStore: this.queryStore,
      requireDurable: this.requireDurable,
      stores: Object.freeze(this.stores.map((entry) => ({
        name: entry.name,
        required: entry.required,
        durable: entry.durable,
        snapshot: entry.store.snapshot?.() || null,
      }))),
      stats: Object.freeze({ ...this.stats }),
    });
  }
}

function normalizeEntry(entry, index) {
  const wrapped = entry?.store
    ? entry
    : { store: entry };
  const store = wrapped.store;
  if (!store || typeof store.writeMany !== 'function') throw new TypeError('Composite telemetry stores must expose writeMany().');
  const snapshot = safeSnapshot(store);
  const driver = String(wrapped.driver || snapshot?.driver || store.driver || `store-${index}`);
  return {
    name: String(wrapped.name || driver || `store-${index}`),
    store,
    required: wrapped.required === true,
    durable: wrapped.durable === true || (wrapped.durable !== false && !['memory', 'none', 'noop'].includes(driver)),
  };
}
function safeSnapshot(store) { try { return store.snapshot?.() || null; } catch { return null; } }
function uniqueName(name, entries) {
  const base = String(name || 'store');
  if (!entries.some((entry) => entry.name === base)) return base;
  let sequence = 2;
  while (entries.some((entry) => entry.name === `${base}-${sequence}`)) sequence++;
  return `${base}-${sequence}`;
}
function errorRecord(error) { return { name: error?.name || 'Error', code: error?.code || null, message: error?.message || String(error) }; }

export default CompositeTelemetryStore;
