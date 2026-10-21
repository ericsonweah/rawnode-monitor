'use strict';

import TransportAdapter, { directEmergency } from './TransportAdapter.js';

function isDelivered(result) {
  if (result?.status === 'rejected') return false;
  const value = result?.status === 'fulfilled' ? result.value : result;
  return value?.delivered === true || value?.emergencyFallback === true || value === undefined;
}

export class TransportDispatcher {
  constructor(options = {}) {
    this.serializer = options.serializer;
    this.levelRegistry = options.levelRegistry;
    this.diagnostics = options.diagnostics;
    this.metrics = options.metrics;
    this.adapterOptions = { ...(options.adapter || {}) };
    this.emergencyWriter = typeof options.emergencyWriter === 'function' ? options.emergencyWriter : null;
    this.adapters = [];
    this.closed = false;
    for (const entry of options.transports || []) {
      if (entry?.transport) this.add(entry.transport, entry.options || {});
      else this.add(entry);
    }
  }

  add(transport, options = {}) {
    if (this.closed) throw new Error('Cannot add a transport to a closed dispatcher.');
    if (!transport) throw new TypeError('TransportDispatcher.add requires a transport.');
    const existing = this.adapters.find((adapter) => adapter === transport || adapter.transport === transport);
    if (existing) return existing;
    if (!transport.serializer) {
      try { transport.serializer = this.serializer; } catch {}
    }
    const adapter = transport instanceof TransportAdapter ? transport : new TransportAdapter(transport, {
      serializer: this.serializer,
      levelRegistry: this.levelRegistry,
      diagnostics: this.diagnostics,
      metrics: this.metrics,
      emergencyWriter: this.emergencyWriter,
      ...this.adapterOptions,
      ...(options || {}),
    });
    this.adapters.push(adapter);
    return adapter;
  }

  remove(nameOrTransport, options = {}) {
    const index = this.adapters.findIndex((adapter) => (
      adapter === nameOrTransport
      || adapter.name === nameOrTransport
      || adapter.transport === nameOrTransport
    ));
    if (index === -1) return null;
    const [adapter] = this.adapters.splice(index, 1);
    if (options.close === true) {
      adapter.close(options).catch((error) => this.diagnostics?.report?.(
        'LOGGER_TRANSPORT_CLOSE_ERROR',
        error,
        { transport: adapter.name },
      ));
    }
    return adapter;
  }

  async dispatch(record, options = {}) {
    if (this.closed) throw new Error('Logger transport dispatcher is closed.');
    const definition = this.levelRegistry.get(record?.level);
    const highSeverity = definition?.droppable === false;

    if (!this.adapters.length) {
      this.metrics?.increment?.('records_without_transport');
      if (highSeverity) directEmergency(record, new Error('No logger transports are configured.'), this.emergencyWriter);
      return [];
    }

    const promises = this.adapters.map((adapter) => adapter.enqueue(record, options));
    if (options.awaitDelivery === true) {
      const results = await Promise.allSettled(promises);
      if (highSeverity && !results.some(isDelivered)) {
        directEmergency(record, new AggregateError(
          results.filter((result) => result.status === 'rejected').map((result) => result.reason),
          'All logger transports failed.',
        ), this.emergencyWriter);
      }
      if (options.throwOnError === true) {
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'One or more logger transports failed.');
      }
      return results;
    }

    for (const promise of promises) {
      promise.catch((error) => this.diagnostics?.report?.('LOGGER_TRANSPORT_ASYNC_ERROR', error, { recordId: record?.id }));
    }
    return promises;
  }

  async flush(options = {}) {
    const results = await Promise.allSettled(this.adapters.map((adapter) => adapter.flush(options)));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length && options.throwOnError === true) {
      throw new AggregateError(failures.map((result) => result.reason), 'One or more logger transports failed to flush.');
    }
    return results;
  }

  async reopen(options = {}) {
    await this.flush(options);
    return await Promise.allSettled(this.adapters.map((adapter) => adapter.reopen(options)));
  }

  async close(options = {}) {
    if (this.closed) return;
    await this.flush(options);
    this.closed = true;
    const results = await Promise.allSettled(this.adapters.map((adapter) => adapter.close(options)));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length && options.throwOnError === true) {
      throw new AggregateError(failures.map((result) => result.reason), 'One or more logger transports failed to close.');
    }
    return results;
  }

  health() { return this.adapters.map((adapter) => adapter.health()); }

  stats() {
    return this.adapters.map((adapter) => ({
      name: adapter.name,
      ...adapter.stats,
      queueItems: adapter.queue.length,
      queueBytes: adapter.queueBytes,
      activeItems: adapter.activeItems,
      activeBytes: adapter.activeBytes,
    }));
  }

  snapshot() {
    return {
      closed: this.closed,
      transports: this.health(),
    };
  }
}

export default TransportDispatcher;
