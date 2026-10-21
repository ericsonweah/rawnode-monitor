'use strict';

/** Bounded per-client token bucket used by the Monitor Studio/API. */
export class MonitorStudioRateLimiter {
  constructor(options = {}) {
    this.capacity = Math.max(1, Number(options.capacity ?? options.max) || 300);
    this.windowMs = Math.max(1_000, Number(options.windowMs) || 60_000);
    this.refillPerSecond = Math.max(0.001, Number(options.refillPerSecond) || this.capacity / (this.windowMs / 1_000));
    this.maxKeys = Math.max(1, Number(options.maxKeys ?? options.maxClients) || 10_000);
    this.idleTtlMs = Math.max(this.windowMs, Number(options.idleTtlMs) || this.windowMs * 5);
    this.buckets = new Map();
    this.stats = { allowed: 0, rejected: 0, pruned: 0, evicted: 0 };
  }

  consume(key, cost = 1, now = Date.now()) {
    this.prune(now);
    const id = String(key || 'anonymous');
    const amount = Math.max(0, Number(cost) || 0);
    let bucket = this.buckets.get(id);
    if (!bucket) bucket = { tokens: this.capacity, updatedAt: now, lastSeenAt: now };
    this._refill(bucket, now);
    bucket.lastSeenAt = now;

    if (amount > bucket.tokens) {
      const deficit = amount - bucket.tokens;
      const retryAfterMs = Math.ceil((deficit / this.refillPerSecond) * 1_000);
      this.stats.rejected++;
      this.buckets.set(id, bucket);
      return Object.freeze({ ok: false, remaining: Math.floor(bucket.tokens), retryAfterMs, resetAt: now + retryAfterMs });
    }

    bucket.tokens -= amount;
    this.buckets.set(id, bucket);
    this.stats.allowed++;
    if (this.buckets.size > this.maxKeys) this._evictOldest();
    return Object.freeze({ ok: true, remaining: Math.floor(bucket.tokens), resetAt: now + Math.ceil(((this.capacity - bucket.tokens) / this.refillPerSecond) * 1_000) });
  }

  _refill(bucket, now) {
    const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1_000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    bucket.updatedAt = now;
  }

  _evictOldest() {
    let oldestKey = null;
    let oldest = Infinity;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeenAt < oldest) { oldest = bucket.lastSeenAt; oldestKey = key; }
    }
    if (oldestKey != null) { this.buckets.delete(oldestKey); this.stats.evicted++; }
  }

  prune(now = Date.now()) {
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastSeenAt >= this.idleTtlMs) { this.buckets.delete(key); removed++; }
    }
    this.stats.pruned += removed;
    return removed;
  }

  snapshot() {
    return Object.freeze({
      capacity: this.capacity,
      refillPerSecond: this.refillPerSecond,
      maxKeys: this.maxKeys,
      keys: this.buckets.size,
      stats: Object.freeze({ ...this.stats }),
    });
  }
}
export default MonitorStudioRateLimiter;
