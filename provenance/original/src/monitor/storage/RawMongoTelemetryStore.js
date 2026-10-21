'use strict';

import { SignalKind } from '../constants.js';
import { deepFreeze } from '../support.js';

const DEFAULT_KINDS = Object.freeze(Array.from(new Set(Object.values(SignalKind))));

export class RawMongoTelemetryStore {
  constructor(database, options = {}) {
    if (!database) throw new TypeError('RawMongoTelemetryStore requires a database connection.');
    this.database = database;
    this.prefix = options.collectionPrefix || 'monitor_';
    this.maxBatchSize = Math.max(1, Number(options.maxBatchSize) || 1_000);
    this.maxQueryLimit = Math.max(1, Number(options.maxQueryLimit) || 10_000);
    this.retentionMs = Math.max(60_000, Number(options.retentionMs) || 30 * 24 * 60 * 60_000);
    this.kinds = Object.freeze(Array.from(new Set(options.kinds || DEFAULT_KINDS)));
    this.closed = false;
    this.stats = { written: 0, batches: 0, errors: 0, queried: 0, fanoutQueries: 0, pruned: 0 };
  }

  collection(kind) {
    const name = `${this.prefix}${String(kind || 'signals').replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`;
    if (typeof this.database.collection === 'function') return this.database.collection(name);
    if (typeof this.database.db === 'function') return this.database.db().collection(name);
    if (this.database.connection?.collection) return this.database.connection.collection(name);
    throw new TypeError(`RawMongo database does not expose collection('${name}').`);
  }

  async write(signal) { return await this.writeMany([signal]); }

  async writeMany(signals = []) {
    if (this.closed) return { written: 0, closed: true };
    const groups = new Map();
    for (const signal of signals) {
      const kind = signal.kind || 'signals';
      const rows = groups.get(kind) || [];
      rows.push(toDocument(signal, this.retentionMs));
      groups.set(kind, rows);
    }
    let written = 0;
    for (const [kind, rows] of groups) {
      const collection = this.collection(kind);
      for (let index = 0; index < rows.length; index += this.maxBatchSize) {
        const batch = rows.slice(index, index + this.maxBatchSize);
        try {
          if (typeof collection.insertMany === 'function') await collection.insertMany(batch, { ordered: false });
          else if (typeof collection.bulkWrite === 'function') await collection.bulkWrite(batch.map((document) => ({ insertOne: { document } })), { ordered: false });
          else for (const document of batch) await collection.insertOne(document);
          written += batch.length;
          this.stats.written += batch.length;
          this.stats.batches++;
        } catch (error) { this.stats.errors++; throw error; }
      }
    }
    return { written };
  }

  async query(options = {}) {
    this.stats.queried++;
    const limit = boundedLimit(options.limit, this.maxQueryLimit, 100);
    const offset = boundedOffset(options.offset, this.maxQueryLimit);
    if (options.kind) return await this._queryKind(String(options.kind), options, { limit, offset });

    // Signals are physically partitioned by kind for specialized indexes. A
    // global query performs a bounded fan-out, then merges the already-sorted
    // result windows. This avoids duplicate writes to a catch-all collection.
    this.stats.fanoutQueries++;
    const window = Math.min(this.maxQueryLimit, offset + limit);
    const results = await Promise.all(this.kinds.map((kind) => this._queryKind(kind, options, { limit: window, offset: 0 })));
    const order = options.order === 'asc' ? 1 : -1;
    const items = results.flatMap((result) => result.items || []);
    items.sort((left, right) => order * (Number(left.timestamp || 0) - Number(right.timestamp || 0)));
    return deepFreeze({
      items: items.slice(offset, offset + limit),
      total: results.reduce((sum, result) => sum + Number(result.total || 0), 0),
      offset,
      limit,
      kinds: this.kinds,
      fanout: true,
    });
  }

  async _queryKind(kind, options, window) {
    const collection = this.collection(kind);
    const query = isObject(options.filter) ? { ...options.filter } : {};
    if (options.traceId) query.$or = [{ traceId: String(options.traceId) }, { 'payload.traceId': String(options.traceId) }];
    if (options.tenantId) query.tenantId = String(options.tenantId);
    if (options.since || options.until) query.timestamp = { ...(options.since ? { $gte: Number(options.since) } : {}), ...(options.until ? { $lte: Number(options.until) } : {}) };
    if (isObject(options.where)) Object.assign(query, options.where);
    let cursor = collection.find(query);
    cursor = cursor.sort?.({ timestamp: options.order === 'asc' ? 1 : -1 }) || cursor;
    cursor = cursor.skip?.(window.offset) || cursor;
    cursor = cursor.limit?.(window.limit) || cursor;
    const items = typeof cursor.toArray === 'function' ? await cursor.toArray() : await Promise.resolve(cursor);
    const total = typeof collection.countDocuments === 'function' ? await collection.countDocuments(query) : Array.isArray(items) ? items.length : 0;
    return deepFreeze({ items: Array.isArray(items) ? items : [], total, offset: window.offset, limit: window.limit, kind });
  }

  async prune(options = {}) {
    const before = new Date(Number(options.before || Date.now() - Number(options.retentionMs || 0)));
    const kinds = options.kinds || this.kinds;
    let removed = 0;
    for (const kind of kinds) {
      const collection = this.collection(kind);
      const result = await collection.deleteMany?.({ createdAt: { $lt: before } });
      removed += Number(result?.deletedCount || 0);
    }
    this.stats.pruned += removed;
    return removed;
  }

  async flush() { return this.snapshot(); }
  async close() { this.closed = true; return this.snapshot(); }
  snapshot() { return Object.freeze({ driver: 'rawmongo', prefix: this.prefix, retentionMs: this.retentionMs, maxQueryLimit: this.maxQueryLimit, kinds: this.kinds, closed: this.closed, stats: Object.freeze({ ...this.stats }) }); }
}

function toDocument(signal, retentionMs) {
  const document = signal?.toJSON ? signal.toJSON() : { ...signal };
  const timestamp = Number(document.timestamp || Date.now());
  return {
    ...document,
    _id: document.id,
    createdAt: new Date(timestamp),
    observedAtDate: new Date(Number(document.observedAt || timestamp)),
    expiresAt: new Date(timestamp + retentionMs),
  };
}
function boundedLimit(value, maximum, fallback) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : Math.min(fallback, maximum); }
function boundedOffset(value, maximum) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? Math.min(number, maximum) : 0; }
function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }

export default RawMongoTelemetryStore;
