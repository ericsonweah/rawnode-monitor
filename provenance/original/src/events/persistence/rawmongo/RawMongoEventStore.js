'use strict';

import { randomUUID } from 'node:crypto';
import { array, collection, clone, duplicate, matched, publicDocument, transaction, value } from './support.js';

export class RawMongoEventStore {
  constructor(source, options = {}) {
    this.source = source;
    this.options = options;
    this.names = Object.freeze({
      events: options.eventsCollection || 'events_store',
      streams: options.streamsCollection || 'events_streams',
      counters: options.countersCollection || 'events_counters',
      snapshots: options.snapshotsCollection || 'events_snapshots',
    });
    this.eventsCollection = collection(source, this.names.events, options);
    this.streamsCollection = collection(source, this.names.streams, options);
    this.countersCollection = collection(source, this.names.counters, options);
    this.snapshotsCollection = collection(source, this.names.snapshots, options);
    this.subscribers = new Set();
    this.closed = false;
    this.stats = { appended: 0, reads: 0, conflicts: 0, snapshots: 0, subscriberErrors: 0, transactionless: 0 };
  }

  async version(streamId, options = {}) { const head = await this.streamsCollection.findOne({ _id: String(streamId) }, readOptions(options)); return Number(head?.version) || 0; }

  async append(streamId, events, options = {}) {
    if (this.closed) throw storeError('Event store is closed.', 'EVENT_STORE_CLOSED');
    const id = String(streamId || '').trim();
    if (!id) throw new TypeError('streamId is required.');
    const input = Array.isArray(events) ? events : [events];
    if (!input.length) return { streamId: id, version: await this.version(id, options), records: [] };

    return transaction(this.source, async (session) => {
      if (!session) this.stats.transactionless++;
      const write = session ? { session } : {};
      const head = await this.streamsCollection.findOne({ _id: id }, write);
      const actualVersion = Number(head?.version) || 0;
      const expected = options.expectedVersion;
      if (expected != null && expected !== 'any' && Number(expected) !== actualVersion) return this._conflict(id, expected, actualVersion);
      const nextVersion = actualVersion + input.length;

      if (head) {
        const updated = await this.streamsCollection.updateOne({ _id: id, version: actualVersion }, { $set: { version: nextVersion, updatedAt: new Date(), tenantId: options.tenantId ?? head.tenantId ?? null }, $inc: { revision: 1 } }, write);
        if (!matched(updated)) return this._conflict(id, actualVersion, await this.version(id, { session }));
      } else {
        try { await this.streamsCollection.insertOne({ _id: id, version: nextVersion, revision: 1, tenantId: options.tenantId ?? null, createdAt: new Date(), updatedAt: new Date() }, write); }
        catch (error) { if (duplicate(error)) return this._conflict(id, 0, await this.version(id, { session })); throw error; }
      }

      const counter = value(await this.countersCollection.findOneAndUpdate({ _id: 'global-position' }, { $inc: { value: input.length }, $set: { updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true, returnDocument: 'after', ...write }));
      const endPosition = Number(counter?.value) || input.length;
      const startPosition = endPosition - input.length + 1;
      const now = new Date();
      const records = input.map((event, index) => normalizeRecord(event, {
        ...options,
        streamId: id,
        streamVersion: actualVersion + index + 1,
        globalPosition: startPosition + index,
        recordedAt: now,
        eventOptions: options.events?.[index] || {},
      }));
      if (records.length === 1) await this.eventsCollection.insertOne(records[0], write);
      else await this.eventsCollection.insertMany(records, { ordered: true, ...write });
      this.stats.appended += records.length;
      await this._notify(records);
      return { streamId: id, version: nextVersion, records: records.map(publicRecord) };
    }, { ...this.options, ...options });
  }

  async commit(aggregate, options = {}) {
    if (!aggregate || typeof aggregate.uncommittedEvents !== 'function') throw new TypeError('commit expects an AggregateRoot-like object.');
    const events = aggregate.uncommittedEvents();
    const expectedVersion = Math.max(0, Number(aggregate.version) - events.length);
    const result = await this.append(options.streamId || aggregate.id, events, { ...options, expectedVersion: options.expectedVersion ?? expectedVersion });
    aggregate.markCommitted?.(); aggregate.version = result.version; return result;
  }

  async read(streamId, options = {}) {
    const filter = { streamId: String(streamId), streamVersion: { $gte: Math.max(1, Number(options.fromVersion) || 1) } };
    if (options.toVersion != null) filter.streamVersion.$lte = Math.max(1, Number(options.toVersion));
    let cursor = this.eventsCollection.find(filter, readOptions(options));
    cursor = cursor.sort?.({ streamVersion: 1 }) || cursor;
    if (options.limit) cursor = cursor.limit?.(Math.max(1, Number(options.limit))) || cursor;
    const records = await array(cursor); this.stats.reads += records.length; return records.map(publicRecord);
  }

  async readAll(options = {}) {
    const filter = { globalPosition: { $gte: Math.max(1, Number(options.fromPosition) || 1) } };
    if (options.eventName) filter.eventName = String(options.eventName);
    if (options.tenantId != null) filter.tenantId = options.tenantId;
    let cursor = this.eventsCollection.find(filter, readOptions(options));
    cursor = cursor.sort?.({ globalPosition: 1 }) || cursor;
    if (options.limit) cursor = cursor.limit?.(Math.max(1, Number(options.limit))) || cursor;
    const records = await array(cursor); this.stats.reads += records.length; return records.map(publicRecord);
  }

  async *iterate(options = {}) {
    const batchSize = Math.max(1, Number(options.batchSize) || 1_000);
    let position = Math.max(1, Number(options.fromPosition) || 1);
    while (!options.signal?.aborted) {
      const batch = await this.readAll({ ...options, fromPosition: position, limit: batchSize });
      if (!batch.length) return;
      for (const record of batch) { yield record; position = record.globalPosition + 1; }
      if (batch.length < batchSize) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  subscribe(listener) { if (typeof listener !== 'function') throw new TypeError('Event store subscriber must be a function.'); this.subscribers.add(listener); return () => this.subscribers.delete(listener); }
  async _notify(records) { const published = records.map(publicRecord); for (const listener of this.subscribers) { try { await listener(published); } catch { this.stats.subscriberErrors++; } } }

  async saveSnapshot(streamId, snapshot, options = {}) {
    const id = String(streamId); const version = Number(snapshot?.version);
    const actual = await this.version(id, options);
    if (!Number.isInteger(version) || version < 0 || version > actual) throw storeError('Invalid snapshot version.', 'EVENT_STORE_SNAPSHOT_VERSION');
    const now = new Date();
    await this.snapshotsCollection.updateOne({ _id: id }, { $set: { ...clone(snapshot), _id: id, streamId: id, version, savedAt: now, updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true, ...writeOptions(options) });
    this.stats.snapshots++; return this.getSnapshot(id, options);
  }
  async getSnapshot(streamId, options = {}) { return publicDocument(await this.snapshotsCollection.findOne({ _id: String(streamId) }, readOptions(options))); }
  async deleteSnapshot(streamId, options = {}) { const result = await this.snapshotsCollection.deleteOne({ _id: String(streamId) }, writeOptions(options)); return Number(result?.deletedCount ?? result?.n ?? 0) > 0; }
  snapshot() { return Object.freeze({ driver: 'rawmongo', closed: this.closed, collections: this.names, subscribers: this.subscribers.size, requireTransactions: this.options.requireTransactions === true, stats: Object.freeze({ ...this.stats }) }); }
  close() { this.closed = true; this.subscribers.clear(); return this.snapshot(); }
  _conflict(streamId, expectedVersion, actualVersion) { this.stats.conflicts++; throw Object.assign(new Error(`Expected stream ${streamId} at version ${expectedVersion}, found ${actualVersion}.`), { name: 'EventConcurrencyError', code: 'EVENT_STORE_CONCURRENCY', streamId, expectedVersion: Number(expectedVersion), actualVersion: Number(actualVersion) }); }
}

function normalizeRecord(event, options) {
  const object = event && typeof event === 'object' ? event : null;
  const eventOptions = options.eventOptions || {};
  const eventName = eventOptions.eventName || object?.eventName || object?.type || object?.constructor?.eventName || object?.constructor?.name || 'Event';
  const payload = eventOptions.payload !== undefined ? eventOptions.payload : object?.payload !== undefined ? object.payload : event;
  return {
    _id: String(eventOptions.id || object?.id || randomUUID()), streamId: options.streamId, streamVersion: options.streamVersion,
    globalPosition: options.globalPosition, eventName: String(eventName), eventVersion: Math.max(1, Number(eventOptions.eventVersion ?? object?.version) || 1),
    payload: clone(payload), eventObject: object ? clone(object) : null, metadata: clone(eventOptions.metadata || options.metadata || object?.meta || null),
    correlationId: options.correlationId || object?.correlationId || null, causationId: options.causationId || object?.causationId || null,
    tenantId: options.tenantId ?? object?.tenantId ?? null, occurredAt: new Date(Number(options.occurredAt || object?.occurredAt || object?.timestamp) || Date.now()),
    recordedAt: options.recordedAt,
  };
}
function publicRecord(record) { const value = publicDocument(record); if (value?.occurredAt instanceof Date) value.occurredAt = value.occurredAt.getTime(); if (value?.recordedAt instanceof Date) value.recordedAt = value.recordedAt.getTime(); return value; }
function readOptions(options) { return options.session ? { session: options.session } : {}; }
function writeOptions(options) { return options.session ? { session: options.session } : {}; }
function storeError(message, code) { return Object.assign(new Error(message), { name: 'EventStoreError', code }); }
export default RawMongoEventStore;
