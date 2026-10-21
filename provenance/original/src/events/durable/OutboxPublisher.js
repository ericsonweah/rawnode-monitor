'use strict';

import { randomUUID } from 'node:crypto';
import { EventTransportError } from '../errors/EventError.js';

function sleep(ms, signal, unref = true) {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('Aborted'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener?.('abort', abort);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const timer = setTimeout(() => finish(resolve), Math.max(0, ms));
    if (unref) timer.unref?.();
    const abort = () => {
      clearTimeout(timer);
      finish(reject, signal.reason || new Error('Aborted'));
    };
    signal?.addEventListener?.('abort', abort, { once: true });
  });
}

async function awaitPublication(transport, eventName, args, options) {
  const admission = await transport.publish(eventName, args, options);
  if (admission?.accepted === false) {
    throw new EventTransportError('Outbox transport rejected publication', {
      code: admission.code || 'EVENT_OUTBOX_TRANSPORT_REJECTED',
      details: admission,
    });
  }
  if (admission?.promise && typeof admission.promise.then === 'function') {
    const delivery = await admission.promise;
    if (delivery?.published === false || delivery?.accepted === false) {
      throw new EventTransportError('Outbox transport did not publish the event', {
        code: delivery.code || 'EVENT_OUTBOX_TRANSPORT_NOT_PUBLISHED',
        details: delivery,
      });
    }
    return delivery;
  }
  return admission;
}

export class OutboxPublisher {
  constructor(store, transport, options = {}) {
    if (!store || typeof store.claim !== 'function') throw new TypeError('OutboxPublisher requires an outbox store');
    if (!transport || typeof transport.publish !== 'function') throw new TypeError('OutboxPublisher requires a publish-capable transport');
    this.store = store;
    this.transport = transport;
    this.owner = options.owner || `outbox-${process.pid}-${randomUUID()}`;
    this.batchSize = Math.max(1, Number(options.batchSize) || 100);
    this.concurrency = Math.max(1, Number(options.concurrency) || 8);
    this.leaseMs = Math.max(1000, Number(options.leaseMs) || 30_000);
    this.pollMs = Math.max(1, Number(options.pollMs) || 250);
    this.retryBaseMs = Math.max(0, Number(options.retryBaseMs) || 250);
    this.retryMaxMs = Math.max(this.retryBaseMs, Number(options.retryMaxMs) || 30_000);
    this.jitter = Math.max(0, Math.min(1, Number(options.jitter) || 0.2));
    this.unrefTimers = options.unrefTimers !== false;
    this.running = false;
    this.controller = null;
    this.loopPromise = null;
    this.active = new Set();
    this.stats = { cycles: 0, claimed: 0, published: 0, failed: 0, deadLettered: 0, transportErrors: 0 };
  }

  async runOnce(options = {}) {
    const records = await this.store.claim({
      owner: this.owner,
      leaseMs: this.leaseMs,
      limit: options.limit || this.batchSize,
      now: options.now,
    });
    this.stats.cycles++;
    this.stats.claimed += records.length;
    if (!records.length) return { claimed: 0, published: 0, failed: 0 };

    let cursor = 0;
    let published = 0;
    let failed = 0;
    const worker = async () => {
      while (cursor < records.length) {
        const record = records[cursor++];
        try {
          await awaitPublication(this.transport, record.event, record.args, {
            id: record.id,
            version: record.version,
            context: record.context,
            headers: record.headers,
            durable: true,
            meta: record.meta,
          });
          await this.store.complete(record.id, {
            owner: this.owner,
            fencingToken: record.fencingToken,
          });
          this.stats.published++;
          published++;
        } catch (error) {
          this.stats.transportErrors++;
          const retryAfterMs = this._retryDelay(record.attempts + 1);
          const updated = await this.store.fail(record.id, error, {
            owner: this.owner,
            fencingToken: record.fencingToken,
            retryAfterMs,
          });
          this.stats.failed++;
          failed++;
          if (updated.status === 'dead') this.stats.deadLettered++;
        }
      }
    };
    const workers = Array.from({ length: Math.min(this.concurrency, records.length) }, () => {
      let tracked;
      tracked = worker().finally(() => this.active.delete(tracked));
      this.active.add(tracked);
      return tracked;
    });
    await Promise.all(workers);
    return { claimed: records.length, published, failed };
  }

  _retryDelay(attempt) {
    const exponential = Math.min(this.retryMaxMs, this.retryBaseMs * (2 ** Math.max(0, attempt - 1)));
    if (!this.jitter) return exponential;
    const spread = exponential * this.jitter;
    return Math.max(0, Math.round(exponential - spread + Math.random() * spread * 2));
  }

  start() {
    if (this.running) return this;
    this.running = true;
    this.controller = new AbortController();
    this.loopPromise = this._loop(this.controller.signal).finally(() => { this.running = false; this.loopPromise = null; });
    return this;
  }

  async _loop(signal) {
    while (!signal.aborted) {
      const result = await this.runOnce();
      if (!result.claimed) {
        try { await sleep(this.pollMs, signal, this.unrefTimers); }
        catch { break; }
      }
    }
  }

  async flush(options = {}) {
    const maxCycles = Math.max(1, Number(options.maxCycles) || 10_000);
    let cycles = 0;
    let total = 0;
    while (cycles++ < maxCycles) {
      const result = await this.runOnce();
      total += result.published;
      if (!result.claimed) return { drained: true, published: total, cycles };
      if (result.failed && options.stopOnFailure !== false) return { drained: false, published: total, cycles, failed: result.failed };
    }
    throw new EventTransportError('Outbox flush cycle limit exceeded', { code: 'EVENT_OUTBOX_FLUSH_LIMIT' });
  }

  async stop(options = {}) {
    this.controller?.abort(new Error('Outbox publisher stopped'));
    if (options.drain === true) await this.flush(options);
    try { await this.loopPromise; } catch {}
    await Promise.allSettled([...this.active]);
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({ running: this.running, owner: this.owner, active: this.active.size, stats: Object.freeze({ ...this.stats }), store: this.store.snapshot?.() || null });
  }

  async close(options = {}) { return this.stop(options); }
  async [Symbol.asyncDispose]() { await this.close(); }
}

export default OutboxPublisher;
