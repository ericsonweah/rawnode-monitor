'use strict';

import { array, collection } from './support.js';

export class RawMongoProjectionCheckpointStore {
  constructor(source, options = {}) { this.name = options.collection || 'events_projection_checkpoints'; this.collection = collection(source, this.name, options); }
  async get(name, options = {}) { const value = await this.collection.findOne({ _id: String(name), ...(options.tenantId == null ? {} : { tenantId: options.tenantId }) }); return Number(value?.position) || 0; }
  async set(name, position, options = {}) { const now = new Date(); await this.collection.updateOne({ _id: String(name), ...(options.tenantId == null ? {} : { tenantId: options.tenantId }) }, { $set: { position: Math.max(0, Number(position) || 0), updatedAt: now, metadata: options.metadata || null }, $setOnInsert: { createdAt: now } }, { upsert: true, ...(options.session ? { session: options.session } : {}) }); return position; }
  async clear(name = null, options = {}) { if (name != null) { const result = await this.collection.deleteOne({ _id: String(name), ...(options.tenantId == null ? {} : { tenantId: options.tenantId }) }); return Number(result?.deletedCount ?? result?.n ?? 0); } const result = await this.collection.deleteMany(options.tenantId == null ? {} : { tenantId: options.tenantId }, { intent: 'events-checkpoints-clear', allowAll: true }); return Number(result?.deletedCount ?? result?.n ?? 0); }
  async all(options = {}) { let cursor = this.collection.find(options.tenantId == null ? {} : { tenantId: options.tenantId }); cursor = cursor.sort?.({ _id: 1 }) || cursor; return await array(cursor); }
  snapshot() { return Object.freeze({ driver: 'rawmongo', collection: this.name }); }
}
export default RawMongoProjectionCheckpointStore;
