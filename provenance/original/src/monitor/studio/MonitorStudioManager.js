'use strict';

import { EventEmitter } from 'node:events';
import BoundedSignalQueue from '../pipeline/BoundedSignalQueue.js';
import MonitorStudioAuthorizer from './MonitorStudioAuthorizer.js';
import MonitorStudioRateLimiter from './MonitorStudioRateLimiter.js';
import { bytesOf, cooperativeYield, deepFreeze, elapsedMs, errorRecord, nowNs } from '../support.js';

export class MonitorStudioManager extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.monitor) throw new TypeError('MonitorStudioManager requires monitor.');
    this.monitor = options.monitor;
    this.config = { ...this.monitor.configuration.get('studio', {}), ...(options.config || {}) };
    this.authorizer = options.authorizer || new MonitorStudioAuthorizer({ ...this.config, authorize: options.authorize });
    this.limiter = options.limiter || new MonitorStudioRateLimiter(this.config.rateLimit || {});
    this.clients = new Set();
    this.closed = false;
    this.closing = false;
    const eventQueueBytes = Number(this.config.eventQueueBytes) || 2 * 1024 * 1024;
    const eventMaxBytes = Math.min(Number(this.config.eventMaxBytes) || 64 * 1024, eventQueueBytes);
    this.eventQueue = new BoundedSignalQueue({
      maxItems: Number(this.config.eventQueueItems) || 2_000,
      maxBytes: eventQueueBytes,
      maxSignalBytes: eventMaxBytes,
      overflow: 'drop-oldest',
      sizeOf: (value) => bytesOf(value, eventMaxBytes + 1),
    });
    this.eventBatchSize = Math.max(1, Number(this.config.eventBatchSize) || 100);
    this.eventBudgetMs = Math.max(0.25, Number(this.config.eventBudgetMs) || 4);
    this.eventDrainPromise = null;
    this.stats = { requests: 0, unauthorized: 0, rateLimited: 0, streams: 0, streamDrops: 0, streamEventDrops: 0, streamEventBatches: 0 };
    this._signalListener = (signal) => this._queueSignal(summarizeSignal(signal));
    this.monitor.on('signal', this._signalListener);
  }

  async authorize(req, options = {}) {
    const key = req.ip || req.socket?.remoteAddress || 'anonymous';
    const admission = this.limiter.consume(key, options.mutate ? 5 : 1);
    if (!admission.ok) { this.stats.rateLimited++; return { ok: false, status: 429, code: 'MONITOR_STUDIO_RATE_LIMIT', message: 'Monitor Studio rate limit exceeded.', headers: { 'retry-after': String(Math.ceil(admission.retryAfterMs / 1_000)) } }; }
    const result = await this.authorizer.check(req, options);
    this.stats.requests++; if (!result.ok) this.stats.unauthorized++; return result;
  }

  async overview(options = {}) {
    const runtime = this.monitor.snapshot({ includeRecent: false, limit: options.limit || 50 });
    return deepFreeze({
      generatedAt: Date.now(),
      identity: runtime.identity,
      state: runtime.state,
      lifecycle: runtime.lifecycle,
      health: runtime.health,
      pipeline: runtime.pipeline,
      system: this.monitor.system.snapshot().current,
      fleet: runtime.fleet,
      deployment: runtime.deployment,
      alertSummary: summarizeAlerts(runtime.alerts),
      incidentSummary: summarizeIncidents(runtime.incidents),
      sloSummary: runtime.slos,
      anomalySummary: { active: runtime.anomalies?.length || 0, leaks: runtime.leaks?.length || 0 },
      syntheticSummary: { checks: runtime.synthetics?.states?.length || 0, failing: runtime.synthetics?.states?.filter?.((item) => item.firing).length || 0 },
      pluginSummary: { total: runtime.plugins?.plugins?.length || 0, failed: runtime.plugins?.plugins?.filter?.((item) => item.state === 'failed').length || 0 },
      resourceSummary: summarizeResources(runtime.resources),
      stats: runtime.stats,
    });
  }

  metrics(options = {}) { return this.monitor.metricsSnapshot(options); }
  traces(options = {}) { return this.monitor.tracer.query({ ...options, limit: Math.min(this.config.maxQueryLimit || 1_000, Number(options.limit) || 100) }); }
  trace(traceId) { return this.monitor.tracer.traceById(traceId); }
  signals(options = {}) { return this.monitor.query.signals({ ...options, limit: Math.min(this.config.maxQueryLimit || 1_000, Number(options.limit) || 100) }); }
  health(options = {}) { return this.monitor.health(options); }
  resources(name = null) { return name ? this.monitor.resources.latestSnapshot(name) : this.monitor.resources.snapshot(); }
  alerts(options = {}) { return { current: this.monitor.alerts.current(options), history: this.monitor.alerts.historySnapshot({ limit: options.limit || 100 }), silences: this.monitor.alerts.silences.snapshot() }; }
  acknowledgeAlert(id, actor) { return this.monitor.alerts.acknowledge(id, actor); }
  silence(input, actor) { return this.monitor.alerts.silences.create({ ...input, createdBy: actor?.id || actor?.userId || actor || null }); }
  removeSilence(id) { return this.monitor.alerts.silences.remove(id); }
  slos(id = null) { return id ? this.monitor.slos.get(id) : this.monitor.slos.snapshot(); }
  incidents(options = {}) { return { incidents: this.monitor.incidents.list(options), history: this.monitor.incidents.historySnapshot({ limit: options.limit || 100 }) }; }
  acknowledgeIncident(id, input = {}) { return this.monitor.incidents.acknowledge(id, input); }
  resolveIncident(id, input = {}) { return this.monitor.incidents.resolve(id, input); }
  annotateIncident(id, input = {}) { return this.monitor.incidents.annotate(id, input); }
  fleet() { return this.monitor.fleet.snapshot(); }
  deployments(options = {}) { return this.monitor.deployments.list(options); }
  anomalies(options = {}) { return { anomalies: this.monitor.anomalies.snapshot(options), leaks: this.monitor.leaks.snapshot(options) }; }
  synthetics(options = {}) { return this.monitor.synthetics.snapshot({ includeHistory: options.history === true, limit: Math.min(this.config.maxQueryLimit || 1_000, Number(options.limit) || 100) }); }
  runSynthetic(id, options = {}) { return id ? this.monitor.synthetics.run(id, options) : this.monitor.synthetics.runAll(options); }
  correlate(input = {}, options = {}) { return this.monitor.correlate(input, { ...options, limit: Math.min(this.config.maxQueryLimit || 1_000, Number(options.limit) || 500) }); }
  diagnostics(options = {}) { return this.monitor.diagnostics(options); }
  bundle(options = {}) { return this.monitor.diagnosticBundle(options); }
  doctor(options = {}) { return this.monitor.doctor(options); }

  stream(req, res) {
    const raw = res.raw || res;
    raw.writeHead?.(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const client = {
      raw,
      bytes: 0,
      maxBytes: Number(this.config.streamMaxBytes) || 1024 * 1024,
      closed: false,
      heartbeat: null,
      close: null,
      drain: null,
    };
    client.drain = () => { client.bytes = 0; };
    client.close = () => this._removeClient(client);
    this.clients.add(client);
    this.stats.streams++;
    raw.on?.('drain', client.drain);
    raw.once?.('close', client.close);
    raw.once?.('error', client.close);
    this._writeClient(client, `event: ready\ndata: ${JSON.stringify({ timestamp: Date.now(), state: this.monitor.state })}\n\n`);
    client.heartbeat = setInterval(() => this._writeClient(client, ': heartbeat\n\n'), 15_000);
    client.heartbeat.unref?.();
    return client;
  }

  broadcast(event, data) {
    const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) this._writeClient(client, text);
  }

  async drainEvents() {
    do {
      if (this.eventQueue.length && !this.eventDrainPromise) this._scheduleEventDrain();
      const active = this.eventDrainPromise;
      if (active) await active;
    } while (this.eventQueue.length || this.eventDrainPromise);
    return this.eventQueue.snapshot();
  }

  _queueSignal(signal) {
    if (this.closed || this.closing || !this.clients.size) return false;
    const result = this.eventQueue.tryPush(signal, { onDrop: () => { this.stats.streamEventDrops++; } });
    if (!result.accepted) return false;
    this._scheduleEventDrain();
    return true;
  }

  _scheduleEventDrain() {
    if (this.eventDrainPromise || this.closed) return;
    this.eventDrainPromise = new Promise((resolve) => queueMicrotask(resolve))
      .then(() => this._drainEventQueue())
      .catch((error) => { if (this.listenerCount('error') > 0) this.emit('error', error); else this.emit('streamError', errorRecord(error)); })
      .finally(() => {
        this.eventDrainPromise = null;
        if (this.eventQueue.length && !this.closed) this._scheduleEventDrain();
      });
  }

  async _drainEventQueue() {
    let sliceStarted = nowNs();
    while (!this.closed && this.eventQueue.length) {
      const batch = this.eventQueue.shiftMany(this.eventBatchSize);
      this.stats.streamEventBatches++;
      for (const signal of batch) this.broadcast('signal', signal);
      if (this.eventQueue.length && elapsedMs(sliceStarted) >= this.eventBudgetMs) {
        await cooperativeYield();
        sliceStarted = nowNs();
      }
    }
  }

  _writeClient(client, text) {
    if (client.closed) return false;
    const bytes = Buffer.byteLength(text);
    if (client.bytes + bytes > client.maxBytes) {
      this.stats.streamDrops++;
      this._removeClient(client);
      return false;
    }
    try {
      const accepted = client.raw.write?.(text);
      if (client.bytes > 0 || accepted === false) client.bytes += bytes;
      return accepted !== false;
    } catch {
      this._removeClient(client);
      return false;
    }
  }

  _removeClient(client) {
    if (client.closed) return;
    client.closed = true;
    clearInterval(client.heartbeat);
    client.heartbeat = null;
    this.clients.delete(client);
    client.raw.off?.('drain', client.drain);
    client.raw.off?.('close', client.close);
    client.raw.off?.('error', client.close);
    try { client.raw.end?.(); } catch {}
  }

  snapshot() { return deepFreeze({ closed: this.closed, closing: this.closing, clients: this.clients.size, eventQueue: this.eventQueue.snapshot(), limiter: this.limiter.snapshot(), stats: { ...this.stats } }); }
  async close() {
    if (this.closed || this.closing) return;
    this.closing = true;
    this.monitor.off?.('signal', this._signalListener);
    await this.drainEvents().catch(() => {});
    this.closed = true;
    this.closing = false;
    this.eventQueue.close();
    for (const client of [...this.clients]) this._removeClient(client);
  }
}
function summarizeSignal(signal) { return { id: signal.id, kind: signal.kind, timestamp: signal.timestamp, service: signal.service, instanceId: signal.instanceId, traceId: signal.traceId, priority: signal.priority }; }
function summarizeAlerts(rows = []) { return rows.reduce((out, row) => { out.total++; out[row.state] = (out[row.state] || 0) + 1; return out; }, { total: 0 }); }
function summarizeIncidents(rows = []) { return rows.reduce((out, row) => { out.total++; out[row.state] = (out[row.state] || 0) + 1; out[row.severity] = (out[row.severity] || 0) + 1; return out; }, { total: 0 }); }
function summarizeResources(resources = {}) { return Object.fromEntries(Object.entries(resources || {}).map(([name, value]) => [name, { ok: value?.health?.ok !== false && !value?.error, durationMs: value?.durationMs || null, error: value?.error ? errorRecord(value.error) : null }])); }
export default MonitorStudioManager;
