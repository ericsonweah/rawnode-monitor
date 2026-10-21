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
    this.started = false;
    this.closed = false;
    this.stats = { published: 0, received: 0, rejected: 0, errors: 0 };
  }

  async start() {
    if (this.started || this.closed) return this;
    if (typeof this.redis.subscribe !== 'function') throw new TypeError('Redis client does not expose subscribe().');
    const handler = (message) => this._receive(message);
    const subscription = await this.redis.subscribe(this.channel, handler, { serial: true });
    this.subscription = subscription || { unsubscribe: () => this.redis.unsubscribe?.(this.channel, handler) };
    await this.subscription?.ready?.();
    this.started = true; this.emit('started', this.snapshot()); return this;
  }

  _receive(message) {
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
  async close() { if (this.closed) return; this.closed = true; this.started = false; try { await this.subscription?.unsubscribe?.(); } catch {} this.subscription = null; this.removeAllListeners(); }
}
export default RedisMonitorBridge;
