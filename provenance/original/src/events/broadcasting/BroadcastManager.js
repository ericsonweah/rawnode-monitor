'use strict';

import { compileMatcherList, matchesAny } from '../support/glob.js';
import { EventTransportError } from '../errors/EventError.js';

function isDispatcher(value) {
  return !!value && typeof value === 'object' && (
    typeof value.subscribeAny === 'function' || typeof value.onAny === 'function'
  );
}

function asArray(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }

export class BroadcastManager {
  constructor(dispatcherOrOptions = null, maybeOptions = {}) {
    this.dispatcher = isDispatcher(dispatcherOrOptions) ? dispatcherOrOptions : null;
    const options = this.dispatcher ? maybeOptions : (dispatcherOrOptions || {});
    this.transports = new Map();
    this.allow = compileMatcherList(options.allow || []);
    this.deny = compileMatcherList(options.deny || []);
    this.errorPolicy = options.errorPolicy || 'isolate';
    this.defaultChannel = options.defaultChannel || 'global';
    this.handle = null;
    this.started = false;
    this.stats = { considered: 0, broadcast: 0, deliveries: 0, skipped: 0, errors: 0 };
    for (const [name, transport] of Object.entries(options.adapters || options.transports || {})) {
      this.register(name, transport);
    }
  }

  setDispatcher(dispatcher) {
    if (!isDispatcher(dispatcher)) throw new TypeError('BroadcastManager requires an event dispatcher');
    this.dispatcher = dispatcher;
    return this;
  }

  register(name, transport, options = {}) {
    const key = String(name || '').trim();
    if (!key) throw new TypeError('Broadcast transport name is required');
    if (!transport || (
      typeof transport.broadcast !== 'function' &&
      typeof transport.publish !== 'function' &&
      typeof transport.emit !== 'function'
    )) {
      throw new TypeError('Broadcast transport must expose broadcast(), publish(), or emit()');
    }
    if (this.transports.has(key) && options.replace !== true) throw new Error(`Broadcast transport already exists: ${key}`);
    this.transports.set(key, { transport, options: { ...options } });
    return this;
  }

  unregister(name) { return this.transports.delete(String(name)); }

  start(dispatcher = this.dispatcher) {
    if (this.started) return this;
    this.setDispatcher(dispatcher);
    const listener = (eventName, eventObject) => {
      if (!eventObject || typeof eventObject !== 'object') return;
      void this.broadcast(eventObject, this.dispatcher.getContext?.(), { eventName }).catch(() => {});
    };
    if (typeof this.dispatcher.subscribeAny === 'function') {
      this.handle = this.dispatcher.subscribeAny(listener, {
        priority: -900,
        owner: 'rawnode:events:broadcast-manager',
        tags: ['broadcast'],
      });
    } else {
      this.dispatcher.onAny(listener, { priority: -900 });
      this._legacyListener = listener;
    }
    this.started = true;
    return this;
  }

  async broadcast(eventObject, context = null, options = {}) {
    if (!eventObject || typeof eventObject !== 'object') throw new TypeError('BroadcastManager.broadcast expects an event object');
    const eventName = String(options.eventName || eventObject.eventName || eventObject.constructor?.eventName || eventObject.constructor?.name || 'Event');
    this.stats.considered++;
    if (this.allow.length && !matchesAny(this.allow, eventName)) return this._skip('allow');
    if (this.deny.length && matchesAny(this.deny, eventName)) return this._skip('deny');
    if (typeof eventObject.shouldBroadcast === 'function' && eventObject.shouldBroadcast() !== true) return this._skip('shouldBroadcast');
    if (typeof eventObject.broadcastWhen === 'function' && await eventObject.broadcastWhen(context, options) === false) return this._skip('condition');

    const envelope = typeof eventObject.toBroadcastEnvelope === 'function'
      ? eventObject.toBroadcastEnvelope()
      : {
          event: typeof eventObject.broadcastAs === 'function' ? eventObject.broadcastAs() : eventName,
          channels: resolveChannels(eventObject, this.defaultChannel),
          payload: typeof eventObject.broadcastWith === 'function' ? eventObject.broadcastWith() : eventObject.payload ?? eventObject,
          id: eventObject.id,
          timestamp: eventObject.timestamp,
          meta: eventObject.meta ? { ...eventObject.meta } : null,
        };
    envelope.channels = asArray(envelope.channels).map(String).filter(Boolean);
    if (!envelope.channels.length) envelope.channels = [this.defaultChannel];

    const selected = options.transports ? new Set(asArray(options.transports).map(String)) : null;
    const deliveries = [];
    for (const [name, record] of this.transports) {
      if (selected && !selected.has(name)) continue;
      try {
        const value = await invoke(record.transport, envelope, {
          ...record.options,
          ...options,
          context,
          transportName: name,
          eventObject,
        });
        deliveries.push({ transport: name, status: 'fulfilled', value });
        this.stats.deliveries++;
      } catch (error) {
        this.stats.errors++;
        deliveries.push({ transport: name, status: 'rejected', error });
        if (options.errorPolicy === 'fail-fast' || this.errorPolicy === 'fail-fast') {
          throw new EventTransportError(`Broadcast transport "${name}" failed`, {
            code: 'EVENT_BROADCAST_FAILED',
            cause: error,
            details: { transport: name, eventName },
          });
        }
      }
    }
    this.stats.broadcast++;
    return { broadcast: true, event: envelope.event, channels: envelope.channels, envelope, deliveries };
  }

  _skip(reason) {
    this.stats.skipped++;
    return { broadcast: false, reason, deliveries: [] };
  }

  async stop() {
    this.handle?.dispose?.();
    if (this._legacyListener) this.dispatcher?.offAny?.(this._legacyListener);
    this.handle = null;
    this._legacyListener = null;
    this.started = false;
    return this;
  }

  async close(options = {}) {
    await this.stop();
    if (options.closeTransports !== false) {
      for (const { transport } of this.transports.values()) {
        try {
          if (typeof transport.close === 'function') await transport.close();
          else if (typeof transport.dispose === 'function') await transport.dispose();
        } catch (error) {
          this.stats.errors++;
          if (this.errorPolicy === 'fail-fast') throw error;
        }
      }
    }
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      started: this.started,
      transports: Object.freeze(Array.from(this.transports.keys())),
      errorPolicy: this.errorPolicy,
      stats: Object.freeze({ ...this.stats }),
    });
  }

  async [Symbol.asyncDispose]() { await this.close(); }
}

function resolveChannels(eventObject, fallback) {
  if (typeof eventObject.broadcastChannels === 'function') return asArray(eventObject.broadcastChannels());
  if (typeof eventObject.broadcastChannel === 'function') return asArray(eventObject.broadcastChannel());
  return [fallback];
}

async function invoke(transport, envelope, options) {
  if (typeof transport.broadcast === 'function') return transport.broadcast(envelope, options);
  if (typeof transport.publish === 'function') return transport.publish(envelope.event, envelope, options);
  return transport.emit(envelope.event, envelope, options);
}

export default BroadcastManager;
