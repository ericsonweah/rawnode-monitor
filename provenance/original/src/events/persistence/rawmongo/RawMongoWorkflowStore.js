'use strict';

import { array, collection, duplicate, publicDocument } from './support.js';

export class RawMongoWorkflowStore {
  constructor(source, options = {}) { this.name = options.collection || 'events_workflows'; this.collection = collection(source, this.name, options); this.stats = { created: 0, saved: 0, removed: 0, conflicts: 0 }; }
  async create(record, options = {}) { const document = normalize(record); try { await this.collection.insertOne(document, writeOptions(options)); this.stats.created++; return publicDocument(document); } catch (error) { if (duplicate(error)) { this.stats.conflicts++; throw Object.assign(new Error(`Workflow already exists: ${document._id}`), { code: 'EVENT_WORKFLOW_DUPLICATE' }); } throw error; } }
  async get(id) { return publicDocument(await this.collection.findOne({ _id: String(id) })); }
  async save(record, options = {}) { const document = normalize(record); const expectedVersion = options.expectedVersion ?? record.storeVersion; const filter = { _id: document._id, ...(expectedVersion == null ? {} : { storeVersion: Number(expectedVersion) }) }; const nextVersion = Math.max(1, Number(expectedVersion) + 1 || Number(document.storeVersion) + 1 || 1); const result = await this.collection.findOneAndUpdate(filter, { $set: { ...document, storeVersion: nextVersion, updatedAt: new Date() }, $setOnInsert: { createdAt: document.createdAt || new Date() } }, { upsert: expectedVersion == null && options.upsert !== false, returnDocument: 'after', ...writeOptions(options) }); const value = unwrap(result); if (!value) { this.stats.conflicts++; throw Object.assign(new Error(`Workflow version conflict: ${document._id}`), { code: 'EVENT_WORKFLOW_CONCURRENCY' }); } this.stats.saved++; return publicDocument(value); }
  async remove(id, options = {}) { const result = await this.collection.deleteOne({ _id: String(id) }, writeOptions(options)); const removed = Number(result?.deletedCount ?? result?.n ?? 0) > 0; if (removed) this.stats.removed++; return removed; }
  async list(options = {}) { const filter = {}; if (options.name) filter.name = String(options.name); if (options.status) filter.status = String(options.status); if (options.tenantId != null) filter.tenantId = options.tenantId; let cursor = this.collection.find(filter); cursor = cursor.sort?.({ updatedAt: -1 }) || cursor; if (options.limit) cursor = cursor.limit?.(Math.max(1, Number(options.limit))) || cursor; return (await array(cursor)).map(publicDocument); }
  snapshot() { return Object.freeze({ driver: 'rawmongo', collection: this.name, stats: Object.freeze({ ...this.stats }) }); }
}
function normalize(record = {}) { const now = new Date(); return { ...record, _id: String(record.id || record._id), id: String(record.id || record._id), storeVersion: Math.max(0, Number(record.storeVersion) || 0), createdAt: record.createdAt ? new Date(record.createdAt) : now, updatedAt: now }; }

function unwrap(result) {
  if (result == null) return null;
  if (Object.prototype.hasOwnProperty.call(result, 'value')) return result.value;
  if (Object.prototype.hasOwnProperty.call(result, 'document')) return result.document;
  return result;
}
function writeOptions(options) { return options.session ? { session: options.session } : {}; }
export default RawMongoWorkflowStore;
