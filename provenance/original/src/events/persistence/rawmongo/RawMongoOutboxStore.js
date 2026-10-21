'use strict';

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { array, collection, duplicate, matched, publicDocument, safeError, value } from './support.js';

/** Atomic lease-based outbox backed by RawMongo. */
export class RawMongoOutboxStore extends EventEmitter {
  constructor(source, options = {}) {
    super();
    this.source = source;
    this.options = options;
    this.name = options.collection || 'events_outbox';
    this.collection = collection(source, this.name, options);
    this.defaultMaxAttempts = Math.max(1, Number(options.maxAttempts) || 10);
    this.owner = options.owner || `${process.pid}:${randomUUID()}`;
    this.stats = { appended: 0, duplicates: 0, claimed: 0, completed: 0, failed: 0, deadLettered: 0, released: 0, pruned: 0, leaseLost: 0 };
  }
  async append(input = {}) {
    const now = new Date(Number(input.createdAt) || Date.now());
    const document = {
      _id: String(input.id || randomUUID()), event: String(input.event || ''), version: Math.max(1, Number(input.version) || 1),
      args: Array.isArray(input.args) ? input.args : [], context: input.context || null, headers: input.headers || null,
      idempotencyKey: input.idempotencyKey == null ? null : String(input.idempotencyKey), status: 'pending', attempts: 0,
      maxAttempts: Math.max(1, Number(input.maxAttempts) || this.defaultMaxAttempts), availableAt: new Date(Number(input.availableAt) || now.getTime()),
      createdAt: now, updatedAt: now, leaseOwner: null, leaseUntil: null, fencingToken: 0,
      publishedAt: null, lastError: null, meta: input.meta || null,
    };
    try { await this.collection.insertOne(document, writeOptions(input)); this.stats.appended++; this.emit('available', publicDocument(document)); return { inserted: true, duplicate: false, record: publicDocument(document) }; }
    catch (error) {
      if (!duplicate(error)) throw error;
      this.stats.duplicates++;
      const existing = document.idempotencyKey ? await this.collection.findOne({ idempotencyKey: document.idempotencyKey }) : await this.collection.findOne({ _id: document._id });
      return { inserted: false, duplicate: true, record: publicDocument(existing) };
    }
  }
  async claim(options = {}) {
    const now = new Date(Number(options.now) || Date.now());
    const owner = String(options.owner || this.owner);
    const leaseUntil = new Date(now.getTime() + Math.max(1, Number(options.leaseMs) || 30_000));
    const limit = Math.max(1, Number(options.limit) || 100);
    const claimed = [];
    for (let index = 0; index < limit; index++) {
      const result = await this.collection.findOneAndUpdate({
        availableAt: { $lte: now },
        $or: [
          { status: { $in: ['pending', 'failed'] } },
          { status: 'processing', leaseUntil: { $lte: now } },
        ],
      }, { $set: { status: 'processing', leaseOwner: owner, leaseUntil, updatedAt: now }, $inc: { fencingToken: 1 } }, { sort: { availableAt: 1, createdAt: 1 }, returnDocument: 'after', ...writeOptions(options) });
      const record = value(result);
      if (!record) break;
      claimed.push(publicDocument(record));
    }
    this.stats.claimed += claimed.length;
    return claimed;
  }
  async complete(id, options = {}) {
    const now = new Date(Number(options.now) || Date.now()); const owner = options.owner || this.owner;
    const result = await this.collection.findOneAndUpdate(
      ownedFilter(id, owner, options.fencingToken),
      { $set: { status: 'published', publishedAt: now, updatedAt: now, leaseOwner: null, leaseUntil: null, lastError: null } },
      { returnDocument: 'after', ...writeOptions(options) },
    );
    const record = value(result); if (!record) return this._leaseLost(id); this.stats.completed++; return publicDocument(record);
  }
  async fail(id, error, options = {}) {
    const current = await this.collection.findOne({ _id: String(id) });
    if (!current) throw outboxError(`Outbox record not found: ${id}`, 'EVENT_OUTBOX_NOT_FOUND');
    const now = new Date(Number(options.now) || Date.now()); const attempts = Number(current.attempts || 0) + 1;
    const dead = options.deadLetter === true || attempts >= Number(current.maxAttempts || this.defaultMaxAttempts);
    const owner = options.owner || this.owner;
    const result = await this.collection.findOneAndUpdate(ownedFilter(id, owner, options.fencingToken), {
      $set: { status: dead ? 'dead' : 'failed', attempts, availableAt: dead ? null : new Date(now.getTime() + Math.max(0, Number(options.retryAfterMs) || 0)), updatedAt: now, leaseOwner: null, leaseUntil: null, lastError: safeError(error) },
    }, { returnDocument: 'after', ...writeOptions(options) });
    const record = value(result); if (!record) return this._leaseLost(id); if (dead) this.stats.deadLettered++; else { this.stats.failed++; this.emit('available', publicDocument(record)); } return publicDocument(record);
  }
  async release(id, options = {}) {
    const owner = options.owner || this.owner; const now = new Date();
    const result = await this.collection.findOneAndUpdate(
      ownedFilter(id, owner, options.fencingToken),
      { $set: { status: 'pending', leaseOwner: null, leaseUntil: null, availableAt: new Date(Number(options.availableAt) || now.getTime()), updatedAt: now } },
      { returnDocument: 'after', ...writeOptions(options) },
    );
    const record = value(result); if (!record) return this._leaseLost(id); this.stats.released++; this.emit('available', publicDocument(record)); return publicDocument(record);
  }
  async renew(id, options = {}) {
    const owner = options.owner || this.owner;
    const leaseUntil = new Date(Date.now() + Math.max(1, Number(options.leaseMs) || 30_000));
    const result = await this.collection.updateOne(
      ownedFilter(id, owner, options.fencingToken),
      { $set: { leaseUntil, updatedAt: new Date() } },
      writeOptions(options),
    );
    if (!matched(result)) this._leaseLost(id);
    return true;
  }
  async get(id) { return publicDocument(await this.collection.findOne({ _id: String(id) })); }
  async all(options = {}) { const filter = {}; if (options.status) filter.status = String(options.status); if (options.event) filter.event = String(options.event); let cursor = this.collection.find(filter); cursor = cursor.sort?.({ createdAt: 1 }) || cursor; if (options.limit) cursor = cursor.limit?.(Math.max(1, Number(options.limit))) || cursor; return (await array(cursor)).map(publicDocument); }
  async remove(id) { const result = await this.collection.deleteOne({ _id: String(id) }); return Number(result?.deletedCount ?? result?.n ?? 0) > 0; }
  async prune(options = {}) { const result = await this.collection.deleteMany({ status: { $in: options.statuses || ['published', 'dead'] }, updatedAt: { $lte: new Date(Number(options.before) || Date.now()) } }, { ...writeOptions(options), intent: 'events-outbox-prune', allowAll: true }); const count = Number(result?.deletedCount ?? result?.n ?? 0); this.stats.pruned += count; return count; }
  snapshot() { return Object.freeze({ driver: 'rawmongo', collection: this.name, owner: this.owner, stats: Object.freeze({ ...this.stats }) }); }
  close() { this.removeAllListeners(); }
  _leaseLost(id) { this.stats.leaseLost++; throw outboxError(`Outbox lease was lost for ${id}.`, 'EVENT_OUTBOX_LEASE_LOST'); }
}
function ownedFilter(id, owner, fencingToken = null) {
  return {
    _id: String(id),
    status: 'processing',
    ...(owner ? { leaseOwner: String(owner) } : {}),
    ...(fencingToken == null ? {} : { fencingToken: Number(fencingToken) }),
  };
}
function writeOptions(options) { return options.session ? { session: options.session } : {}; }
function outboxError(message, code) { return Object.assign(new Error(message), { name: 'EventOutboxError', code, retryable: code === 'EVENT_OUTBOX_LEASE_LOST' }); }
export default RawMongoOutboxStore;
