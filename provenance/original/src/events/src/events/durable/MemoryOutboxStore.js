'use strict';

import { EventEmitter } from 'node:events';
import { EventAdmissionError } from '../errors/EventError.js';
import { estimateValueBytes } from '../support/size.js';

function cloneRecord(record) {
  return record ? { ...record, args: record.args?.slice?.() || [], context: record.context ? { ...record.context } : null, headers: record.headers ? { ...record.headers } : null } : null;
}

/** Bounded in-memory reference implementation for the durable outbox contract. */
export class MemoryOutboxStore extends EventEmitter {
  constructor(options = {}) {
    super();
    this.maxItems = Math.max(1, Number(options.maxItems) || 100_000);
    this.maxBytes = Math.max(1, Number(options.maxBytes) || 128 * 1024 * 1024);
    this.overflow = options.overflow || 'reject';
    this.defaultMaxAttempts = Math.max(1, Number(options.maxAttempts) || 10);
    this.records = new Map();
    this.order = [];
    this.idempotency = new Map();
    this.bytes = 0;
    this.sequence = 0;
    this.stats = { appended: 0, claimed: 0, completed: 0, failed: 0, deadLettered: 0, duplicates: 0, rejected: 0, pruned: 0 };
  }

  async append(input) {
    const id = String(input?.id || `outbox-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`);
    const idempotencyKey = input?.idempotencyKey == null ? null : String(input.idempotencyKey);
    if (idempotencyKey && this.idempotency.has(idempotencyKey)) {
      this.stats.duplicates++;
      return { inserted: false, duplicate: true, record: cloneRecord(this.records.get(this.idempotency.get(idempotencyKey))) };
    }
    if (this.records.has(id)) {
      this.stats.duplicates++;
      return { inserted: false, duplicate: true, record: cloneRecord(this.records.get(id)) };
    }

    const now = Number(input?.createdAt) || Date.now();
    const record = {
      id,
      event: String(input?.event || ''),
      version: Math.max(1, Number(input?.version) || 1),
      args: Array.isArray(input?.args) ? input.args.slice() : [],
      context: input?.context && typeof input.context === 'object' ? { ...input.context } : null,
      headers: input?.headers && typeof input.headers === 'object' ? { ...input.headers } : null,
      idempotencyKey,
      status: 'pending',
      attempts: 0,
      maxAttempts: Math.max(1, Number(input?.maxAttempts) || this.defaultMaxAttempts),
      availableAt: Number(input?.availableAt) || now,
      createdAt: now,
      updatedAt: now,
      leaseOwner: null,
      leaseUntil: 0,
      publishedAt: 0,
      lastError: null,
      meta: input?.meta && typeof input.meta === 'object' ? { ...input.meta } : null,
    };
    record.bytes = estimateValueBytes(record);
    this._admit(record.bytes);

    this.records.set(id, record);
    this.order.push(id);
    if (idempotencyKey) this.idempotency.set(idempotencyKey, id);
    this.bytes += record.bytes;
    this.stats.appended++;
    this.emit('available', cloneRecord(record));
    return { inserted: true, duplicate: false, record: cloneRecord(record) };
  }

  _admit(bytes) {
    while (this.records.size >= this.maxItems || this.bytes + bytes > this.maxBytes) {
      if (this.overflow !== 'drop-completed') {
        this.stats.rejected++;
        throw new EventAdmissionError('Outbox capacity exceeded', {
          code: 'EVENT_OUTBOX_CAPACITY', details: { bytes, maxItems: this.maxItems, maxBytes: this.maxBytes },
        });
      }
      const removable = this.order.find((id) => ['published', 'dead'].includes(this.records.get(id)?.status));
      if (!removable) {
        this.stats.rejected++;
        throw new EventAdmissionError('Outbox capacity exceeded and no completed record can be pruned', { code: 'EVENT_OUTBOX_CAPACITY' });
      }
      this.remove(removable);
    }
  }

  async claim(options = {}) {
    const now = Number(options.now) || Date.now();
    const owner = String(options.owner || `worker-${process.pid}`);
    const leaseMs = Math.max(1, Number(options.leaseMs) || 30_000);
    const limit = Math.max(1, Number(options.limit) || 100);
    const claimed = [];

    for (const id of this.order) {
      if (claimed.length >= limit) break;
      const record = this.records.get(id);
      if (!record) continue;
      const expiredLease = record.status === 'processing' && record.leaseUntil > 0 && record.leaseUntil <= now;
      const available = (record.status === 'pending' || record.status === 'failed' || expiredLease) && record.availableAt <= now;
      if (!available) continue;
      record.status = 'processing';
      record.leaseOwner = owner;
      record.leaseUntil = now + leaseMs;
      record.updatedAt = now;
      claimed.push(cloneRecord(record));
    }
    this.stats.claimed += claimed.length;
    return claimed;
  }

  async complete(id, options = {}) {
    const record = this._owned(id, options.owner);
    const now = Number(options.now) || Date.now();
    record.status = 'published';
    record.publishedAt = now;
    record.updatedAt = now;
    record.leaseOwner = null;
    record.leaseUntil = 0;
    record.lastError = null;
    this.stats.completed++;
    return cloneRecord(record);
  }

  async fail(id, error, options = {}) {
    const record = this._owned(id, options.owner);
    const now = Number(options.now) || Date.now();
    record.attempts++;
    record.updatedAt = now;
    record.leaseOwner = null;
    record.leaseUntil = 0;
    record.lastError = {
      name: error?.name || 'Error',
      message: error?.message || String(error || 'Outbox publish failed'),
      code: error?.code,
      at: now,
    };
    if (record.attempts >= record.maxAttempts || options.deadLetter === true) {
      record.status = 'dead';
      record.availableAt = 0;
      this.stats.deadLettered++;
    } else {
      record.status = 'failed';
      record.availableAt = now + Math.max(0, Number(options.retryAfterMs) || 0);
      this.stats.failed++;
      this.emit('available', cloneRecord(record));
    }
    return cloneRecord(record);
  }

  async release(id, options = {}) {
    const record = this._owned(id, options.owner);
    record.status = 'pending';
    record.leaseOwner = null;
    record.leaseUntil = 0;
    record.availableAt = Number(options.availableAt) || Date.now();
    record.updatedAt = Date.now();
    this.emit('available', cloneRecord(record));
    return cloneRecord(record);
  }

  _owned(id, owner) {
    const record = this.records.get(String(id));
    if (!record) throw new EventAdmissionError(`Outbox record not found: ${id}`, { code: 'EVENT_OUTBOX_NOT_FOUND' });
    if (owner != null && record.leaseOwner && record.leaseOwner !== String(owner)) {
      throw new EventAdmissionError(`Outbox lease is owned by ${record.leaseOwner}`, { code: 'EVENT_OUTBOX_LEASE_OWNER' });
    }
    return record;
  }

  get(id) { return cloneRecord(this.records.get(String(id))); }
  all(options = {}) {
    let records = this.order.map((id) => this.records.get(id)).filter(Boolean);
    if (options.status) records = records.filter((record) => record.status === String(options.status));
    if (options.event) records = records.filter((record) => record.event === String(options.event));
    const limit = Math.max(0, Number(options.limit) || 0);
    if (limit) records = records.slice(-limit);
    return records.map(cloneRecord);
  }

  remove(id) {
    const key = String(id);
    const record = this.records.get(key);
    if (!record) return false;
    this.records.delete(key);
    if (record.idempotencyKey) this.idempotency.delete(record.idempotencyKey);
    this.bytes = Math.max(0, this.bytes - (record.bytes || 0));
    const index = this.order.indexOf(key);
    if (index !== -1) this.order.splice(index, 1);
    this.stats.pruned++;
    return true;
  }

  prune(options = {}) {
    const before = Number(options.before) || Date.now();
    const statuses = new Set(options.statuses || ['published', 'dead']);
    let removed = 0;
    for (const id of [...this.order]) {
      const record = this.records.get(id);
      if (record && statuses.has(record.status) && record.updatedAt <= before && this.remove(id)) removed++;
    }
    return removed;
  }

  snapshot() {
    const status = Object.create(null);
    for (const record of this.records.values()) status[record.status] = (status[record.status] || 0) + 1;
    return Object.freeze({
      items: this.records.size,
      bytes: this.bytes,
      maxItems: this.maxItems,
      maxBytes: this.maxBytes,
      status: Object.freeze(status),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  close() { this.removeAllListeners(); }
}

export default MemoryOutboxStore;
