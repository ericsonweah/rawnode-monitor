'use strict';

import { randomUUID } from 'node:crypto';

const LOCAL = new Map();

/** Distributed leadership lease. Redis is optional; local leases support single-process mode. */
export class LeaderLease {
  constructor(options = {}) {
    this.redis = options.redis || null;
    this.key = options.key || 'rawnode:monitor:leader';
    this.owner = options.owner || `${process.pid}-${randomUUID()}`;
    this.ttlMs = Math.max(2_000, Number(options.ttlMs) || 30_000);
    this.renewEveryMs = Math.max(500, Number(options.renewEveryMs) || Math.floor(this.ttlMs / 3));
    this.timer = null;
    this.held = false;
    this.closed = false;
    this.fencingToken = null;
    this.stats = { acquired: 0, renewed: 0, released: 0, lost: 0, errors: 0 };
  }

  async acquire() {
    if (this.closed) return false;
    try {
      if (this.redis) return await this._acquireRedis();
      const now = Date.now(); const current = LOCAL.get(this.key);
      if (current && current.expiresAt > now && current.owner !== this.owner) return false;
      const fence = (current?.fence || 0) + 1;
      LOCAL.set(this.key, { owner: this.owner, expiresAt: now + this.ttlMs, fence });
      this.fencingToken = fence; this.held = true; this.stats.acquired++; this._schedule(); return true;
    } catch (error) { this.stats.errors++; throw error; }
  }

  async _acquireRedis() {
    const send = command(this.redis);
    if (!send) throw new TypeError('LeaderLease Redis client must expose sendCommand().');
    const fenceKey = `${this.key}:fence`;
    const script = "if redis.call('SET',KEYS[1],ARGV[1],'NX','PX',ARGV[2]) then return redis.call('INCR',KEYS[2]) else return 0 end";
    const result = Number(await send(['EVAL', script, 2, this.key, fenceKey, this.owner, String(this.ttlMs)]));
    if (result <= 0) return false;
    this.fencingToken = result; this.held = true; this.stats.acquired++; this._schedule(); return true;
  }

  _schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.renew().catch(() => this._lost()); }, this.renewEveryMs);
    this.timer.unref?.();
  }

  async renew() {
    if (!this.held || this.closed) return false;
    let ok = false;
    try {
      if (this.redis) {
        const send = command(this.redis);
        const script = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end";
        ok = Number(await send(['EVAL', script, 1, this.key, this.owner, String(this.ttlMs)])) === 1;
      } else {
        const current = LOCAL.get(this.key);
        ok = current?.owner === this.owner;
        if (ok) current.expiresAt = Date.now() + this.ttlMs;
      }
      if (!ok) return this._lost();
      this.stats.renewed++; this._schedule(); return true;
    } catch (error) { this.stats.errors++; this._lost(); throw error; }
  }

  _lost() { clearTimeout(this.timer); this.timer = null; if (this.held) this.stats.lost++; this.held = false; return false; }

  async release() {
    clearTimeout(this.timer); this.timer = null;
    if (!this.held) return false;
    let released = false;
    try {
      if (this.redis) {
        const send = command(this.redis);
        const script = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
        released = Number(await send(['EVAL', script, 1, this.key, this.owner])) === 1;
      } else {
        const current = LOCAL.get(this.key);
        released = current?.owner === this.owner;
        if (released) LOCAL.delete(this.key);
      }
    } finally { this.held = false; if (released) this.stats.released++; }
    return released;
  }

  isLeader() { return this.held; }
  snapshot() { return Object.freeze({ key: this.key, owner: this.owner, held: this.held, fencingToken: this.fencingToken, ttlMs: this.ttlMs, stats: Object.freeze({ ...this.stats }) }); }
  async close() { await this.release().catch(() => {}); this.closed = true; }
}
function command(redis) { return typeof redis?.sendCommand === 'function' ? redis.sendCommand.bind(redis) : null; }
export default LeaderLease;
