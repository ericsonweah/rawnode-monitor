'use strict';

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import { SafeJsonCodec } from '../serialization/SafeJsonCodec.js';
import { createEventEnvelope, validateEventEnvelope } from '../serialization/EventEnvelope.js';
import { EventTransportError } from '../errors/EventError.js';

function method(client, ...names) {
  for (const name of names) if (typeof client?.[name] === 'function') return client[name].bind(client);
  return null;
}

function sleep(ms, unref = false) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, Number(ms) || 0));
    if (unref) timer.unref?.();
  });
}

export class RedisStreamTransport extends EventEmitter {
  constructor(client, options = {}) {
    super();
    if (!client) throw new TypeError('Redis client is required');
    this.client = client;
    this.stream = options.stream || 'rawnode:events:durable';
    this.deadLetterStream = options.deadLetterStream || `${this.stream}:dead`;
    this.group = options.group || 'rawnode-events';
    this.consumer = options.consumer || `${process.pid}-${randomUUID()}`;
    this.nodeId = options.nodeId || this.consumer;
    this.namespace = options.namespace || 'default';
    this.maxLength = Math.max(100, Number(options.maxLength) || 100_000);
    this.maxBytes = Math.max(1024, Number(options.maxBytes) || 1024 * 1024);
    this.maxAttempts = Math.max(1, Number(options.maxAttempts) || 5);
    this.blockMs = Math.max(0, Number(options.blockMs) || 5000);
    this.batchSize = Math.max(1, Number(options.batchSize) || 100);
    this.retryDelayMs = Math.max(0, Number(options.retryDelayMs) || 250);
    this.pollErrorDelayMs = Math.max(10, Number(options.pollErrorDelayMs) || 250);
    this.claimIdleMs = Math.max(1000, Number(options.claimIdleMs) || 30_000);
    this.claimCount = Math.max(1, Number(options.claimCount) || this.batchSize);
    this.secret = options.secret || null;
    this.acceptUnsignedV1 = options.acceptUnsignedV1 !== false;
    this.maxAgeMs = Math.max(0, Number(options.maxAgeMs) || 0);
    this.unrefTimers = options.unrefTimers === true;
    this.codec = options.codec || new SafeJsonCodec({ maxBytes: this.maxBytes });
    this.state = 'idle';
    this._controller = null;
    this._loopPromise = null;
    this._handler = null;
    this.stats = {
      published: 0,
      publishBytes: 0,
      read: 0,
      decoded: 0,
      handled: 0,
      acked: 0,
      retried: 0,
      claimed: 0,
      deadLettered: 0,
      expired: 0,
      invalid: 0,
      handlerErrors: 0,
      pollErrors: 0,
    };
  }

  async ensureGroup() {
    const fn = method(this.client, 'xgroup', 'xGroup');
    if (!fn) throw new EventTransportError('Redis client does not expose XGROUP', { code: 'EVENT_STREAM_XGROUP_MISSING' });
    try {
      await fn('CREATE', this.stream, this.group, '0', 'MKSTREAM');
      return true;
    } catch (error) {
      if (/BUSYGROUP/i.test(error?.message || '')) return true;
      throw error;
    }
  }

  async publish(eventName, args = [], options = {}) {
    const envelope = createEventEnvelope(eventName, args, {
      ...options,
      nodeId: options.nodeId || this.nodeId,
      namespace: options.namespace || this.namespace,
      secret: options.secret || this.secret,
    });
    return this.publishEnvelope(envelope, options);
  }

  async publishEnvelope(envelope, options = {}) {
    const fn = method(this.client, 'xadd', 'xAdd');
    if (!fn) throw new EventTransportError('Redis client does not expose XADD', { code: 'EVENT_STREAM_XADD_MISSING' });
    const encoded = this.codec.encode(envelope, { maxBytes: this.maxBytes });
    const attempt = Math.max(0, Number(options.attempt) || 0);
    const availableAt = Math.max(0, Number(options.availableAt) || 0);
    const id = await fn(
      this.stream, 'MAXLEN', '~', this.maxLength, '*',
      'id', String(envelope.id || randomUUID()),
      'envelope', encoded.text,
      'attempt', String(attempt),
      'createdAt', String(envelope.ts || Date.now()),
      'availableAt', String(availableAt),
    );
    this.stats.published++;
    this.stats.publishBytes += encoded.bytes;
    return { id, envelopeId: envelope.id, persisted: true, stream: this.stream, attempt };
  }

  async read(options = {}) {
    const fn = method(this.client, 'xreadgroup', 'xReadGroup');
    if (!fn) throw new EventTransportError('Redis client does not expose XREADGROUP', { code: 'EVENT_STREAM_XREADGROUP_MISSING' });
    const result = await fn(
      'GROUP', this.group, this.consumer,
      'COUNT', options.count || this.batchSize,
      'BLOCK', options.blockMs ?? this.blockMs,
      'STREAMS', this.stream, options.id || '>',
    );
    const messages = this._normalize(result);
    this.stats.read += messages.length;
    return messages;
  }

  decode(message, options = {}) {
    try {
      const raw = message?.fields?.envelope || message?.fields?.payload || '';
      if (Buffer.byteLength(String(raw)) > this.maxBytes) {
        this.stats.invalid++;
        return { ok: false, reason: 'maxBytes', code: 'EVENT_STREAM_MAX_BYTES', message };
      }
      const envelope = this.codec.parse(raw);
      const validation = validateEventEnvelope(envelope, {
        namespace: options.namespace || this.namespace,
        secret: options.secret || this.secret,
        acceptUnsignedV1: options.acceptUnsignedV1 ?? this.acceptUnsignedV1,
        maxAgeMs: options.maxAgeMs ?? this.maxAgeMs,
      });
      if (!validation.ok) {
        if (validation.code === 'EVENT_ENVELOPE_EXPIRED') this.stats.expired++;
        else this.stats.invalid++;
        return { ...validation, message };
      }
      this.stats.decoded++;
      return { ok: true, envelope: validation.envelope, message };
    } catch (error) {
      this.stats.invalid++;
      return { ok: false, error, reason: error.message, message };
    }
  }

  async ack(...ids) {
    const values = ids.flat().filter(Boolean);
    if (!values.length) return 0;
    const fn = method(this.client, 'xack', 'xAck');
    if (!fn) return 0;
    const count = Number(await fn(this.stream, this.group, ...values)) || 0;
    this.stats.acked += count;
    return count;
  }

  async fail(message, error, options = {}) {
    const attempt = Number(message?.fields?.attempt || 0) + 1;
    if (attempt >= this.maxAttempts || options.deadLetter === true) {
      await this.deadLetter(message, error);
      await this.ack(message.id);
      return { deadLettered: true, attempt };
    }

    let envelope;
    try { envelope = this.codec.parse(message?.fields?.envelope || ''); }
    catch { envelope = null; }
    if (!envelope) {
      await this.deadLetter(message, error);
      await this.ack(message.id);
      return { deadLettered: true, attempt, invalid: true };
    }

    if (this.retryDelayMs > 0) await sleep(this.retryDelayMs, this.unrefTimers);
    const published = await this.publishEnvelope(envelope, { attempt });
    await this.ack(message.id);
    this.stats.retried++;
    return { retry: true, attempt, published };
  }

  async deadLetter(message, error) {
    const fn = method(this.client, 'xadd', 'xAdd');
    if (!fn) throw new EventTransportError('Redis client does not expose XADD', { code: 'EVENT_STREAM_XADD_MISSING' });
    await fn(
      this.deadLetterStream, 'MAXLEN', '~', this.maxLength, '*',
      'sourceId', String(message?.id || ''),
      'envelope', String(message?.fields?.envelope || ''),
      'attempt', String(message?.fields?.attempt || '0'),
      'error', String(error?.stack || error?.message || error || ''),
      'failedAt', String(Date.now()),
    );
    this.stats.deadLettered++;
    return true;
  }

  async recoverPending(options = {}) {
    const fn = method(this.client, 'xautoclaim', 'xAutoClaim');
    if (!fn) return [];
    const result = await fn(
      this.stream,
      this.group,
      this.consumer,
      options.minIdleMs || this.claimIdleMs,
      options.start || '0-0',
      'COUNT', options.count || this.claimCount,
    );
    // Redis variants return [nextId, entries, deletedIds] or an object.
    const entries = Array.isArray(result) ? result[1] : result?.messages || result?.entries || [];
    const normalized = this._normalize([[this.stream, entries]]);
    this.stats.claimed += normalized.length;
    return normalized;
  }

  async consumeOnce(handler = this._handler, options = {}) {
    if (typeof handler !== 'function') throw new TypeError('RedisStreamTransport.consumeOnce expects a handler function');
    const recovered = options.recover === false ? [] : await this.recoverPending(options).catch(() => []);
    const messages = recovered.length ? recovered : await this.read(options);
    const results = [];
    for (const message of messages) {
      const availableAt = Number(message.fields.availableAt || 0);
      if (availableAt > Date.now()) {
        results.push({ message, deferred: true });
        continue;
      }
      const decoded = this.decode(message, options);
      if (!decoded.ok) {
        await this.deadLetter(message, decoded.error || new Error(decoded.reason || 'Invalid event envelope'));
        await this.ack(message.id);
        results.push({ message, ok: false, invalid: true, reason: decoded.reason });
        continue;
      }
      try {
        const value = await handler(decoded.envelope, message, this);
        await this.ack(message.id);
        this.stats.handled++;
        results.push({ message, envelope: decoded.envelope, ok: true, value });
      } catch (error) {
        this.stats.handlerErrors++;
        const retry = await this.fail(message, error);
        results.push({ message, envelope: decoded.envelope, ok: false, error, ...retry });
      }
    }
    return results;
  }

  async start(handler, options = {}) {
    if (this.state === 'running') return this;
    if (this.state === 'closed') throw new EventTransportError('Redis stream transport is closed', { code: 'EVENT_STREAM_CLOSED' });
    if (typeof handler !== 'function') throw new TypeError('RedisStreamTransport.start expects a handler function');
    this._handler = handler;
    await this.ensureGroup();
    this.state = 'running';
    this._controller = new AbortController();
    this._loopPromise = this._consumeLoop(options).finally(() => {
      if (this.state !== 'closed') this.state = 'stopped';
      this._loopPromise = null;
    });
    this.emit('started', this.snapshot());
    return this;
  }

  async _consumeLoop(options) {
    while (!this._controller.signal.aborted) {
      try {
        const results = await this.consumeOnce(this._handler, options);
        if (results.length) this.emit('batch', results);
      } catch (error) {
        if (this._controller.signal.aborted) break;
        this.stats.pollErrors++;
        if (this.listenerCount('error')) this.emit('error', error);
        else this.emit('transportError', error);
        await sleep(this.pollErrorDelayMs, this.unrefTimers);
      }
    }
  }

  async stop() {
    if (!this._loopPromise) {
      if (this.state !== 'closed') this.state = 'stopped';
      return this.snapshot();
    }
    this.state = 'stopping';
    this._controller?.abort();
    await this._loopPromise;
    this.state = 'stopped';
    this.emit('stopped', this.snapshot());
    return this.snapshot();
  }

  async close() {
    if (this.state === 'closed') return this.snapshot();
    await this.stop();
    this.state = 'closed';
    this.removeAllListeners();
    return this.snapshot();
  }

  _normalize(result) {
    if (!Array.isArray(result)) return [];
    const output = [];
    for (const stream of result) {
      const entries = Array.isArray(stream) ? stream[1] : stream?.messages || [];
      for (const entry of entries || []) {
        const id = Array.isArray(entry) ? entry[0] : entry.id;
        const raw = Array.isArray(entry) ? entry[1] : entry.message || entry.fields;
        const fields = {};
        if (Array.isArray(raw)) {
          for (let index = 0; index < raw.length; index += 2) fields[String(raw[index])] = raw[index + 1];
        } else Object.assign(fields, raw || {});
        output.push({ id, fields });
      }
    }
    return output;
  }

  snapshot() {
    return Object.freeze({
      state: this.state,
      stream: this.stream,
      deadLetterStream: this.deadLetterStream,
      group: this.group,
      consumer: this.consumer,
      namespace: this.namespace,
      limits: Object.freeze({ maxLength: this.maxLength, maxBytes: this.maxBytes, maxAttempts: this.maxAttempts }),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  async [Symbol.asyncDispose]() { await this.close(); }
}

export default RedisStreamTransport;
