'use strict';

import { deepFreeze, randomId } from '../support/safe.js';

export class EventResourceLease {
  constructor(governor, record) { this.governor = governor; this.record = record; this.released = false; }
  get accepted() { return true; }
  get id() { return this.record.id; }
  release() { if (this.released) return false; this.released = true; return this.governor.release(this.record.id); }
  [Symbol.dispose]() { this.release(); }
  async [Symbol.asyncDispose]() { this.release(); }
}

export class EventResourceGovernor {
  constructor(options = {}) {
    this.maxItems = nonNegative(options.maxItems ?? options.resourceItems, 0);
    this.maxBytes = nonNegative(options.maxBytes ?? options.resourceBytes, 0);
    this.tenantMaxItems = nonNegative(options.tenantMaxItems ?? options.tenantItems, 0);
    this.tenantMaxBytes = nonNegative(options.tenantMaxBytes ?? options.tenantBytes, 0);
    this.categoryLimits = new Map(Object.entries(options.categories || {}));
    this.records = new Map();
    this.categories = new Map();
    this.tenants = new Map();
    this.items = 0;
    this.bytes = 0;
    this.highWaterItems = 0;
    this.highWaterBytes = 0;
    this.stats = { admitted: 0, rejected: 0, released: 0, leakedReleases: 0 };
  }

  reserve(input = {}) {
    const category = String(input.category || 'default');
    const tenantId = input.tenantId == null ? null : String(input.tenantId);
    const items = Math.max(1, Number(input.items) || 1);
    const bytes = Math.max(0, Number(input.bytes) || 0);
    const categoryUsage = this.categories.get(category) || { items: 0, bytes: 0 };
    const categoryLimit = this.categoryLimits.get(category) || {};
    const tenantUsage = tenantId ? this.tenants.get(tenantId) || { items: 0, bytes: 0 } : null;
    const reason = this._rejection({ items, bytes, categoryUsage, categoryLimit, tenantUsage });
    if (reason) {
      this.stats.rejected++;
      return deepFreeze({ accepted: false, code: 'EVENT_CAPACITY_EXCEEDED', reason, retryable: true, category, tenantId, requested: { items, bytes }, snapshot: this.snapshot() });
    }
    const record = { id: input.id || randomId('lease'), category, tenantId, items, bytes, createdAt: Date.now(), label: input.label || null };
    this.records.set(record.id, record);
    this.items += items; this.bytes += bytes;
    categoryUsage.items += items; categoryUsage.bytes += bytes; this.categories.set(category, categoryUsage);
    if (tenantUsage) { tenantUsage.items += items; tenantUsage.bytes += bytes; this.tenants.set(tenantId, tenantUsage); }
    this.highWaterItems = Math.max(this.highWaterItems, this.items);
    this.highWaterBytes = Math.max(this.highWaterBytes, this.bytes);
    this.stats.admitted++;
    return new EventResourceLease(this, record);
  }

  _rejection({ items, bytes, categoryUsage, categoryLimit, tenantUsage }) {
    if (this.maxItems && this.items + items > this.maxItems) return 'global-item-budget';
    if (this.maxBytes && this.bytes + bytes > this.maxBytes) return 'global-byte-budget';
    if (categoryLimit.maxItems && categoryUsage.items + items > categoryLimit.maxItems) return 'category-item-budget';
    if (categoryLimit.maxBytes && categoryUsage.bytes + bytes > categoryLimit.maxBytes) return 'category-byte-budget';
    if (tenantUsage && this.tenantMaxItems && tenantUsage.items + items > this.tenantMaxItems) return 'tenant-item-budget';
    if (tenantUsage && this.tenantMaxBytes && tenantUsage.bytes + bytes > this.tenantMaxBytes) return 'tenant-byte-budget';
    return null;
  }

  release(id) {
    const record = this.records.get(String(id));
    if (!record) { this.stats.leakedReleases++; return false; }
    this.records.delete(record.id);
    this.items = Math.max(0, this.items - record.items); this.bytes = Math.max(0, this.bytes - record.bytes);
    decrement(this.categories, record.category, record);
    if (record.tenantId) decrement(this.tenants, record.tenantId, record);
    this.stats.released++;
    return true;
  }

  configureCategory(name, limits = {}) { this.categoryLimits.set(String(name), { maxItems: nonNegative(limits.maxItems, 0), maxBytes: nonNegative(limits.maxBytes, 0) }); return this; }
  assert(input) { const lease = this.reserve(input); if (!lease.accepted) throw Object.assign(new Error(`Event resource admission rejected: ${lease.reason}`), { name: 'EventAdmissionError', code: lease.code, retryable: lease.retryable, details: lease }); return lease; }
  snapshot() {
    return deepFreeze({
      items: this.items, bytes: this.bytes, maxItems: this.maxItems, maxBytes: this.maxBytes,
      tenantMaxItems: this.tenantMaxItems, tenantMaxBytes: this.tenantMaxBytes,
      highWaterItems: this.highWaterItems, highWaterBytes: this.highWaterBytes,
      categories: Object.fromEntries([...this.categories].map(([key, value]) => [key, { ...value, limits: { ...(this.categoryLimits.get(key) || {}) } }])),
      tenants: Object.fromEntries([...this.tenants].map(([key, value]) => [key, { ...value }])),
      activeLeases: this.records.size, stats: { ...this.stats },
    });
  }
  close() { this.records.clear(); this.categories.clear(); this.tenants.clear(); this.items = 0; this.bytes = 0; }
}

function nonNegative(value, fallback) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : fallback; }
function decrement(map, key, record) { const usage = map.get(key); if (!usage) return; usage.items = Math.max(0, usage.items - record.items); usage.bytes = Math.max(0, usage.bytes - record.bytes); if (!usage.items && !usage.bytes) map.delete(key); }
export default EventResourceGovernor;
