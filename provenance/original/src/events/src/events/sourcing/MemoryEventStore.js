'use strict';

import { randomUUID } from 'node:crypto';
import { estimateValueBytes } from '../support/size.js';
import { EventAdmissionError, EventConcurrencyError, EventStoreError } from '../errors/EventError.js';

function clone(value) {
  try { return structuredClone(value); } catch {}
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value);
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code };
  const output = {};
  for (const [key, child] of Object.entries(value)) output[key] = clone(child);
  return output;
}

function normalizeEvent(event, options = {}) {
  const eventObject = event && typeof event === 'object' ? event : null;
  const eventName = options.eventName || eventObject?.eventName || eventObject?.constructor?.eventName || eventObject?.constructor?.name || 'Event';
  return {
    eventName: String(eventName),
    eventVersion: Math.max(1, Number(options.eventVersion ?? eventObject?.version) || 1),
    payload: clone(options.payload !== undefined ? options.payload : eventObject?.payload !== undefined ? eventObject.payload : event),
    eventObject: eventObject ? clone(eventObject) : null,
  };
}

/** Bounded in-memory event store with optimistic concurrency and snapshots. */
export class MemoryEventStore {
  constructor(options = {}) {
    this.maxStreams = Math.max(1, Number(options.maxStreams) || 100_000);
    this.maxEvents = Math.max(1, Number(options.maxEvents) || 1_000_000);
    this.maxBytes = Math.max(1, Number(options.maxBytes) || 256 * 1024 * 1024);
    this.maxEventBytes = Math.max(1, Number(options.maxEventBytes) || 4 * 1024 * 1024);
    this.streams = new Map();
    this.snapshots = new Map();
    this.subscribers = new Set();
    this.events = 0;
    this.bytes = 0;
    this.globalPosition = 0;
    this.closed = false;
    this.stats = { appended: 0, reads: 0, conflicts: 0, rejected: 0, snapshots: 0, subscriberErrors: 0 };
  }

  version(streamId) { return this.streams.get(String(streamId))?.length || 0; }

  async append(streamId, events, options = {}) {
    if (this.closed) throw new EventStoreError('Event store is closed', { code: 'EVENT_STORE_CLOSED' });
    const id = String(streamId || '').trim();
    if (!id) throw new TypeError('streamId is required');
    const input = Array.isArray(events) ? events : [events];
    if (!input.length) return { streamId: id, version: this.version(id), records: [] };

    const existing = this.streams.get(id) || [];
    const actualVersion = existing.length;
    const expectedVersion = options.expectedVersion;
    if (expectedVersion !== undefined && expectedVersion !== null && expectedVersion !== 'any' && Number(expectedVersion) !== actualVersion) {
      this.stats.conflicts++;
      throw new EventConcurrencyError(`Expected stream ${id} at version ${expectedVersion}, found ${actualVersion}`, {
        streamId: id,
        expectedVersion: Number(expectedVersion),
        actualVersion,
      });
    }
    if (!this.streams.has(id) && this.streams.size >= this.maxStreams) {
      this.stats.rejected++;
      throw new EventAdmissionError('Event store stream limit exceeded', { code: 'EVENT_STORE_STREAM_LIMIT' });
    }
    if (this.events + input.length > this.maxEvents) {
      this.stats.rejected++;
      throw new EventAdmissionError('Event store event limit exceeded', { code: 'EVENT_STORE_EVENT_LIMIT' });
    }

    const timestamp = Date.now();
    const records = [];
    let additionalBytes = 0;
    for (let index = 0; index < input.length; index++) {
      const normalized = normalizeEvent(input[index], options.events?.[index] || {});
      const record = {
        id: String(options.ids?.[index] || normalized.eventObject?.id || randomUUID()),
        streamId: id,
        streamVersion: actualVersion + index + 1,
        globalPosition: this.globalPosition + index + 1,
        eventName: normalized.eventName,
        eventVersion: normalized.eventVersion,
        payload: normalized.payload,
        eventObject: normalized.eventObject,
        metadata: clone(options.metadata || normalized.eventObject?.meta || null),
        correlationId: options.correlationId || normalized.eventObject?.correlationId || null,
        causationId: options.causationId || normalized.eventObject?.causationId || null,
        tenantId: options.tenantId || normalized.eventObject?.tenantId || null,
        occurredAt: Number(options.occurredAt || normalized.eventObject?.timestamp) || timestamp,
        recordedAt: timestamp,
      };
      const bytes = estimateValueBytes(record, { maximum: this.maxEventBytes + 1 });
      if (bytes > this.maxEventBytes) {
        this.stats.rejected++;
        throw new EventAdmissionError('Event store record exceeds maxEventBytes', { code: 'EVENT_STORE_RECORD_BYTES', details: { bytes, maximum: this.maxEventBytes } });
      }
      record.bytes = bytes;
      additionalBytes += bytes;
      records.push(Object.freeze(record));
    }
    if (this.bytes + additionalBytes > this.maxBytes) {
      this.stats.rejected++;
      throw new EventAdmissionError('Event store byte limit exceeded', { code: 'EVENT_STORE_BYTES' });
    }

    const stream = existing.slice();
    stream.push(...records);
    this.streams.set(id, stream);
    this.events += records.length;
    this.bytes += additionalBytes;
    this.globalPosition += records.length;
    this.stats.appended += records.length;
    await this._notify(records);
    return { streamId: id, version: stream.length, records: records.map(publicRecord) };
  }

  async commit(aggregate, options = {}) {
    if (!aggregate || typeof aggregate.uncommittedEvents !== 'function') throw new TypeError('commit expects an AggregateRoot-like object');
    const events = aggregate.uncommittedEvents();
    const expectedVersion = Math.max(0, Number(aggregate.version) - events.length);
    const result = await this.append(options.streamId || aggregate.id, events, { ...options, expectedVersion: options.expectedVersion ?? expectedVersion });
    aggregate.markCommitted?.();
    aggregate.version = result.version;
    return result;
  }

  read(streamId, options = {}) {
    const stream = this.streams.get(String(streamId)) || [];
    const fromVersion = Math.max(1, Number(options.fromVersion) || 1);
    const toVersion = options.toVersion == null ? Infinity : Math.max(fromVersion, Number(options.toVersion) || Infinity);
    const limit = Math.max(0, Number(options.limit) || 0);
    let records = stream.filter((record) => record.streamVersion >= fromVersion && record.streamVersion <= toVersion);
    if (limit) records = records.slice(0, limit);
    this.stats.reads += records.length;
    return records.map(publicRecord);
  }

  readAll(options = {}) {
    const fromPosition = Math.max(1, Number(options.fromPosition) || 1);
    const limit = Math.max(0, Number(options.limit) || 0);
    let records = [];
    for (const stream of this.streams.values()) {
      for (const record of stream) if (record.globalPosition >= fromPosition) records.push(record);
    }
    records.sort((left, right) => left.globalPosition - right.globalPosition);
    if (options.eventName) records = records.filter((record) => record.eventName === String(options.eventName));
    if (options.tenantId != null) records = records.filter((record) => record.tenantId === options.tenantId);
    if (limit) records = records.slice(0, limit);
    this.stats.reads += records.length;
    return records.map(publicRecord);
  }

  async *iterate(options = {}) {
    const batchSize = Math.max(1, Number(options.batchSize) || 1000);
    let position = Math.max(1, Number(options.fromPosition) || 1);
    while (true) {
      const batch = this.readAll({ ...options, fromPosition: position, limit: batchSize });
      if (!batch.length) return;
      for (const record of batch) { yield record; position = record.globalPosition + 1; }
      if (batch.length < batchSize) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('Event store subscriber must be a function');
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  async _notify(records) {
    for (const listener of this.subscribers) {
      try { await listener(records.map(publicRecord)); }
      catch { this.stats.subscriberErrors++; }
    }
  }

  async saveSnapshot(streamId, snapshot) {
    const id = String(streamId);
    const version = Number(snapshot?.version);
    if (!Number.isInteger(version) || version < 0 || version > this.version(id)) throw new EventStoreError('Invalid snapshot version', { code: 'EVENT_STORE_SNAPSHOT_VERSION' });
    this.snapshots.set(id, Object.freeze({ ...clone(snapshot), streamId: id, savedAt: Date.now() }));
    this.stats.snapshots++;
    return this.getSnapshot(id);
  }

  getSnapshot(streamId) { const snapshot = this.snapshots.get(String(streamId)); return snapshot ? clone(snapshot) : null; }
  deleteSnapshot(streamId) { return this.snapshots.delete(String(streamId)); }

  snapshot() {
    return Object.freeze({
      closed: this.closed,
      streams: this.streams.size,
      events: this.events,
      bytes: this.bytes,
      globalPosition: this.globalPosition,
      snapshots: this.snapshots.size,
      subscribers: this.subscribers.size,
      limits: Object.freeze({ maxStreams: this.maxStreams, maxEvents: this.maxEvents, maxBytes: this.maxBytes, maxEventBytes: this.maxEventBytes }),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  close() { this.closed = true; this.subscribers.clear(); return this.snapshot(); }
}

function publicRecord(record) {
  const { bytes, ...value } = record;
  return clone(value);
}

export default MemoryEventStore;
