'use strict';

import { collection, duplicate, publicDocument, safeError } from './support.js';

/** Persistent idempotency inbox for effectively-once event handlers. */
export class RawMongoEventInbox {
  constructor(source, options = {}) {
    this.source = source;
    this.options = options;
    this.name = options.collection || 'events_inbox';
    this.collection = collection(source, this.name, options);
    this.ttlMs = Math.max(1, Number(options.ttlMs) || 24 * 60 * 60 * 1000);
    this.processingTtlMs = Math.max(1_000, Number(options.processingTtlMs) || 5 * 60 * 1000);
    this.owner = options.owner || `${process.pid}`;
    this.inFlight = new Map();
    this.stats = { accepted: 0, duplicates: 0, completed: 0, failed: 0, reclaimed: 0 };
  }
  async has(id, now = Date.now()) {
    const record = await this.collection.findOne({ _id: String(id), status: 'completed', expiresAt: { $gt: new Date(now) } });
    return !!record;
  }
  async run(id, handler, options = {}) {
    const key = String(id || '');
    if (!key) throw new TypeError('Inbox id is required.');
    if (typeof handler !== 'function') throw new TypeError('Inbox handler must be a function.');
    if (this.inFlight.has(key)) { this.stats.duplicates++; return this.inFlight.get(key); }
    const operation = this._run(key, handler, options).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, operation);
    return operation;
  }
  async _run(key, handler, options) {
    const now = new Date();
    const processingUntil = new Date(now.getTime() + Math.max(1_000, Number(options.processingTtlMs) || this.processingTtlMs));
    const record = { _id: key, status: 'processing', owner: String(options.owner || this.owner), handler: options.handlerId || null, eventId: options.eventId || key, idempotencyKey: options.idempotencyKey || key, context: options.context || null, attempts: 1, createdAt: now, updatedAt: now, processingUntil, expiresAt: new Date(now.getTime() + Math.max(1, Number(options.ttlMs) || this.ttlMs)) };
    try { await this.collection.insertOne(record, writeOptions(options)); }
    catch (error) {
      if (!duplicate(error)) throw error;
      const existing = await this.collection.findOne({ _id: key });
      if (existing?.status === 'completed' && new Date(existing.expiresAt).getTime() > Date.now()) { this.stats.duplicates++; return { accepted: false, duplicate: true, record: publicDocument(existing), value: existing.result }; }
      if (existing?.status === 'processing' && new Date(existing.processingUntil || 0).getTime() > Date.now()) { this.stats.duplicates++; return { accepted: false, duplicate: true, inFlight: true, record: publicDocument(existing) }; }
      const claimed = await this.collection.findOneAndUpdate({
        _id: key,
        $and: [
          { $or: [{ status: { $ne: 'completed' } }, { expiresAt: { $lte: now } }] },
          { $or: [{ processingUntil: { $lte: now } }, { processingUntil: null }, { processingUntil: { $exists: false } }] },
        ],
      }, { $set: { ...record, createdAt: existing?.createdAt || now }, $inc: { attempts: 1 } }, { returnDocument: 'after', ...writeOptions(options) });
      if (!(claimed?.value || claimed?.document || claimed)) { this.stats.duplicates++; return { accepted: false, duplicate: true }; }
      this.stats.reclaimed++;
    }
    this.stats.accepted++;
    try {
      const value = await handler();
      await this.collection.updateOne({ _id: key, status: 'processing', owner: String(options.owner || this.owner) }, { $set: { status: 'completed', result: options.storeResult === false ? null : safeResult(value), completedAt: new Date(), updatedAt: new Date(), processingUntil: null, expiresAt: new Date(Date.now() + Math.max(1, Number(options.ttlMs) || this.ttlMs)) } }, writeOptions(options));
      this.stats.completed++;
      return { accepted: true, duplicate: false, value };
    } catch (error) {
      this.stats.failed++;
      if (options.rememberFailure === true) await this.collection.updateOne({ _id: key }, { $set: { status: 'failed', lastError: safeError(error), updatedAt: new Date(), processingUntil: null } }, writeOptions(options));
      else await this.collection.deleteOne({ _id: key, status: 'processing', owner: String(options.owner || this.owner) }, writeOptions(options));
      throw error;
    }
  }
  async remember(id, ttlMs = this.ttlMs, options = {}) { const now = new Date(); await this.collection.updateOne({ _id: String(id) }, { $set: { status: 'completed', completedAt: now, updatedAt: now, expiresAt: new Date(now.getTime() + Math.max(1, Number(ttlMs) || this.ttlMs)) }, $setOnInsert: { createdAt: now, attempts: 0 } }, { upsert: true, ...writeOptions(options) }); return this; }
  async clear(options = {}) { const result = await this.collection.deleteMany(options.filter || {}, { ...writeOptions(options), intent: 'events-inbox-clear', allowAll: true }); return Number(result?.deletedCount ?? result?.n ?? 0); }
  snapshot() { return Object.freeze({ driver: 'rawmongo', collection: this.name, owner: this.owner, inFlight: this.inFlight.size, ttlMs: this.ttlMs, stats: Object.freeze({ ...this.stats }) }); }
}
function safeResult(value) { if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value; try { return structuredClone(value); } catch { return null; } }
function writeOptions(options) { return options.session ? { session: options.session } : {}; }
export default RawMongoEventInbox;
