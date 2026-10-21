'use strict';

import { EventEmitter } from 'node:events';

export class RealtimeGateway extends EventEmitter {
  constructor(options = {}) {
    super();
    this.historyLimit = Math.max(10, Number(options.historyLimit) || 1_000);
    this.history = [];
    this.adapters = new Set();
  }

  publish(event, payload = {}) {
    const packet = { event: String(event), payload, at: Date.now() };
    this.history.push(packet);
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    this.emit('event', packet);
    this.emit(packet.event, packet.payload);
    for (const adapter of this.adapters) {
      try {
        Promise.resolve(adapter.publish(packet)).catch((error) => this.emit('adapterError', error, adapter));
      } catch (error) {
        this.emit('adapterError', error, adapter);
      }
    }
    return packet;
  }

  attach(adapter) {
    if (!adapter || typeof adapter.publish !== 'function') throw new Error('Realtime adapter requires publish(packet).');
    this.adapters.add(adapter);
    return () => this.adapters.delete(adapter);
  }

  attachRawNodeWebSocket(io, options = {}) {
    const namespaceName = options.namespace || '/__rawnode/pm';
    const namespace = typeof io?.of === 'function' ? io.of(namespaceName) : io;
    return this.attach({
      publish(packet) {
        if (typeof namespace?.emit === 'function') namespace.emit('pm:event', packet);
        else if (typeof namespace?.broadcast === 'function') namespace.broadcast('pm:event', packet);
      },
    });
  }

  recent(options = {}) {
    const event = options.event || null;
    const limit = Math.max(1, Number(options.limit) || 100);
    const values = event ? this.history.filter((entry) => entry.event === event) : this.history;
    return values.slice(-limit);
  }
}

export default RealtimeGateway;
