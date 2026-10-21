'use strict';

import { RingBuffer } from './RingBuffer.js';
import { compileMatcherList, matchesAny } from '../support/glob.js';
import { estimateValueBytes } from '../support/size.js';
import { SafeJsonCodec } from '../serialization/SafeJsonCodec.js';

class EventJournalCompatibilityView {
  constructor(journal) { this.journal = journal; }
  get size() { return this.journal.eventCount; }
  has(name) { return this.journal.has(name); }
  get(name) { return this.journal.get(name); }
  clear() { this.journal.clear(); }
  delete(name) { return this.journal.clear(name) > 0; }
  keys() { return this.journal.eventNames()[Symbol.iterator](); }
  values() { return Array.from(this.journal.entries(), ([, entries]) => entries)[Symbol.iterator](); }
  entries() { return this.journal.entries(); }
  [Symbol.iterator]() { return this.entries(); }
}

function publicEntry(entry) {
  return { ts: entry.ts, args: entry.args, ctx: entry.ctx };
}

export class EventJournal {
  constructor(options = {}) {
    this.maxEntriesPerEvent = Math.max(0, Number(options.maxEntriesPerEvent ?? options.historyLimit ?? 0) || 0);
    this.maxEventNames = Math.max(0, Number(options.maxEventNames ?? options.maxHistoryEvents ?? 0) || 0);
    this.maxEntriesTotal = Math.max(0, Number(options.maxEntriesTotal ?? 0) || 0);
    this.maxBytes = Math.max(0, Number(options.maxBytes ?? options.maxHistoryBytes ?? 0) || 0);
    this.maxPayloadBytes = Math.max(0, Number(options.maxPayloadBytes ?? 0) || 0);
    this.ttlMs = Math.max(0, Number(options.ttlMs ?? 0) || 0);
    this.clonePolicy = options.clonePolicy || 'reference';
    this.allow = compileMatcherList(options.allow ?? options.historyAllow);
    this.deny = compileMatcherList(options.deny ?? options.historyDeny);
    this.codec = options.codec || new SafeJsonCodec({
      maxBytes: this.maxPayloadBytes,
      redact: options.redact !== false,
      redactKeys: options.redactKeys,
      reconstruct: true,
    });

    this.buffers = new Map();
    this.entryBySeq = new Map();
    this.global = [];
    this.globalHead = 0;
    this.sequence = 0;
    this.totalEntries = 0;
    this.totalBytes = 0;
    this.compatibilityView = new EventJournalCompatibilityView(this);
    this.stats = {
      recorded: 0,
      rejected: 0,
      evicted: 0,
      expired: 0,
      oversized: 0,
      eventNamesEvicted: 0,
      serializationFailures: 0,
    };
  }

  get enabled() { return this.maxEntriesPerEvent > 0; }
  get eventCount() { return this.buffers.size; }

  shouldRecord(eventName) {
    if (!this.enabled) return false;
    if (this.allow.length && !matchesAny(this.allow, eventName)) return false;
    if (this.deny.length && matchesAny(this.deny, eventName)) return false;
    return true;
  }

  _clone(args, ctx) {
    if (this.clonePolicy === 'reference') return { args, ctx: ctx && typeof ctx === 'object' ? { ...ctx } : ctx };
    if (this.clonePolicy === 'shallow') return {
      args: Array.isArray(args) ? args.slice() : args,
      ctx: ctx && typeof ctx === 'object' ? { ...ctx } : ctx,
    };
    try {
      const encoded = this.codec.encode({ args, ctx });
      const decoded = this.codec.parse(encoded.text);
      return { args: decoded.args, ctx: decoded.ctx };
    } catch {
      this.stats.serializationFailures++;
      return {
        args: Array.isArray(args) ? args.slice() : [],
        ctx: ctx && typeof ctx === 'object' ? { ...ctx } : null,
      };
    }
  }

  record(eventName, args, ctx = null, now = Date.now()) {
    if (!this.shouldRecord(eventName)) return { accepted: false, reason: 'policy' };
    this.pruneExpired(now);

    const cloned = this._clone(args, ctx);
    const bytes = estimateValueBytes(cloned, { maxDepth: 24, maxKeys: 10_000 });
    if (this.maxPayloadBytes && bytes > this.maxPayloadBytes) {
      this.stats.rejected++;
      this.stats.oversized++;
      return { accepted: false, reason: 'maxPayloadBytes', bytes };
    }

    if (!this.buffers.has(eventName) && this.maxEventNames && this.buffers.size >= this.maxEventNames) {
      this._evictOldestEventName();
    }

    let ring = this.buffers.get(eventName);
    if (!ring) {
      ring = new RingBuffer(this.maxEntriesPerEvent);
      this.buffers.set(eventName, ring);
    }

    const entry = {
      seq: ++this.sequence,
      eventName,
      ts: now,
      args: cloned.args,
      ctx: cloned.ctx,
      bytes,
    };
    const evicted = ring.push(entry);
    if (evicted) this._removeAccounting(evicted, 'evicted');

    this.entryBySeq.set(entry.seq, entry);
    this.global.push({ seq: entry.seq, eventName });
    this.totalEntries++;
    this.totalBytes += bytes;
    this.stats.recorded++;
    this._enforceGlobalBounds();
    this._compactGlobal();
    return { accepted: true, entry: publicEntry(entry), bytes };
  }

  _removeAccounting(entry, reason) {
    if (!entry || !this.entryBySeq.has(entry.seq)) return false;
    this.entryBySeq.delete(entry.seq);
    this.totalEntries = Math.max(0, this.totalEntries - 1);
    this.totalBytes = Math.max(0, this.totalBytes - entry.bytes);
    if (reason === 'expired') this.stats.expired++;
    else this.stats.evicted++;
    return true;
  }

  _removeFromRing(entry, reason) {
    const ring = this.buffers.get(entry.eventName);
    if (!ring) return false;
    const removed = ring.remove((candidate) => candidate.seq === entry.seq);
    if (removed) this._removeAccounting(entry, reason);
    if (ring.length === 0) this.buffers.delete(entry.eventName);
    return removed > 0;
  }

  _oldestLive() {
    while (this.globalHead < this.global.length) {
      const marker = this.global[this.globalHead];
      const entry = this.entryBySeq.get(marker.seq);
      if (entry) return entry;
      this.globalHead++;
    }
    return null;
  }

  _evictOldest(reason = 'evicted') {
    const entry = this._oldestLive();
    if (!entry) return false;
    this.globalHead++;
    return this._removeFromRing(entry, reason);
  }

  _evictOldestEventName() {
    const oldest = this._oldestLive();
    if (!oldest) return false;
    const count = this.clear(oldest.eventName);
    if (count) this.stats.eventNamesEvicted++;
    return count > 0;
  }

  _enforceGlobalBounds() {
    while (this.maxEntriesTotal && this.totalEntries > this.maxEntriesTotal) {
      if (!this._evictOldest()) break;
    }
    while (this.maxBytes && this.totalBytes > this.maxBytes) {
      if (!this._evictOldest()) break;
    }
  }

  _compactGlobal() {
    if (this.globalHead < 4096 || this.globalHead < this.global.length / 2) return;
    this.global = this.global.slice(this.globalHead);
    this.globalHead = 0;
  }

  pruneExpired(now = Date.now()) {
    if (!this.ttlMs) return 0;
    let removed = 0;
    const threshold = now - this.ttlMs;
    while (true) {
      const entry = this._oldestLive();
      if (!entry || entry.ts > threshold) break;
      this.globalHead++;
      if (this._removeFromRing(entry, 'expired')) removed++;
    }
    this._compactGlobal();
    return removed;
  }

  has(eventName) { this.pruneExpired(); return this.buffers.has(String(eventName)); }

  get(eventName, options = {}) {
    this.pruneExpired(options.now);
    const ring = this.buffers.get(String(eventName));
    if (!ring) return [];
    let entries = ring.toArray();
    if (options.since != null) entries = entries.filter((entry) => entry.ts >= Number(options.since));
    if (options.until != null) entries = entries.filter((entry) => entry.ts <= Number(options.until));
    if (options.correlationId != null) entries = entries.filter((entry) => entry.ctx?.correlationId === options.correlationId || entry.ctx?.id === options.correlationId);
    if (options.tenantId != null) entries = entries.filter((entry) => entry.ctx?.tenantId === options.tenantId);
    if (typeof options.predicate === 'function') entries = entries.filter((entry) => options.predicate(publicEntry(entry)));
    const limit = Number(options.limit) || 0;
    if (limit > 0 && entries.length > limit) entries = entries.slice(entries.length - limit);
    return entries.map(publicEntry);
  }

  all(options = {}) {
    this.pruneExpired(options.now);
    const output = [];
    for (const entry of this.entryBySeq.values()) {
      if (options.since != null && entry.ts < Number(options.since)) continue;
      if (options.until != null && entry.ts > Number(options.until)) continue;
      if (options.correlationId != null && entry.ctx?.correlationId !== options.correlationId && entry.ctx?.id !== options.correlationId) continue;
      if (options.tenantId != null && entry.ctx?.tenantId !== options.tenantId) continue;
      const item = { eventName: entry.eventName, ...publicEntry(entry) };
      if (typeof options.predicate === 'function' && !options.predicate(item)) continue;
      output.push(item);
    }
    output.sort((left, right) => left.ts - right.ts || left.eventName.localeCompare(right.eventName));
    const limit = Number(options.limit) || 0;
    return limit > 0 && output.length > limit ? output.slice(output.length - limit) : output;
  }

  eventNames() { this.pruneExpired(); return Array.from(this.buffers.keys()); }

  *entries() {
    this.pruneExpired();
    for (const [eventName, ring] of this.buffers) yield [eventName, ring.toArray().map(publicEntry)];
  }

  clear(eventName = null) {
    if (eventName == null) {
      const count = this.totalEntries;
      this.buffers.clear();
      this.entryBySeq.clear();
      this.global.length = 0;
      this.globalHead = 0;
      this.totalEntries = 0;
      this.totalBytes = 0;
      return count;
    }
    const name = String(eventName);
    const ring = this.buffers.get(name);
    if (!ring) return 0;
    const entries = ring.toArray();
    this.buffers.delete(name);
    for (const entry of entries) this._removeAccounting(entry, 'evicted');
    return entries.length;
  }

  snapshot() {
    this.pruneExpired();
    return Object.freeze({
      enabled: this.enabled,
      eventNames: this.buffers.size,
      entries: this.totalEntries,
      bytes: this.totalBytes,
      limits: Object.freeze({
        maxEntriesPerEvent: this.maxEntriesPerEvent,
        maxEventNames: this.maxEventNames,
        maxEntriesTotal: this.maxEntriesTotal,
        maxBytes: this.maxBytes,
        maxPayloadBytes: this.maxPayloadBytes,
        ttlMs: this.ttlMs,
      }),
      clonePolicy: this.clonePolicy,
      stats: Object.freeze({ ...this.stats }),
    });
  }
}

export default EventJournal;
