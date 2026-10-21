'use strict';

// src/events/RedisEventBridge.js
// Compatibility-preserving, bounded, lifecycle-safe Redis event bridge.

import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

import { BridgeStateMachine } from './bridge/BridgeStateMachine.js';
import { PublishQueue } from './bridge/PublishQueue.js';
import { SeenMessageWindow } from './bridge/SeenMessageWindow.js';
import {
  createEventEnvelope,
  signEventEnvelope,
  validateEventEnvelope,
} from './serialization/EventEnvelope.js';
import { SafeJsonCodec } from './serialization/SafeJsonCodec.js';
import { compileMatcherList, matchesAny } from './support/glob.js';
import { shallowEventContext } from './context/EventContext.js';
import { createLogger } from './support/logger.js';
import { deferred, isPromiseLike, timeoutError } from './support/async.js';
import { EventTransportError } from './errors/EventError.js';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeResolve(app, key, fallback = null) {
  try {
    const value = app?.resolve?.(key);
    return value === undefined ? fallback : value;
  } catch { return fallback; }
}

function configGet(config, path, fallback = undefined) {
  try {
    if (config && typeof config.get === 'function') {
      const value = config.get(path);
      return value === undefined ? fallback : value;
    }
  } catch {}
  return fallback;
}

function positive(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? Math.trunc(parsed) : fallback;
}

function nonNegative(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function boolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

async function withTimeout(value, timeoutMs, label) {
  if (!(timeoutMs > 0)) return await value;
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    if (error?.name === 'TimeoutError') error.message = `${label || 'Operation'} timed out after ${timeoutMs}ms`;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForReady(client, timeoutMs) {
  if (!client) throw new EventTransportError('Redis client is missing', { code: 'EVENT_BRIDGE_REDIS_CLIENT_MISSING' });
  if (client.isReady?.() === true || client.ready === true || client.status === 'ready') return client;

  if (typeof client.connectAsync === 'function') {
    await client.connectAsync({ timeoutMs });
    return client;
  }

  let result;
  try { result = client.connect?.(); }
  catch (error) {
    if (!/already (?:open|connect|connecting)|is already/i.test(error?.message || '')) throw error;
  }
  if (isPromiseLike(result)) await withTimeout(result, timeoutMs, 'Redis connection');
  if (client.isReady?.() === true || client.ready === true || client.status === 'ready') return client;
  if (typeof client.once !== 'function') return client;

  await withTimeout(new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      client.off?.('ready', onReady);
      client.off?.('error', onError);
      client.off?.('close', onClose);
    };
    const finish = (method, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      method(value);
    };
    const onReady = () => finish(resolve, client);
    const onError = (error) => finish(reject, error);
    const onClose = () => finish(reject, new EventTransportError('Redis connection closed before readiness', { code: 'EVENT_BRIDGE_REDIS_CLOSED' }));
    client.once('ready', onReady);
    client.once('error', onError);
    client.once('close', onClose);
    if (client.isReady?.() === true || client.ready === true || client.status === 'ready') onReady();
  }), timeoutMs, 'Redis readiness');
  return client;
}

async function closeClient(client) {
  if (!client) return;
  for (const method of ['quit', 'close', 'disconnect', 'destroy']) {
    if (typeof client[method] !== 'function') continue;
    try { await client[method](); } catch {}
    return;
  }
}

function createLegacyEnvelope(eventName, args, options) {
  const now = Date.now();
  const envelope = {
    v: 1,
    id: options.id || `${options.nodeId}-${now.toString(36)}-${randomUUID()}`,
    node: options.nodeId,
    ts: now,
    expiresAt: options.ttlMs > 0 ? now + options.ttlMs : 0,
    hop: Math.max(0, Number(options.hop) || 0),
    namespace: options.namespace || 'default',
    event: String(eventName),
    args: Array.isArray(args) ? args : [args],
    ctx: options.context || null,
    headers: options.headers || null,
  };
  if (options.secret) envelope.signature = signEventEnvelope(envelope, options.secret);
  return envelope;
}

export class RedisEventBridge {
  constructor(app, options = {}) {
    this.app = app;
    this.options = isPlainObject(options) ? { ...options } : {};

    // Existing public fields remain available.
    this.enabled = false;
    this.redis = null;
    this.subscriber = null;
    this.channel = 'rawnode:events';
    this.nodeId = process.env.NODE_ID || `${hostname()}:${process.pid}`;
    this.allow = [];
    this.deny = [];

    this.required = false;
    this.namespace = 'default';
    this.stateMachine = new BridgeStateMachine();
    this._logger = createLogger(console);
    this._codec = new SafeJsonCodec();
    this._seen = new SeenMessageWindow();
    this._queue = new PublishQueue();
    this._dispatcher = null;
    this._publisherHandle = null;
    this._publisherOff = null;
    this._subscription = null;
    this._subscriptionHandler = null;
    this._publisherOwned = false;
    this._subscriberOwned = false;
    this._clientCleanups = [];
    this._suppress = 0;
    this._startPromise = null;
    this._stopPromise = null;
    this._drainPromise = null;
    this._retryTimer = null;
    this._config = null;
    this._closed = false;
    this._failureStreak = 0;
    this._circuitOpenUntil = 0;

    this.stats = {
      starts: 0,
      stops: 0,
      published: 0,
      publishBytes: 0,
      publishErrors: 0,
      publishRetries: 0,
      received: 0,
      receiveBytes: 0,
      dispatched: 0,
      selfIgnored: 0,
      duplicateIgnored: 0,
      policyIgnored: 0,
      remoteSuppressed: 0,
      malformed: 0,
      oversized: 0,
      expired: 0,
      signatureRejected: 0,
      namespaceRejected: 0,
      versionRejected: 0,
      dispatchErrors: 0,
      circuitOpened: 0,
    };

    // Additive aliases keep metrics readable and preserve names used by earlier
    // enterprise previews without duplicating mutable counters.
    Object.defineProperties(this.stats, {
      publishFailures: { enumerable: true, get: () => this.stats.publishErrors },
      duplicates: { enumerable: true, get: () => this.stats.duplicateIgnored },
      loopPrevented: { enumerable: true, get: () => this.stats.remoteSuppressed },
      policyRejected: { enumerable: true, get: () => this.stats.policyIgnored },
    });
  }

  get state() { return this.stateMachine.state; }
  get ready() { return this.state === 'ready'; }

  start(overrides = null) {
    if (this.ready) return Promise.resolve(this);
    if (this._startPromise) return this._startPromise;
    if (this._closed) return Promise.reject(new EventTransportError('Redis event bridge is closed', { code: 'EVENT_BRIDGE_CLOSED' }));

    const config = this._loadConfig(overrides);
    if (!config.enabled) {
      if (this.state === 'idle') this.stateMachine.transition('disabled');
      this.enabled = false;
      return Promise.resolve(this);
    }

    this._startPromise = this._start(config)
      .finally(() => { this._startPromise = null; });
    return this._startPromise;
  }

  async _start(config) {
    if (!['idle', 'disabled', 'stopped', 'failed'].includes(this.state)) {
      throw new EventTransportError(`Cannot start Redis event bridge from state ${this.state}`, { code: 'EVENT_BRIDGE_STATE' });
    }

    this.stateMachine.transition('starting');
    this._config = config;
    this.required = config.required;
    this.channel = config.channel;
    this.nodeId = config.nodeId;
    this.namespace = config.namespace;
    this.allow = compileMatcherList(config.allow);
    this.deny = compileMatcherList(config.deny);
    this._logger = createLogger(config.logger);
    this._codec = new SafeJsonCodec({
      ...config.codec,
      maxBytes: config.limits.maxPacketBytes,
      redact: config.codec.redact !== false,
    });
    this._seen = new SeenMessageWindow(config.seen);
    this._queue = new PublishQueue(config.queue);
    this._failureStreak = 0;
    this._circuitOpenUntil = 0;

    try {
      this._dispatcher = config.dispatcher || safeResolve(this.app, 'events');
      if (!this._dispatcher) throw new EventTransportError('Events dispatcher not found', { code: 'EVENT_BRIDGE_DISPATCHER_MISSING' });

      const factory = await this._resolveClientFactory(config);
      this.redis = config.publisherClient || factory(config.redis || {});
      this.subscriber = config.subscriberClient || factory(config.redis || {});
      this._publisherOwned = !config.publisherClient;
      this._subscriberOwned = !config.subscriberClient;

      this._attachClientLifecycle(this.redis, 'publisher');
      if (this.subscriber !== this.redis) this._attachClientLifecycle(this.subscriber, 'subscriber');

      await Promise.all([
        waitForReady(this.redis, config.connectTimeoutMs),
        waitForReady(this.subscriber, config.connectTimeoutMs),
      ]);

      await this._subscribe();
      this._attachPublisher();
      this.stateMachine.transition('ready');
      this.enabled = true;
      this.stats.starts++;
      this._dispatcher.setBridge?.(this);
      this._diagnostic('ready', this.snapshot());
      this._logger.info(`[RedisEventBridge] ready on channel "${this.channel}" as node "${this.nodeId}"`);
      void this._drainQueue();
      return this;
    } catch (error) {
      await this._rollbackStart();
      this.enabled = false;
      this.stateMachine.transition('failed', error);
      this._diagnostic('start:error', { error, state: this.state });
      throw error;
    }
  }

  async _subscribe() {
    this._subscriptionHandler = (...values) => {
      let message = values[0];
      if (values.length > 1) {
        if (values[0] === this.channel) message = values[1];
        else if (values[1] === this.channel) message = values[0];
        else message = values.at(-1);
      }
      void this._onMessage(message);
    };
    const result = this.subscriber.subscribe(this.channel, this._subscriptionHandler, { serial: true });
    this._subscription = isPromiseLike(result) ? await result : result;
    await this._subscription?.ready?.();
  }

  _attachPublisher() {
    const dispatcher = this._dispatcher;
    const listener = (eventName, ...args) => this._publish(eventName, args);

    if (typeof dispatcher.subscribeAny === 'function') {
      this._publisherHandle = dispatcher.subscribeAny(listener, {
        priority: -1000,
        owner: 'rawnode:events:redis-bridge',
        tags: ['events.bridge', 'events.bridge.redis'],
      });
      return;
    }
    if (typeof dispatcher.onAny === 'function') {
      dispatcher.onAny(listener, { priority: -1000 });
      this._publisherOff = () => dispatcher.offAny?.(listener);
      return;
    }
    if (typeof dispatcher.on === 'function') {
      dispatcher.on('*', listener);
      this._publisherOff = () => dispatcher.off?.('*', listener);
      return;
    }
    throw new EventTransportError('Dispatcher does not support onAny/on', { code: 'EVENT_BRIDGE_DISPATCHER_API' });
  }

  _publish(eventName, args) {
    const result = this.publish(eventName, args);
    result?.promise?.catch?.((error) => {
      this._logger.error('[RedisEventBridge] publish failed', error);
    });
    return result;
  }

  publish(eventName, args = [], options = {}) {
    if (!this.enabled || !['ready', 'degraded'].includes(this.state)) {
      return { accepted: false, reason: 'not-ready', promise: Promise.resolve({ published: false, reason: 'not-ready' }) };
    }

    const name = String(eventName || '');
    if (!name || !this._allowed(name)) {
      this.stats.policyIgnored++;
      return { accepted: false, reason: 'policy', promise: Promise.resolve({ published: false, reason: 'policy' }) };
    }

    const dispatcher = this._dispatcher;
    const current = options.context || dispatcher?.getContext?.() || null;
    if (!this._config.rebridgeRemote && (this._suppress > 0 || current?.originTransport === 'redis' || current?.remote === true)) {
      this.stats.remoteSuppressed++;
      return { accepted: false, reason: 'remote-origin', promise: Promise.resolve({ published: false, reason: 'remote-origin' }) };
    }

    let envelope;
    let encoded;
    try {
      // Sanitize before signing so redaction, circular markers and unsupported
      // values are part of the authenticated wire representation. The envelope
      // canonicalizer recognizes these tagged values and their reconstructed
      // runtime equivalents identically on the receiving node.
      const safePayload = this._codec.sanitize({
        args: Array.isArray(args) ? args : [args],
        context: shallowEventContext(current),
        headers: options.headers && typeof options.headers === 'object' ? options.headers : null,
      }).value;

      const envelopeOptions = {
        id: options.id,
        nodeId: this.nodeId,
        namespace: this.namespace,
        context: safePayload.context,
        headers: safePayload.headers,
        ttlMs: options.ttlMs ?? this._config.protocol.ttlMs,
        hop: current?.hop || 0,
        secret: this._config.protocol.secret,
      };
      envelope = this._config.protocol.publishVersion === 1
        ? createLegacyEnvelope(name, safePayload.args, envelopeOptions)
        : createEventEnvelope(name, safePayload.args, envelopeOptions);

      encoded = this._codec.encode(envelope, { maxBytes: this._config.limits.maxPacketBytes });
    } catch (error) {
      this.stats.oversized += error?.code === 'EVENT_CODEC_MAX_BYTES' ? 1 : 0;
      this.stats.publishErrors++;
      this._diagnostic('publish:rejected', { eventName: name, error });
      const promise = Promise.reject(error);
      promise.catch(() => {});
      return { accepted: false, reason: error.code || 'encode', error, promise };
    }

    const completion = deferred();
    completion.promise.catch(() => {});
    const item = {
      envelope,
      json: encoded.text,
      bytes: encoded.bytes,
      attempts: 0,
      completion,
      onDrop: (reason) => completion.reject(new EventTransportError(`Redis event publish dropped: ${reason}`, {
        code: 'EVENT_BRIDGE_PUBLISH_DROPPED',
        details: { eventName: name, envelopeId: envelope.id, reason },
      })),
    };
    const admission = this._queue.push(item);
    if (!admission.accepted) {
      const error = new EventTransportError(`Redis event publish rejected: ${admission.reason}`, {
        code: 'EVENT_BRIDGE_QUEUE_REJECTED',
        details: { eventName: name, envelopeId: envelope.id, admission },
      });
      completion.reject(error);
      completion.promise.catch(() => {});
      this._diagnostic('publish:rejected', { eventName: name, envelopeId: envelope.id, admission });
      return { ...admission, envelopeId: envelope.id, promise: completion.promise };
    }

    void this._drainQueue();
    return { accepted: true, envelopeId: envelope.id, bytes: encoded.bytes, promise: completion.promise };
  }

  async _drainQueue() {
    if (this._drainPromise) return this._drainPromise;
    this._drainPromise = this._drainQueueLoop().finally(() => { this._drainPromise = null; });
    return this._drainPromise;
  }

  async _drainQueueLoop() {
    while (this.enabled && this._queue.length > 0) {
      const now = Date.now();
      if (now < this._circuitOpenUntil || this.state === 'degraded' && !this._clientReady(this.redis)) {
        this._scheduleRetry(Math.max(1, this._circuitOpenUntil - now || this._config.queue.retryDelayMs));
        return;
      }

      const item = this._queue.shift();
      if (!item) return;
      try {
        await withTimeout(this.redis.publish(this.channel, item.json), this._config.publishTimeoutMs, 'Redis publish');
        this._failureStreak = 0;
        this.stats.published++;
        this.stats.publishBytes += item.bytes;
        item.completion.resolve({ published: true, envelopeId: item.envelope.id, bytes: item.bytes });
        if (this.state === 'degraded' && this._clientReady(this.redis)) this._transitionReady();
      } catch (error) {
        this.stats.publishErrors++;
        this._failureStreak++;
        item.attempts++;
        if (item.attempts < this._config.queue.maxAttempts) {
          this.stats.publishRetries++;
          this._queue.unshift(item);
        } else {
          item.completion.reject(error);
          item.completion.promise.catch(() => {});
        }
        this._onPublishFailure(error);
        this._scheduleRetry(this._config.queue.retryDelayMs);
        return;
      }
    }
  }

  _onPublishFailure(error) {
    const circuit = this._config.circuit;
    if (this._failureStreak >= circuit.failureThreshold) {
      this._circuitOpenUntil = Date.now() + circuit.openMs;
      this.stats.circuitOpened++;
      this._transitionDegraded(error);
    }
    this._diagnostic('publish:error', { error, failureStreak: this._failureStreak, circuitOpenUntil: this._circuitOpenUntil });
  }

  _scheduleRetry(delayMs) {
    if (this._retryTimer || !this.enabled) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (Date.now() >= this._circuitOpenUntil && this._clientReady(this.redis)) this._transitionReady();
      void this._drainQueue();
    }, Math.max(1, Number(delayMs) || 1));
    this._retryTimer.unref?.();
  }

  async _onMessage(message) {
    if (!this.enabled || message == null) return false;
    const bytes = Buffer.isBuffer(message) || message instanceof Uint8Array
      ? message.byteLength
      : Buffer.byteLength(String(message));
    this.stats.receiveBytes += bytes;
    if (bytes > this._config.limits.maxPacketBytes) {
      this.stats.oversized++;
      this._diagnostic('receive:rejected', { reason: 'maxPacketBytes', bytes });
      return false;
    }

    let packet;
    try { packet = this._codec.parse(message); }
    catch (error) {
      this.stats.malformed++;
      this._diagnostic('receive:rejected', { reason: 'parse', error });
      return false;
    }

    const validation = validateEventEnvelope(packet, {
      acceptedVersions: this._config.protocol.acceptedVersions,
      namespace: this.namespace,
      secret: this._config.protocol.secret,
      acceptUnsignedV1: this._config.protocol.acceptUnsignedV1,
      maxAgeMs: this._config.protocol.maxAgeMs,
      maxClockSkewMs: this._config.protocol.maxClockSkewMs,
      maxHops: this._config.protocol.maxHops,
      maxArgs: this._config.limits.maxArgs,
      maxEventNameBytes: this._config.limits.maxEventNameBytes,
    });
    if (!validation.ok) {
      this._recordValidationFailure(validation.code);
      this._diagnostic('receive:rejected', validation);
      return false;
    }

    const envelope = validation.envelope;
    if (envelope.node === this.nodeId) { this.stats.selfIgnored++; return false; }
    if (this._seen.has(envelope.id)) { this.stats.duplicateIgnored++; return false; }
    this._seen.remember(envelope.id);
    if (!this._allowed(envelope.event)) { this.stats.policyIgnored++; return false; }

    const dispatcher = this._dispatcher || safeResolve(this.app, 'events');
    if (!dispatcher) return false;
    const incoming = isPlainObject(envelope.ctx) ? envelope.ctx : {};
    const context = typeof dispatcher.createContext === 'function'
      ? dispatcher.createContext({
          ...incoming,
          parentId: incoming.parentId ?? incoming.id ?? null,
          correlationId: incoming.correlationId ?? incoming.id ?? envelope.id,
          causationId: incoming.causationId ?? incoming.id ?? envelope.id,
          transport: incoming.transport || 'redis',
          remote: true,
          originTransport: 'redis',
          originNode: envelope.node,
          envelopeId: envelope.id,
          hop: (Number(envelope.hop) || 0) + 1,
        })
      : {
          ...incoming,
          remote: true,
          originTransport: 'redis',
          originNode: envelope.node,
          envelopeId: envelope.id,
          hop: (Number(envelope.hop) || 0) + 1,
        };

    this.stats.received++;
    this._suppress++;
    try {
      const invoke = () => dispatcher.dispatch(envelope.event, ...envelope.args);
      if (context && typeof dispatcher.run === 'function') dispatcher.run(context, invoke);
      else invoke();
      this.stats.dispatched++;
      this._diagnostic('receive:dispatch', { envelopeId: envelope.id, eventName: envelope.event, originNode: envelope.node });
      return true;
    } catch (error) {
      this.stats.dispatchErrors++;
      this._diagnostic('receive:dispatch-error', { error, envelopeId: envelope.id, eventName: envelope.event });
      return false;
    } finally {
      this._suppress = Math.max(0, this._suppress - 1);
    }
  }

  _recordValidationFailure(code) {
    if (code === 'EVENT_ENVELOPE_EXPIRED') this.stats.expired++;
    else if (code === 'EVENT_ENVELOPE_SIGNATURE') this.stats.signatureRejected++;
    else if (code === 'EVENT_ENVELOPE_NAMESPACE') this.stats.namespaceRejected++;
    else if (code === 'EVENT_ENVELOPE_VERSION') this.stats.versionRejected++;
    else this.stats.malformed++;
  }

  _allowed(eventName) {
    if (this.allow.length && !matchesAny(this.allow, eventName)) return false;
    if (this.deny.length && matchesAny(this.deny, eventName)) return false;
    return true;
  }

  _attachClientLifecycle(client, role) {
    if (!client || typeof client.on !== 'function') return;
    const onReady = () => {
      if (this.enabled || this.state === 'degraded') this._transitionReady();
      void this._drainQueue();
    };
    const onError = (error) => {
      this._logger.error(`[RedisEventBridge] ${role} error`, error);
      if (this.state === 'ready') this._transitionDegraded(error);
      this._diagnostic('client:error', { role, error });
    };
    const onClose = () => {
      if (this.state === 'ready') this._transitionDegraded(new EventTransportError(`${role} connection closed`, { code: 'EVENT_BRIDGE_REDIS_CLOSED' }));
      this._diagnostic('client:close', { role });
    };
    client.on('ready', onReady);
    client.on('error', onError);
    client.on('close', onClose);
    client.on('end', onClose);
    this._clientCleanups.push(() => {
      client.off?.('ready', onReady);
      client.off?.('error', onError);
      client.off?.('close', onClose);
      client.off?.('end', onClose);
    });
  }

  _clientReady(client) {
    return !!client && (client.isReady?.() === true || client.ready === true || client.status === 'ready' || client.status == null);
  }

  _transitionDegraded(error) {
    if (this.state === 'ready') this.stateMachine.transition('degraded', error);
    this._diagnostic('degraded', { error, state: this.state });
  }

  _transitionReady() {
    if (this.state === 'degraded') {
      this._failureStreak = 0;
      this._circuitOpenUntil = 0;
      this.stateMachine.transition('ready');
      this._diagnostic('recovered', this.snapshot());
    }
  }

  /**
   * Wait until all currently admitted publications have either completed or
   * reached their configured retry limit. This never admits new work and is
   * safe to call repeatedly during graceful shutdown.
   */
  async flush(options = {}) {
    const timeoutMs = Math.max(0, Number(options.timeoutMs ?? this._config?.flushTimeoutMs ?? 30_000) || 0);
    const startedAt = Date.now();

    while (this._queue.length > 0 || this._drainPromise) {
      if (timeoutMs && Date.now() - startedAt >= timeoutMs) {
        throw new EventTransportError(`Redis event bridge flush timed out after ${timeoutMs}ms`, {
          code: 'EVENT_BRIDGE_FLUSH_TIMEOUT',
          details: { queue: this._queue.snapshot(), state: this.state },
        });
      }

      if (!this._drainPromise && this._queue.length > 0) void this._drainQueue();
      if (this._drainPromise) {
        await this._drainPromise;
        continue;
      }

      // A circuit-open or retry timer can temporarily leave admitted work in
      // the queue. Yield to timers rather than spinning in the microtask queue.
      if (this._queue.length > 0) {
        const remaining = timeoutMs ? Math.max(1, timeoutMs - (Date.now() - startedAt)) : 50;
        const delay = Math.min(50, remaining);
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, delay);
          timer.unref?.();
        });
      }
    }

    return this.snapshot();
  }

  stop() {
    if (this._stopPromise) return this._stopPromise;
    this._stopPromise = this._stop().finally(() => { this._stopPromise = null; });
    return this._stopPromise;
  }

  async _stop() {
    if (['idle', 'disabled', 'stopped', 'closed'].includes(this.state)) {
      this.enabled = false;
      return this.snapshot();
    }
    if (this.state === 'starting' && this._startPromise) {
      try { await this._startPromise; } catch {}
      if (['failed', 'stopped'].includes(this.state)) return this.snapshot();
    }

    if (['ready', 'degraded', 'failed'].includes(this.state)) this.stateMachine.transition('stopping');
    this.enabled = false;
    if (this._retryTimer) clearTimeout(this._retryTimer);
    this._retryTimer = null;

    this._publisherHandle?.dispose?.();
    this._publisherHandle = null;
    try { this._publisherOff?.(); } catch {}
    this._publisherOff = null;

    try {
      if (this._subscription?.unsubscribe) await this._subscription.unsubscribe();
      else if (this.subscriber?.unsubscribe) {
        try { await this.subscriber.unsubscribe(this.channel, this._subscriptionHandler); }
        catch { await this.subscriber.unsubscribe(this.channel); }
      }
    } catch {}
    this._subscription = null;
    this._subscriptionHandler = null;

    for (const cleanup of this._clientCleanups.splice(0)) {
      try { cleanup(); } catch {}
    }

    if (this._subscriberOwned) await closeClient(this.subscriber);
    if (this._publisherOwned && this.redis !== this.subscriber) await closeClient(this.redis);
    if (this._publisherOwned && this.redis === this.subscriber && !this._subscriberOwned) await closeClient(this.redis);
    this.redis = null;
    this.subscriber = null;
    this._publisherOwned = false;
    this._subscriberOwned = false;
    this._queue.clear('bridge-stopped');
    this._seen.clear();
    this._dispatcher?.setBridge?.(null);
    this._dispatcher = null;

    if (this.state === 'stopping') this.stateMachine.transition('stopped');
    this.stats.stops++;
    this._logger.info('[RedisEventBridge] stopped');
    return this.snapshot();
  }

  async close() {
    if (this._closed) return this.snapshot();
    await this.stop();
    if (this.state === 'idle' || this.state === 'disabled' || this.state === 'stopped' || this.state === 'failed') {
      this.stateMachine.transition('closed');
    }
    this._closed = true;
    return this.snapshot();
  }

  async _rollbackStart() {
    this.enabled = false;
    try { this._publisherHandle?.dispose?.(); } catch {}
    this._publisherHandle = null;
    try { this._publisherOff?.(); } catch {}
    this._publisherOff = null;
    try { await this._subscription?.unsubscribe?.(); } catch {}
    try { await this.subscriber?.unsubscribe?.(this.channel, this._subscriptionHandler); } catch {}
    for (const cleanup of this._clientCleanups.splice(0)) { try { cleanup(); } catch {} }
    if (this._subscriberOwned) await closeClient(this.subscriber);
    if (this._publisherOwned && this.redis !== this.subscriber) await closeClient(this.redis);
    this.redis = null;
    this.subscriber = null;
    this._subscription = null;
    this._subscriptionHandler = null;
  }

  _diagnostic(name, payload) {
    try { this._dispatcher?._emitDiagnostic?.(`bridge:${name}`, payload); } catch {}
  }

  async _resolveClientFactory(config) {
    if (typeof config.clientFactory === 'function') return config.clientFactory;
    const boundFactory = safeResolve(this.app, 'redis.createClient') || safeResolve(this.app, 'redis.factory');
    if (typeof boundFactory === 'function') return boundFactory;
    const redis = safeResolve(this.app, 'redis');
    if (typeof redis?.createClient === 'function') return redis.createClient.bind(redis);
    try {
      const module = await import('#redis');
      if (typeof module.createClient === 'function') return module.createClient;
      if (typeof module.default?.createClient === 'function') return module.default.createClient.bind(module.default);
    } catch {}
    throw new EventTransportError('Redis client factory is unavailable. Bind redis.createClient or pass clientFactory.', {
      code: 'EVENT_BRIDGE_REDIS_FACTORY_MISSING',
    });
  }

  _loadConfig(overrides) {
    const config = safeResolve(this.app, 'config');
    const fromConfig = configGet(config, 'events.bridge.redis', configGet(config, 'app.events.bridge.redis', {})) || {};
    const raw = {
      ...fromConfig,
      ...this.options,
      ...(isPlainObject(overrides) ? overrides : {}),
    };
    const redisConfig = raw.redis || configGet(config, 'redis', configGet(config, 'database.redis', {})) || {};
    const protocolRaw = isPlainObject(raw.protocol) ? raw.protocol : {};
    const limitsRaw = isPlainObject(raw.limits) ? raw.limits : {};
    const queueRaw = isPlainObject(raw.queue) ? raw.queue : {};
    const seenRaw = isPlainObject(raw.seen) ? raw.seen : {};
    const circuitRaw = isPlainObject(raw.circuit) ? raw.circuit : {};

    return {
      enabled: boolean(raw.enabled, boolean(process.env.EVENTS_REDIS, false)),
      required: boolean(raw.required, false),
      channel: String(raw.channel || 'rawnode:events'),
      nodeId: String(raw.nodeId || process.env.NODE_ID || `${hostname()}:${process.pid}`),
      namespace: String(raw.namespace || 'default'),
      allow: Array.isArray(raw.allow) ? raw.allow : [],
      deny: Array.isArray(raw.deny) ? raw.deny : ['internal:**', 'container:**', 'http:**', 'ws:**', 'tcp:**', 'udp:**'],
      rebridgeRemote: boolean(raw.rebridgeRemote, false),
      connectTimeoutMs: positive(raw.connectTimeoutMs, 10_000),
      publishTimeoutMs: positive(raw.publishTimeoutMs, 5_000),
      redis: redisConfig,
      logger: raw.logger || safeResolve(this.app, 'logger', console),
      dispatcher: raw.dispatcher || null,
      clientFactory: typeof raw.clientFactory === 'function' ? raw.clientFactory : null,
      publisherClient: raw.publisherClient || raw.clients?.publisher || null,
      subscriberClient: raw.subscriberClient || raw.clients?.subscriber || null,
      codec: isPlainObject(raw.codec) ? raw.codec : {},
      seen: {
        maxItems: positive(seenRaw.maxItems ?? raw.seenLimit, 50_000),
        ttlMs: positive(seenRaw.ttlMs ?? raw.seenTtlMs, 60_000),
      },
      queue: {
        maxItems: positive(queueRaw.maxItems, 10_000),
        maxBytes: positive(queueRaw.maxBytes, 16 * 1024 * 1024),
        overflow: ['reject', 'drop-newest', 'drop-oldest'].includes(queueRaw.overflow) ? queueRaw.overflow : 'drop-oldest',
        // `maxPublishRetries` is a compatibility alias expressed as retries;
        // the internal queue uses total attempts, therefore add one.
        maxAttempts: queueRaw.maxAttempts != null
          ? positive(queueRaw.maxAttempts, 3)
          : Math.max(1, Math.trunc(nonNegative(raw.maxPublishRetries, 2)) + 1),
        retryDelayMs: positive(queueRaw.retryDelayMs, 250),
      },
      circuit: {
        failureThreshold: positive(circuitRaw.failureThreshold, 5),
        openMs: positive(circuitRaw.openMs, 2_000),
      },
      limits: {
        maxPacketBytes: positive(limitsRaw.maxPacketBytes ?? raw.maxPacketBytes, 1024 * 1024),
        maxEventNameBytes: positive(limitsRaw.maxEventNameBytes, 512),
        maxArgs: positive(limitsRaw.maxArgs, 128),
      },
      protocol: {
        publishVersion: [1, 2].includes(Number(protocolRaw.publishVersion ?? raw.publishVersion)) ? Number(protocolRaw.publishVersion ?? raw.publishVersion) : 2,
        acceptedVersions: Array.isArray(protocolRaw.acceptedVersions) ? protocolRaw.acceptedVersions.map(Number) : [1, 2],
        maxAgeMs: nonNegative(protocolRaw.maxAgeMs, 0),
        maxClockSkewMs: nonNegative(protocolRaw.maxClockSkewMs, 30_000),
        maxHops: positive(protocolRaw.maxHops, 4),
        ttlMs: nonNegative(protocolRaw.ttlMs, 0),
        secret: protocolRaw.secret || raw.secret || null,
        acceptUnsignedV1: boolean(protocolRaw.acceptUnsignedV1, true),
      },
    };
  }

  snapshot() {
    return Object.freeze({
      ...this.stateMachine.snapshot(),
      enabled: this.enabled,
      required: this.required,
      ready: this.ready,
      channel: this.channel,
      nodeId: this.nodeId,
      namespace: this.namespace,
      queue: this._queue.snapshot(),
      seen: this._seen.snapshot(),
      circuitOpenUntil: this._circuitOpenUntil,
      circuit: Object.freeze({ failureStreak: this._failureStreak, openUntil: this._circuitOpenUntil }),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  health() {
    const unhealthy = this.required && !this.ready;
    return Object.freeze({
      ok: !unhealthy,
      ready: !unhealthy,
      state: this.state,
      required: this.required,
      reasons: Object.freeze(unhealthy ? [`bridge_${this.state}`] : []),
      snapshot: this.snapshot(),
    });
  }

  async [Symbol.asyncDispose]() { await this.close(); }
}

export default RedisEventBridge;
