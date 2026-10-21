'use strict';

import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { EventTransport } from '../../universal/transport/EventTransport.js';
import { EventDeliveryResult, EventDeliveryState } from '../../universal/delivery/EventDelivery.js';

function method(client, ...names) { for (const name of names) if (typeof client?.[name] === 'function') return client[name].bind(client); return null; }
function delay(ms, signal, unref = false) { return new Promise((resolve) => { const timer = setTimeout(resolve, ms); if (unref) timer.unref?.(); signal?.addEventListener?.('abort', () => { clearTimeout(timer); resolve(); }, { once: true }); }); }

export class RedisStreamsEventTransport extends EventTransport {
  constructor(client, options = {}) {
    super(options.id || 'redis-streams', { ...options, capabilities: { remote: true, ordered: true, orderedByPartition: true, acknowledged: true, durable: true, fanout: false, binary: false, requestReply: true, server: true, maxPacketBytes: Number(options.maxPacketBytes) || 1024 * 1024, ...(options.capabilities || {}) } });
    if (!client) throw new TypeError('RedisStreamsEventTransport requires a Redis client.');
    this.client = client;
    this.stream = options.stream || 'rawnode:events:v3';
    this.deadLetterStream = options.deadLetterStream || `${this.stream}:dead`;
    this.group = options.group || 'rawnode-events';
    this.consumer = options.consumer || `${process.pid}-${randomUUID()}`;
    this.maxLength = Math.max(100, Number(options.maxLength) || 100_000);
    this.maxAttempts = Math.max(1, Number(options.maxAttempts) || 5);
    this.blockMs = Math.max(0, Number(options.blockMs) || 5_000);
    this.batchSize = Math.max(1, Number(options.batchSize) || 100);
    this.pollErrorDelayMs = Math.max(10, Number(options.pollErrorDelayMs) || 250);
    this.autoConsume = options.autoConsume !== false;
    this.unrefTimers = options.unrefTimers === true;
    this.receivers = new Set();
    this.controller = null;
    this.loop = null;
  }
  async ensureGroup() {
    const fn = method(this.client, 'xgroup', 'xGroup');
    if (!fn) throw Object.assign(new Error('Redis client does not expose XGROUP.'), { code: 'EVENT_REDIS_XGROUP_MISSING' });
    try { await fn('CREATE', this.stream, this.group, '0', 'MKSTREAM'); }
    catch (error) { if (!/BUSYGROUP/i.test(error?.message || '')) throw error; }
  }
  async start() {
    if (this.state === 'started') return this;
    await this.ensureGroup();
    await super.start();
    if (this.autoConsume && !this.loop) {
      this.controller = new AbortController();
      this.loop = this._consume(this.controller.signal).finally(() => { this.loop = null; });
    }
    return this;
  }
  subscribe(receiver) { if (typeof receiver !== 'function') throw new TypeError('Redis Streams receiver must be a function.'); this.receivers.add(receiver); return () => this.receivers.delete(receiver); }
  async publish(envelope) {
    await this.start();
    const fn = method(this.client, 'xadd', 'xAdd');
    if (!fn) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_REDIS_XADD_MISSING', reason: 'xadd-missing' });
    const raw = envelope.encode?.() || JSON.stringify(envelope);
    const bytes = Buffer.byteLength(raw);
    if (this.capabilities().maxPacketBytes > 0 && bytes > this.capabilities().maxPacketBytes) return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE', reason: 'packet-too-large' });
    try {
      const id = await fn(this.stream, 'MAXLEN', '~', this.maxLength, '*', 'id', String(envelope.id), 'envelope', raw, 'attempt', String(envelope.delivery?.attempt || 1), 'createdAt', String(Date.now()));
      this.stats.published++; this.stats.bytesOut += bytes;
      return EventDeliveryResult.accepted({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.PERSISTED, persisted: true, acknowledged: true, value: { id, stream: this.stream } });
    } catch (error) { this._error(error); return EventDeliveryResult.rejected({ transport: this.id, eventId: envelope.id, state: EventDeliveryState.OUTCOME_UNKNOWN, code: error.code || 'EVENT_REDIS_STREAM_PUBLISH_FAILED', reason: error.message, retryable: true, error }); }
  }
  async _consume(signal) {
    while (!signal.aborted) {
      try {
        const messages = await this.read();
        for (const message of messages) await this._handle(message);
      } catch (error) {
        if (signal.aborted) break;
        this._error(error);
        this.state = 'started';
        await delay(this.pollErrorDelayMs, signal, this.unrefTimers);
      }
    }
  }
  async read(options = {}) {
    const fn = method(this.client, 'xreadgroup', 'xReadGroup');
    if (!fn) throw Object.assign(new Error('Redis client does not expose XREADGROUP.'), { code: 'EVENT_REDIS_XREADGROUP_MISSING' });
    const result = await fn('GROUP', this.group, this.consumer, 'COUNT', options.count || this.batchSize, 'BLOCK', options.blockMs ?? this.blockMs, 'STREAMS', this.stream, '>');
    return normalize(result);
  }
  async _handle(message) {
    const raw = message.fields.envelope || message.fields.payload;
    try {
      if (Buffer.byteLength(String(raw || '')) > this.capabilities().maxPacketBytes) throw Object.assign(new Error('Redis event envelope exceeds maximum bytes.'), { code: 'EVENT_TRANSPORT_PACKET_TOO_LARGE' });
      const envelope = JSON.parse(String(raw));
      for (const receiver of this.receivers) await receiver(envelope, { transport: this, remote: true, stream: this.stream, messageId: message.id });
      await this.ack(message.id);
      this.stats.received++; this.stats.bytesIn += Buffer.byteLength(String(raw));
    } catch (error) { await this.fail(message, error); }
  }
  async ack(...ids) { const fn = method(this.client, 'xack', 'xAck'); if (!fn || !ids.flat().length) return 0; return Number(await fn(this.stream, this.group, ...ids.flat())) || 0; }
  async fail(message, error) {
    const attempt = Math.max(1, Number(message.fields.attempt) || 1) + 1;
    if (attempt >= this.maxAttempts) { await this.deadLetter(message, error); await this.ack(message.id); return { deadLettered: true, attempt }; }
    const fn = method(this.client, 'xadd', 'xAdd');
    if (fn) await fn(this.stream, 'MAXLEN', '~', this.maxLength, '*', 'id', String(message.fields.id || randomUUID()), 'envelope', String(message.fields.envelope || ''), 'attempt', String(attempt), 'createdAt', String(Date.now()));
    await this.ack(message.id);
    return { retry: true, attempt };
  }
  async deadLetter(message, error) { const fn = method(this.client, 'xadd', 'xAdd'); if (fn) await fn(this.deadLetterStream, 'MAXLEN', '~', this.maxLength, '*', 'sourceId', String(message.id), 'envelope', String(message.fields.envelope || ''), 'error', String(error?.stack || error?.message || error), 'failedAt', String(Date.now())); }
  async close() { this.controller?.abort(); if (this.loop) await this.loop; this.controller = null; this.receivers.clear(); return super.close(); }
}
function normalize(result) {
  if (!Array.isArray(result)) return [];
  const output = [];
  for (const stream of result) {
    const entries = Array.isArray(stream) ? stream[1] : stream?.messages || [];
    for (const entry of entries || []) {
      const id = Array.isArray(entry) ? entry[0] : entry.id;
      const raw = Array.isArray(entry) ? entry[1] : entry.message || entry.fields;
      const fields = {};
      if (Array.isArray(raw)) for (let index = 0; index < raw.length; index += 2) fields[String(raw[index])] = raw[index + 1];
      else Object.assign(fields, raw || {});
      output.push({ id, fields });
    }
  }
  return output;
}
export default RedisStreamsEventTransport;
