'use strict';

import { once } from 'node:events';
import { performance } from 'node:perf_hooks';

export const COMPATIBILITY_VIEW = Symbol.for('rawnode.logger.compatibilityView');
const EMERGENCY_FALLBACK_WRITTEN = Symbol.for('rawnode.logger.emergencyFallbackWritten');

function isPromise(value) {
  return value && typeof value.then === 'function';
}

function finiteInteger(value, fallback, minimum = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : fallback;
}

function byteLength(value, serializer) {
  if (Buffer.isBuffer(value)) return value.length;
  if (typeof value === 'string') return Buffer.byteLength(value);
  try { return Buffer.byteLength(serializer.stringify(value)); }
  catch { return 512; }
}

function normalizeSet(value) {
  if (value == null || value === false) return null;
  const list = Array.isArray(value) ? value : String(value).split(',');
  const set = new Set(list.map((item) => String(item).trim()).filter(Boolean));
  return set.size ? set : null;
}

function createTransportError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function directEmergency(record, error, writer = null) {
  if (record && record[EMERGENCY_FALLBACK_WRITTEN]) return false;
  try {
    if (record && Object.isExtensible(record)) {
      Object.defineProperty(record, EMERGENCY_FALLBACK_WRITTEN, { value: true, enumerable: false });
    }
  } catch {}

  if (typeof writer === 'function') {
    try { writer(record, error); return true; } catch {}
  }

  const text = `[${record?.timestamp || new Date().toISOString()}] [${String(record?.level || 'error').toUpperCase()}] ${record?.message || 'Logger transport failure'}`;
  try {
    process.stderr.write(`${text}${error ? ` transport_error=${error.message || error}` : ''}\n`);
    return true;
  } catch { return false; }
}

function withTimeout(factory, timeoutMs, name, signal = null) {
  if (signal?.aborted) return Promise.reject(signal.reason || createTransportError('LOGGER_TRANSPORT_ABORTED', `Transport [${name}] write aborted.`));
  if (!timeoutMs || timeoutMs <= 0) return Promise.resolve().then(factory);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(reject, signal.reason || createTransportError('LOGGER_TRANSPORT_ABORTED', `Transport [${name}] write aborted.`));
    const timer = setTimeout(() => {
      finish(reject, createTransportError('LOGGER_TRANSPORT_TIMEOUT', `Transport [${name}] write timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    signal?.addEventListener?.('abort', onAbort, { once: true });
    Promise.resolve().then(factory).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function delay(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
  });
}

export class TransportAdapter {
  constructor(transport, options = {}) {
    if (!transport) throw new TypeError('TransportAdapter requires a transport.');
    this.transport = transport;
    this.serializer = options.serializer;
    this.levelRegistry = options.levelRegistry;
    this.diagnostics = options.diagnostics;
    this.metrics = options.metrics;
    this.name = options.name || transport.name || transport.constructor?.name || 'transport';
    this.payloadMode = options.payloadMode || transport.payloadMode || (transport.rawnodeTransportMode === 'legacy' ? 'object' : 'auto');
    this.level = options.level || options.minLevel || transport.level || null;
    this.channels = normalizeSet(options.channels ?? transport.channels);
    this.excludeChannels = normalizeSet(options.excludeChannels ?? transport.excludeChannels);
    this.filter = typeof options.filter === 'function'
      ? options.filter
      : (typeof transport.recordFilter === 'function' ? transport.recordFilter.bind(transport) : null);
    this.owned = options.owned ?? transport.owned ?? true;

    this.maxItems = finiteInteger(options.maxItems, 10_000, 1);
    this.maxBytes = finiteInteger(options.maxBytes, 64 * 1024 * 1024, 1_024);
    this.maxOvercommitItems = finiteInteger(options.maxOvercommitItems, Math.max(8, Math.ceil(this.maxItems * 0.05)), 0);
    this.maxOvercommitBytes = finiteInteger(options.maxOvercommitBytes, Math.max(512 * 1024, Math.ceil(this.maxBytes * 0.10)), 0);
    this.overflow = options.overflow || 'severity-aware';
    this.budgetMs = Math.max(1, Number(options.budgetMs) || 6);
    this.maxPerSlice = finiteInteger(options.maxPerSlice, 1_000, 1);
    this.batchSize = finiteInteger(options.batchSize ?? transport.batchSize, 1, 1);
    this.batchIntervalMs = finiteInteger(
      options.batchIntervalMs ?? transport.batchIntervalMs,
      this.batchSize > 1 ? 10 : 0,
      0,
    );
    this.writeTimeoutMs = finiteInteger(options.writeTimeoutMs, 30_000, 0);
    this.flushTimeoutMs = finiteInteger(options.flushTimeoutMs, 30_000, 0);

    this.maxRetries = finiteInteger(options.maxRetries, 0, 0);
    this.retryDelayMs = finiteInteger(options.retryDelayMs, 50, 0);
    this.retryMaxDelayMs = finiteInteger(options.retryMaxDelayMs, 2_000, 0);
    this.retryJitter = Math.max(0, Math.min(1, Number(options.retryJitter) || 0));
    this.retryOn = typeof options.retryOn === 'function' ? options.retryOn : null;

    this.failureThreshold = finiteInteger(options.failureThreshold, 5, 1);
    this.circuitOpenMs = finiteInteger(options.circuitOpenMs, 2_000, 1);
    this.emergencyWriter = typeof options.emergencyWriter === 'function' ? options.emergencyWriter : null;

    this.queue = [];
    this.queueBytes = 0;
    this.activeItems = 0;
    this.activeBytes = 0;
    this.overcommitItems = 0;
    this.overcommitBytes = 0;
    this.running = false;
    this._scheduled = false;
    this._batchTimer = null;
    this.closed = false;
    this.failures = 0;
    this.circuitOpenedAt = 0;
    this.flushWaiters = new Set();
    this.stats = {
      accepted: 0,
      delivered: 0,
      skipped: 0,
      dropped: 0,
      evicted: 0,
      overcommitted: 0,
      emergencyFallbacks: 0,
      batches: 0,
      retries: 0,
      errors: 0,
      timeouts: 0,
      circuitOpens: 0,
      fallbackWrites: 0,
      maxQueueItems: 0,
      maxQueueBytes: 0,
      maxQueueLatencyMs: 0,
      lastError: null,
      lastSuccessAt: null,
    };
  }

  accepts(record) {
    if (!record) return false;
    if (this.level && !this.levelRegistry.isEnabled(record.level, this.level)) return false;
    if (this.channels && !this.channels.has(String(record.channel))) return false;
    if (this.excludeChannels?.has(String(record.channel))) return false;
    if (this.filter) {
      try { return this.filter(record, this) !== false; }
      catch (error) {
        this.diagnostics?.report?.('LOGGER_TRANSPORT_FILTER_ERROR', error, { transport: this.name });
        return false;
      }
    }
    return true;
  }

  enqueue(record, options = {}) {
    if (this.closed) {
      return Promise.reject(createTransportError('LOGGER_TRANSPORT_CLOSED', `Transport [${this.name}] is closed.`));
    }
    if (!this.accepts(record)) {
      this.stats.skipped++;
      return Promise.resolve({ skipped: true, reason: 'transport-filter' });
    }

    const bytes = byteLength(record, this.serializer);
    const definition = this.levelRegistry.get(record.level);
    const highSeverity = definition?.droppable === false;

    if (this._isCircuitOpen()) {
      this.stats.dropped++;
      this.metrics?.increment?.('records_dropped');
      if (highSeverity && directEmergency(record, createTransportError('LOGGER_TRANSPORT_CIRCUIT_OPEN', `Transport circuit [${this.name}] is open.`), this.emergencyWriter)) {
        this.stats.fallbackWrites++;
        this.stats.emergencyFallbacks++;
      }
      return Promise.resolve({ dropped: true, circuitOpen: true, emergencyFallback: highSeverity });
    }

    if (!this._fits(bytes)) this._evictDroppable(bytes);
    let overcommitted = false;
    if (!this._fits(bytes)) {
      if (!highSeverity) {
        this.stats.dropped++;
        this.metrics?.increment?.('records_dropped');
        if (this.overflow === 'throw' || this.overflow === 'reject') {
          return Promise.reject(createTransportError('LOGGER_TRANSPORT_QUEUE_OVERFLOW', `Transport queue [${this.name}] is full.`, this.health()));
        }
        return Promise.resolve({ dropped: true, reason: 'queue-overflow' });
      }
      if (!this._canOvercommit(bytes)) {
        const error = createTransportError('LOGGER_TRANSPORT_OVERCOMMIT_EXHAUSTED', `Transport queue [${this.name}] exhausted its emergency overcommit budget.`);
        if (directEmergency(record, error, this.emergencyWriter)) {
          this.stats.fallbackWrites++;
          this.stats.emergencyFallbacks++;
        }
        return Promise.resolve({ delivered: true, emergencyFallback: true });
      }
      overcommitted = true;
      this.overcommitItems++;
      this.overcommitBytes += bytes;
      this.stats.overcommitted++;
    }

    this.stats.accepted++;
    this.metrics?.increment?.('transport_records_accepted');
    return new Promise((resolve, reject) => {
      this.queue.push({
        record,
        bytes,
        resolve,
        reject,
        signal: options.signal || null,
        overcommitted,
        enqueuedAt: performance.now(),
      });
      this.queueBytes += bytes;
      this.stats.maxQueueItems = Math.max(this.stats.maxQueueItems, this.queue.length + this.activeItems);
      this.stats.maxQueueBytes = Math.max(this.stats.maxQueueBytes, this.queueBytes + this.activeBytes);
      this._schedule();
    });
  }

  _fits(bytes) {
    return this.queue.length + this.activeItems < this.maxItems
      && this.queueBytes + this.activeBytes + bytes <= this.maxBytes;
  }

  _canOvercommit(bytes) {
    return this.overcommitItems < this.maxOvercommitItems
      && this.overcommitBytes + bytes <= this.maxOvercommitBytes;
  }

  _evictDroppable(bytes) {
    if (!['drop-oldest', 'drop-lowest', 'severity-aware'].includes(this.overflow)) return;
    while (!this._fits(bytes) && this.queue.length) {
      let index = -1;
      if (this.overflow === 'drop-oldest') {
        index = this.queue.findIndex((item) => this.levelRegistry.get(item.record.level)?.droppable !== false);
      } else {
        let lowestRank = -Infinity;
        let lowestSeverity = Infinity;
        for (let cursor = 0; cursor < this.queue.length; cursor++) {
          const definition = this.levelRegistry.get(this.queue[cursor].record.level);
          if (definition?.droppable === false) continue;
          const rank = definition?.rank ?? Infinity;
          const severity = definition?.severity ?? -Infinity;
          if (index < 0 || rank > lowestRank || (rank === lowestRank && severity < lowestSeverity)) {
            lowestRank = rank;
            lowestSeverity = severity;
            index = cursor;
          }
        }
      }
      if (index < 0) return;
      const [item] = this.queue.splice(index, 1);
      this.queueBytes -= item.bytes;
      if (item.overcommitted) {
        this.overcommitItems = Math.max(0, this.overcommitItems - 1);
        this.overcommitBytes = Math.max(0, this.overcommitBytes - item.bytes);
      }
      this.stats.dropped++;
      this.stats.evicted++;
      this.metrics?.increment?.('records_dropped');
      item.resolve({ dropped: true, reason: 'queue-overflow-evicted' });
    }
  }

  _schedule(force = false) {
    if (this.running || !this.queue.length) return;

    if (this._scheduled) {
      if (force || this.queue.length >= this.batchSize) {
        if (this._batchTimer) clearTimeout(this._batchTimer);
        this._batchTimer = null;
        this._scheduled = false;
        queueMicrotask(() => this._beginDrain());
      }
      return;
    }

    const shouldLinger = !force
      && this.batchSize > 1
      && this.batchIntervalMs > 0
      && this.queue.length < this.batchSize;
    this._scheduled = true;
    if (shouldLinger) {
      this._batchTimer = setTimeout(() => {
        this._batchTimer = null;
        this._scheduled = false;
        this._beginDrain();
      }, this.batchIntervalMs);
      this._batchTimer.unref?.();
      return;
    }
    queueMicrotask(() => {
      this._scheduled = false;
      this._beginDrain();
    });
  }

  _beginDrain() {
    if (this.running || this.closed || !this.queue.length) {
      this._resolveFlushWaiters();
      return;
    }
    this.running = true;
    this._drain().catch((error) => {
      this.diagnostics?.report?.('LOGGER_TRANSPORT_DRAIN_ERROR', error, { transport: this.name });
      this.running = false;
      if (this.queue.length) this._schedule();
      else this._resolveFlushWaiters();
    });
  }

  async _drain() {
    let sliceStart = performance.now();
    let processed = 0;
    try {
      while (this.queue.length) {
        const items = this._takeBatch();
        const live = items.filter((item) => !item.signal?.aborted);
        for (const item of items) {
          if (item.signal?.aborted) item.resolve({ dropped: true, reason: 'aborted' });
        }
        if (live.length) {
          try {
            await this._deliverWithRetry(live);
            this.failures = 0;
            this.stats.lastError = null;
            this.stats.lastSuccessAt = new Date().toISOString();
            this.stats.delivered += live.length;
            this.metrics?.increment?.('transport_records_delivered', live.length);
            for (const item of live) item.resolve({ delivered: true });
          } catch (error) {
            this._recordFailure(error, live);
          }
        }

        this._releaseActive(items);
        processed += items.length;
        if (processed >= this.maxPerSlice || performance.now() - sliceStart >= this.budgetMs) {
          processed = 0;
          sliceStart = performance.now();
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    } finally {
      this.running = false;
      this._resolveFlushWaiters();
      if (this.queue.length) this._schedule();
    }
  }

  _takeBatch() {
    const count = Math.min(this.batchSize, this.queue.length);
    const items = this.queue.splice(0, count);
    for (const item of items) {
      this.queueBytes -= item.bytes;
      this.activeItems++;
      this.activeBytes += item.bytes;
      this.stats.maxQueueLatencyMs = Math.max(this.stats.maxQueueLatencyMs, performance.now() - item.enqueuedAt);
    }
    return items;
  }

  _releaseActive(items) {
    for (const item of items) {
      this.activeItems = Math.max(0, this.activeItems - 1);
      this.activeBytes = Math.max(0, this.activeBytes - item.bytes);
      if (item.overcommitted) {
        this.overcommitItems = Math.max(0, this.overcommitItems - 1);
        this.overcommitBytes = Math.max(0, this.overcommitBytes - item.bytes);
      }
    }
  }

  async _deliverWithRetry(items) {
    let attempt = 0;
    while (true) {
      try {
        await withTimeout(() => this._deliver(items), this.writeTimeoutMs, this.name, items[0]?.signal);
        return;
      } catch (error) {
        const retryable = attempt < this.maxRetries && this._isRetryable(error, attempt, items);
        if (!retryable) throw error;
        attempt++;
        this.stats.retries += items.length;
        this.metrics?.increment?.('transport_retries', items.length);
        let wait = Math.min(this.retryMaxDelayMs, this.retryDelayMs * (2 ** (attempt - 1)));
        if (this.retryJitter > 0) wait *= 1 + ((Math.random() * 2 - 1) * this.retryJitter);
        await delay(Math.max(0, Math.round(wait)));
      }
    }
  }

  _isRetryable(error, attempt, items) {
    if (this.retryOn) {
      try { return this.retryOn(error, { attempt, records: items.map((item) => item.record), adapter: this }) !== false; }
      catch { return false; }
    }
    if (['LOGGER_TRANSPORT_CLOSED', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE'].includes(error?.code)) return false;
    return true;
  }

  async _deliver(items) {
    if (items.length > 1 && this.transport.rawnodeEnterpriseTransport === true && typeof this.transport.writeBatch === 'function') {
      await this.transport.writeBatch(items.map((item) => item.record));
      this.stats.batches++;
      return;
    }
    for (const item of items) await this._write(item.record);
  }

  _recordFailure(error, items) {
    this.failures++;
    this.stats.errors += items.length;
    if (error?.code === 'LOGGER_TRANSPORT_TIMEOUT') this.stats.timeouts += items.length;
    this.stats.lastError = {
      message: error?.message || String(error),
      code: error?.code,
      timestamp: new Date().toISOString(),
    };
    this.metrics?.increment?.('transport_errors', items.length);
    this.diagnostics?.report?.('LOGGER_TRANSPORT_ERROR', error, { transport: this.name, records: items.length });
    if (this.failures >= this.failureThreshold && !this.circuitOpenedAt) {
      this.circuitOpenedAt = Date.now();
      this.stats.circuitOpens++;
    }
    for (const item of items) {
      const definition = this.levelRegistry.get(item.record.level);
      if (definition?.droppable === false && directEmergency(item.record, error, this.emergencyWriter)) {
        this.stats.fallbackWrites++;
        this.stats.emergencyFallbacks++;
      }
      item.reject(error);
    }
  }

  async _write(record) {
    const transport = this.transport;
    const compatibility = record[COMPATIBILITY_VIEW] || null;

    if (transport.rawnodeEnterpriseTransport === true && typeof transport.writeRecord === 'function') {
      return await transport.writeRecord(record);
    }

    if (transport.rawnodeCompatibilityTransport === true && typeof transport.writeRecord === 'function') {
      return await transport.writeRecord(this._compatibilityPayload(record, compatibility));
    }

    if (typeof transport.writeRecord === 'function') return await transport.writeRecord(record);
    if (typeof transport.write !== 'function') {
      throw new TypeError(`Transport [${this.name}] does not expose write() or writeRecord().`);
    }

    // Historic RawNode transports accept write(level, formatted).
    if (transport.writable !== true && !transport._writableState && transport.write.length >= 2) {
      const result = transport.write(record.level, compatibility?.formatted || record.formatted);
      return isPromise(result) ? await result : result;
    }

    const payload = this._compatibilityPayload(record, compatibility);
    if (transport.writable === true || transport._writableState) {
      return await this._writeNodeStream(transport, payload);
    }

    const result = transport.write(payload);
    return isPromise(result) ? await result : result;
  }

  async _writeNodeStream(stream, payload) {
    let accepted = true;
    await new Promise((resolve, reject) => {
      let callbackDone = false;
      let drainDone = true;
      let settled = false;
      const cleanup = () => stream.off?.('error', onError);
      const finish = (error) => {
        if (settled) return;
        if (error) {
          settled = true;
          cleanup();
          reject(error);
        } else if (callbackDone && drainDone) {
          settled = true;
          cleanup();
          resolve();
        }
      };
      const onError = (error) => finish(error);
      stream.once?.('error', onError);
      try {
        accepted = stream.write(payload, (error) => {
          callbackDone = true;
          finish(error);
        });
        if (accepted === false) {
          drainDone = false;
          stream.once('drain', () => {
            drainDone = true;
            finish();
          });
        }
      } catch (error) {
        finish(error);
      }
    });
    return accepted;
  }

  _compatibilityPayload(record, compatibility) {
    const configured = this.payloadMode === 'auto'
      ? (this.transport.rawnodeTransportMode === 'legacy' ? 'object' : 'object')
      : this.payloadMode;
    const source = compatibility || record;
    if (configured === 'json') return this.serializer.stringify(source);
    if (configured === 'text' || configured === 'formatted') return source.formatted || record.formatted;
    return source;
  }

  _isCircuitOpen() {
    if (!this.circuitOpenedAt) return false;
    if (Date.now() - this.circuitOpenedAt >= this.circuitOpenMs) {
      this.circuitOpenedAt = 0;
      this.failures = 0;
      return false;
    }
    return true;
  }

  async flush(options = {}) {
    if (!this.running && this.activeItems === 0 && this.queue.length === 0) {
      if (typeof this.transport.flush === 'function') await this.transport.flush(options);
      return;
    }
    const timeoutMs = options.timeoutMs == null ? this.flushTimeoutMs : Math.max(0, Number(options.timeoutMs) || 0);
    let timer = null;
    await new Promise((resolve, reject) => {
      const waiter = {
        resolve: () => {
          if (timer) clearTimeout(timer);
          this.flushWaiters.delete(waiter);
          resolve();
        },
      };
      this.flushWaiters.add(waiter);
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.flushWaiters.delete(waiter);
          reject(createTransportError('LOGGER_TRANSPORT_FLUSH_TIMEOUT', `Transport [${this.name}] flush timed out after ${timeoutMs}ms.`, this.health()));
        }, timeoutMs);
      }
      this._schedule(true);
    });
    if (typeof this.transport.flush === 'function') await this.transport.flush(options);
  }

  _resolveFlushWaiters() {
    if (this.running || this.activeItems || this.queue.length) return;
    for (const waiter of this.flushWaiters) waiter.resolve();
    this.flushWaiters.clear();
  }

  async reopen(options = {}) {
    await this.flush(options);
    if (typeof this.transport.reopen === 'function') return await this.transport.reopen(options);
    return false;
  }

  async close(options = {}) {
    if (this.closed) return;
    await this.flush(options);
    if (this._batchTimer) clearTimeout(this._batchTimer);
    this._batchTimer = null;
    this._scheduled = false;
    this.closed = true;
    if (this.owned === false) return;
    const transport = this.transport;
    if (typeof transport.close === 'function') await transport.close(options);
    else if (typeof transport.end === 'function') {
      await new Promise((resolve, reject) => transport.end((error) => error ? reject(error) : resolve()));
    } else if (typeof transport.destroy === 'function') transport.destroy();
  }

  health() {
    const nested = typeof this.transport.health === 'function' ? this.transport.health() : null;
    const circuitOpen = this._isCircuitOpen();
    return {
      name: this.name,
      status: this.closed ? 'closed' : (circuitOpen || this.stats.lastError ? 'degraded' : 'healthy'),
      closed: this.closed,
      owned: this.owned,
      level: this.level,
      channels: this.channels ? [...this.channels] : null,
      circuitOpen,
      queueItems: this.queue.length,
      queueBytes: this.queueBytes,
      batchSize: this.batchSize,
      batchIntervalMs: this.batchIntervalMs,
      scheduled: this._scheduled,
      activeItems: this.activeItems,
      activeBytes: this.activeBytes,
      overcommitItems: this.overcommitItems,
      overcommitBytes: this.overcommitBytes,
      stats: { ...this.stats },
      transport: nested,
    };
  }
}

export { EMERGENCY_FALLBACK_WRITTEN, directEmergency };
export default TransportAdapter;
