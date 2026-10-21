'use strict';

import { EventEmitter } from 'node:events';
import { createMonitorClusterEnvelope, verifyMonitorClusterEnvelope } from './MonitorClusterEnvelope.js';

/** Optional Redis pub/sub bridge for fleet heartbeats and remote telemetry. */
export class RedisMonitorBridge extends EventEmitter {
  constructor(redis, options = {}) {
    super();
    if (!redis) throw new TypeError('RedisMonitorBridge requires a Redis client.');
    this.redis = redis;
    this.channel = options.channel || 'rawnode:monitor:cluster';
    this.namespace = options.namespace || 'default';
    this.secret = options.secret || null;
    this.source = options.source || `${process.pid}`;
    this.maxBytes = Math.max(1_024, Number(options.maxBytes) || 2 * 1024 * 1024);
    this.subscription = null;
    this.startPromise = null;
    this.disposedSubscriptions = new WeakSet();
    this.started = false;
    this.closed = false;
    this.stats = { published: 0, received: 0, rejected: 0, errors: 0 };
  }

  async start() {
    if (this.started || this.closed) return this;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start();
    try { return await this.startPromise; }
    finally { this.startPromise = null; }
  }

  async _start() {
    if (typeof this.redis.subscribe !== 'function') throw new TypeError('Redis client does not expose subscribe().');
    const handler = (message) => this._receive(message);
    const result = await this.redis.subscribe(this.channel, handler, { serial: true });
    const subscription = result && typeof result === 'object' ? result : { unsubscribe: typeof result === 'function' ? result : () => this.redis.unsubscribe?.(this.channel, handler) };
    if (this.closed) { await this._disposeSubscription(subscription); return this; }
    this.subscription = subscription;
    try { await subscription.ready?.(); }
    catch (error) { await this._disposeSubscription(subscription); throw error; }
    if (this.closed) { await this._disposeSubscription(subscription); return this; }
    this.started = true; this.emit('started', this.snapshot()); return this;
  }

  async _disposeSubscription(subscription) {
    if (this.subscription === subscription) this.subscription = null;
    if (!subscription || this.disposedSubscriptions.has(subscription)) return;
    this.disposedSubscriptions.add(subscription);
    try { await subscription.unsubscribe?.(); } catch {}
  }

  _receive(message) {
    if (this.closed) return false;
    try {
      const text = Buffer.isBuffer(message) || message instanceof Uint8Array ? Buffer.from(message).toString('utf8') : String(message);
      if (Buffer.byteLength(text) > this.maxBytes) { this.stats.rejected++; return false; }
      const parsed = JSON.parse(text);
      const result = verifyMonitorClusterEnvelope(parsed, { namespace: this.namespace, secret: this.secret });
      if (!result.ok || result.envelope.source === this.source) { if (!result.ok) this.stats.rejected++; return false; }
      this.stats.received++;
      this.emit(result.envelope.type, result.envelope.payload, result.envelope);
      this.emit('message', result.envelope);
      return true;
    } catch (error) { this.stats.errors++; this.emit('bridgeError', error); return false; }
  }

  async publish(type, payload, options = {}) {
    if (this.closed) return false;
    const envelope = createMonitorClusterEnvelope(type, payload, { ...options, namespace: this.namespace, secret: this.secret, source: this.source, maxBytes: this.maxBytes });
    await this.redis.publish(this.channel, JSON.stringify(envelope));
    this.stats.published++; return envelope;
  }

  snapshot() { return Object.freeze({ started: this.started, closed: this.closed, channel: this.channel, namespace: this.namespace, stats: Object.freeze({ ...this.stats }) }); }
  async close() { if (this.closed) return; this.closed = true; this.started = false; await this._disposeSubscription(this.subscription); this.removeAllListeners(); }
}
export default RedisMonitorBridge;
