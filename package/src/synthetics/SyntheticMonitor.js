'use strict';

import { EventEmitter } from 'node:events';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { SignalKind } from '../constants.js';
import SyntheticCheck from './SyntheticCheck.js';
import { boundedInteger, deepFreeze, errorRecord, randomId, withTimeout } from '../support.js';

/** Scheduled zero-dependency HTTP/TCP/DNS/custom synthetic monitoring. */
export class SyntheticMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.enabled = options.enabled === true;
    this.signal = options.signal || null;
    this.registry = options.registry || null;
    this.defaultIntervalMs = boundedInteger(options.intervalMs || options.defaultIntervalMs, 60_000, 1_000, 24 * 60 * 60_000);
    this.defaultTimeoutMs = boundedInteger(options.timeoutMs, 10_000, 100, 10 * 60_000);
    this.maxChecks = boundedInteger(options.maxChecks, 10_000, 1, 100_000);
    this.maxWaiters = boundedInteger(options.maxWaiters, this.maxChecks, 1, 100_000);
    this.concurrency = boundedInteger(options.concurrency, 8, 1, 1_024);
    this.historyLimit = boundedInteger(options.historyLimit, 5_000, 1, 1_000_000);
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes, 256 * 1024, 1_024, 64 * 1024 * 1024);
    this.checks = new Map();
    this.states = new Map();
    this.history = [];
    this.timers = new Map();
    this.controllers = new Set();
    this.controllerChecks = new Map();
    this.running = false;
    this.closed = false;
    this.frozen = false;
    this.inFlight = 0;
    this.waiters = [];
    this.stats = { runs: 0, succeeded: 0, failed: 0, skipped: 0, timeouts: 0, alerts: 0, recoveries: 0 };
    this.instruments = this.registry ? registerInstruments(this.registry) : null;
  }

  register(input, options = {}) {
    if (this.closed) throw Object.assign(new Error('Synthetic monitor is closed.'), { code: 'MONITOR_CLOSED' });
    if (this.frozen) throw new Error('Synthetic monitor definitions are frozen.');
    const check = input instanceof SyntheticCheck ? input : new SyntheticCheck(input, { intervalMs: this.defaultIntervalMs, timeoutMs: this.defaultTimeoutMs });
    if (this.checks.size >= this.maxChecks && !this.checks.has(check.id)) throw new Error(`Synthetic check limit of ${this.maxChecks} exceeded.`);
    if (this.checks.has(check.id) && options.replace !== true) throw new Error(`Synthetic check '${check.id}' is already registered.`);
    if (this.checks.has(check.id)) this.unregister(check.id);
    this.checks.set(check.id, check);
    this.states.set(check.id, this.states.get(check.id) || state(check));
    if (this.running && check.enabled) this._schedule(check, options.immediate !== false ? 0 : check.intervalMs);
    return check;
  }

  unregister(id) {
    const key = String(id);
    const check = this.checks.get(key);
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.states.delete(key);
    const removed = this.checks.delete(key);
    if (check) {
      const error = Object.assign(new Error(`Synthetic check '${key}' was unregistered.`), { code: 'MONITOR_SYNTHETIC_UNREGISTERED' });
      for (const [controller, activeCheck] of this.controllerChecks) if (activeCheck === check) controller.abort(error);
      for (const waiter of [...this.waiters]) if (waiter.check === check) waiter.cancel(error);
    }
    return removed;
  }

  start(options = {}) {
    if (!this.enabled || this.running || this.closed) return this;
    this.running = true;
    for (const check of this.checks.values()) if (check.enabled) this._schedule(check, options.immediate === false ? check.intervalMs : randomJitter(check.jitterMs));
    return this;
  }

  _schedule(check, wait) {
    if (!this.running || this.closed || !check.enabled || this.checks.get(check.id) !== check) return;
    clearTimeout(this.timers.get(check.id));
    const timer = setTimeout(async () => {
      this.timers.delete(check.id);
      try { await this.run(check.id); } catch {}
      this._schedule(check, check.intervalMs + randomJitter(check.jitterMs));
    }, Math.max(0, wait));
    timer.unref?.();
    this.timers.set(check.id, timer);
  }

  async run(id, options = {}) {
    if (this.closed) throw Object.assign(new Error('Synthetic monitor is closed.'), { code: 'MONITOR_CLOSED' });
    options.signal?.throwIfAborted();
    const check = typeof id === 'string' ? this.checks.get(id) : id;
    if (!check || this.checks.get(check.id) !== check) throw new Error(`Synthetic check '${String(id)}' is not registered.`);
    if (!check.enabled && options.force !== true) { this.stats.skipped++; return null; }
    const timeoutMs = boundedInteger(options.timeoutMs, check.timeoutMs, 1, 600_000);
    const deadline = Date.now() + timeoutMs;
    await this._acquire(options.signal, check, timeoutMs);
    if (this.closed || options.signal?.aborted || this.checks.get(check.id) !== check) { this._release(); throw options.signal?.reason || Object.assign(new Error('Synthetic monitor or check is closed.'), { code: 'MONITOR_CLOSED' }); }
    const controller = new AbortController();
    this.controllers.add(controller);
    this.controllerChecks.set(controller, check);
    const external = options.signal;
    const abort = () => controller.abort(external.reason);
    external?.addEventListener?.('abort', abort, { once: true });
    const started = performance.now();
    const startedAt = Date.now();
    let result;
    let startedExecution = false;
    let released = false;
    const release = () => { if (!released) { released = true; this._release(); } };
    try {
      const details = await withTimeout((signal) => {
        startedExecution = true;
        // A callback ignoring cancellation keeps its physical slot until it
        // settles. Repeated timed-out runs cannot accumulate unlimited work.
        const operation = Promise.resolve().then(() => { signal.throwIfAborted(); return execute(check, { signal, maxResponseBytes: this.maxResponseBytes }); });
        return operation.finally(release);
      }, Math.max(1, deadline - Date.now()), { signal: controller.signal, message: `Synthetic check '${check.id}' exceeded ${timeoutMs}ms.` });
      result = createResult(check, true, startedAt, performance.now() - started, details, null);
      this.stats.succeeded++;
    } catch (error) {
      result = createResult(check, false, startedAt, performance.now() - started, null, errorRecord(error));
      this.stats.failed++;
      if (error?.code === 'MONITOR_TIMEOUT') this.stats.timeouts++;
    } finally {
      external?.removeEventListener?.('abort', abort);
      this.controllers.delete(controller);
      this.controllerChecks.delete(controller);
      if (!startedExecution) release();
    }
    this.stats.runs++;
    if (this.closed || this.checks.get(check.id) !== check) return result;
    this._record(result);
    this._transition(check, result);
    this.emit('result', result);
    this.signal?.(SignalKind.SYNTHETIC, result, { timestamp: startedAt, priority: result.ok ? 1 : check.severity === 'critical' ? 20 : 10 });
    return result;
  }

  async runAll(options = {}) {
    const checks = Array.from(this.checks.values()).filter((check) => check.enabled || options.force === true);
    return await Promise.all(checks.map((check) => this.run(check, options).catch((error) => ({ ok: false, checkId: check.id, error: errorRecord(error) }))));
  }

  _transition(check, result) {
    const current = this.states.get(check.id) || state(check);
    current.last = result;
    current.lastRunAt = result.startedAt;
    if (result.ok) {
      current.consecutiveSuccesses++;
      current.consecutiveFailures = 0;
      if (current.firing && current.consecutiveSuccesses >= check.recoveryThreshold) {
        current.firing = false;
        current.recoveredAt = Date.now();
        this.stats.recoveries++;
        const event = deepFreeze({ checkId: check.id, check: check.name, state: 'recovered', severity: check.severity, result, timestamp: Date.now() });
        this.emit('recovery', event);
        this.signal?.(SignalKind.SYNTHETIC, event, { priority: 2 });
      }
    } else {
      current.consecutiveFailures++;
      current.consecutiveSuccesses = 0;
      if (!current.firing && current.consecutiveFailures >= check.failureThreshold) {
        current.firing = true;
        current.firedAt = Date.now();
        this.stats.alerts++;
        const event = deepFreeze({ checkId: check.id, check: check.name, state: 'firing', severity: check.severity, result, timestamp: Date.now() });
        this.emit('failureThreshold', event);
        this.signal?.(SignalKind.SYNTHETIC, event, { priority: check.severity === 'critical' ? 20 : 10 });
      }
    }
    this.states.set(check.id, current);
  }

  _record(result) {
    this.history.push(result);
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    const labels = { check: result.checkId, type: result.type };
    this.instruments?.runs.inc({ ...labels, outcome: result.ok ? 'success' : 'failure' });
    this.instruments?.duration.record(result.durationMs / 1_000, labels);
    this.instruments?.up.set(result.ok ? 1 : 0, labels);
  }

  async _acquire(signal, check, timeoutMs) {
    signal?.throwIfAborted?.();
    if (this.inFlight < this.concurrency) { this.inFlight++; return; }
    if (this.waiters.length >= this.maxWaiters) throw Object.assign(new Error('Synthetic waiting-run capacity exceeded.'), { code: 'MONITOR_SYNTHETIC_WAITER_LIMIT' });
    await new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, check, abort: null, timer: null, cancel: null };
      const cleanup = () => { clearTimeout(waiter.timer); signal?.removeEventListener?.('abort', waiter.abort); };
      waiter.resolve = () => { cleanup(); resolve(); };
      waiter.cancel = (error) => { const index = this.waiters.indexOf(waiter); if (index !== -1) this.waiters.splice(index, 1); cleanup(); reject(error); };
      waiter.abort = () => waiter.cancel(signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Synthetic check was aborted.'), { code: 'ABORT_ERR' }));
      waiter.timer = setTimeout(() => waiter.cancel(Object.assign(new Error('Synthetic run exceeded its deadline while waiting for capacity.'), { code: 'MONITOR_TIMEOUT' })), timeoutMs);
      signal?.addEventListener?.('abort', waiter.abort, { once: true });
      this.waiters.push(waiter);
    });
  }
  _release() { const waiter = this.closed ? null : this.waiters.shift(); if (waiter) waiter.resolve(); else this.inFlight = Math.max(0, this.inFlight - 1); }

  alertRule(id, options = {}) {
    const check = this.checks.get(String(id));
    if (!check) return null;
    return {
      id: options.id || `synthetic:${check.id}`,
      name: options.name || `Synthetic check failing: ${check.name}`,
      severity: options.severity || check.severity,
      source: 'custom',
      incident: options.incident ?? check.incident,
      runbook: options.runbook || check.runbook,
      tags: [...check.tags, 'synthetic'],
      evaluate: () => {
        const current = this.states.get(check.id);
        return { firing: current?.firing === true, value: current?.consecutiveFailures || 0, details: current || null };
      },
    };
  }

  health() {
    const states = Array.from(this.states.values());
    const criticalFailures = states.filter((entry) => entry.critical && entry.firing);
    const failures = states.filter((entry) => entry.firing);
    return deepFreeze({ ok: criticalFailures.length === 0, ready: criticalFailures.length === 0, live: !this.closed, degraded: failures.length > 0, state: this.running ? 'running' : this.closed ? 'closed' : 'idle', checks: states.length, failing: failures.map((entry) => entry.id), critical: criticalFailures.map((entry) => entry.id) });
  }

  freeze() { this.frozen = true; return this; }
  snapshot(options = {}) { return deepFreeze({ enabled: this.enabled, running: this.running, closed: this.closed, frozen: this.frozen, concurrency: this.concurrency, inFlight: this.inFlight, waiters: this.waiters.length, maxWaiters: this.maxWaiters, checks: Array.from(this.checks.values()), states: Array.from(this.states.values(), (entry) => ({ ...entry })), history: options.includeHistory ? this.history.slice(-(options.limit || 100)) : undefined, stats: { ...this.stats } }); }

  async close() {
    if (this.closed) return this.snapshot();
    this.running = false; this.closed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const controller of this.controllers) controller.abort(Object.assign(new Error('Synthetic monitor closed.'), { code: 'MONITOR_SYNTHETIC_CLOSED' }));
    this.controllers.clear();
    this.controllerChecks.clear();
    for (const waiter of [...this.waiters]) waiter.cancel(Object.assign(new Error('Synthetic monitor closed.'), { code: 'MONITOR_SYNTHETIC_CLOSED' }));
    this.removeAllListeners();
    return this.snapshot();
  }
}

async function execute(check, context) {
  if (check.type === 'http') return await httpCheck(check.options, context);
  if (check.type === 'tcp') return await tcpCheck(check.options, context);
  if (check.type === 'dns') return await dnsCheck(check.options, context);
  return await check.options.run({ check, signal: context.signal });
}

async function httpCheck(options, context, redirects = 0) {
  const url = new URL(options.url);
  const transport = url.protocol === 'https:' ? https : http;
  const timings = Object.create(null);
  const started = performance.now();
  return await new Promise((resolve, reject) => {
    let settled = false; const chunks = []; let bytes = 0;
    const finish = (error, value) => { if (settled) return; settled = true; context.signal?.removeEventListener?.('abort', onAbort); error ? reject(error) : resolve(value); };
    const request = transport.request({ protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`, method: String(options.method || 'GET').toUpperCase(), headers: options.headers || {}, rejectUnauthorized: options.rejectUnauthorized !== false, family: options.family, servername: options.servername }, (response) => {
      timings.ttfbMs = performance.now() - started;
      const status = Number(response.statusCode || 0);
      response.once('error', (error) => finish(error));
      if (isRedirect(status) && options.followRedirects !== false && response.headers.location && redirects < Math.max(0, Number(options.maxRedirects) || 3)) {
        // Do not leave the old response draining after handing cancellation
        // over to a redirect request.
        response.destroy();
        let next;
        try { next = new URL(response.headers.location, url); }
        catch { return finish(Object.assign(new Error('Synthetic redirect target is invalid.'), { code: 'MONITOR_SYNTHETIC_REDIRECT_UNSAFE' })); }
        if (!['http:', 'https:'].includes(next.protocol) || next.username || next.password) return finish(Object.assign(new Error('Synthetic redirect target is unsafe.'), { code: 'MONITOR_SYNTHETIC_REDIRECT_UNSAFE' }));
        if (url.protocol === 'https:' && next.protocol === 'http:') return finish(Object.assign(new Error('Synthetic redirects cannot downgrade HTTPS to HTTP.'), { code: 'MONITOR_SYNTHETIC_REDIRECT_DOWNGRADE' }));
        const method = String(options.method || 'GET').toUpperCase();
        const changeMethod = (status === 303 && method !== 'HEAD') || ([301, 302].includes(status) && method === 'POST');
        const crossOrigin = url.origin !== next.origin;
        if (crossOrigin && options.body != null && !changeMethod) return finish(Object.assign(new Error('Synthetic redirects cannot forward a request body to a different origin.'), { code: 'MONITOR_SYNTHETIC_REDIRECT_BODY' }));
        const headers = Object.fromEntries(Object.entries(options.headers || {}).filter(([key]) => {
          const name = key.toLowerCase();
          if (crossOrigin && (name === 'host' || /authorization|cookie|(?:^|[-_])(token|secret|credential|password|key)(?:$|[-_])/i.test(name))) return false;
          return !changeMethod || !['content-length', 'content-type', 'content-encoding', 'transfer-encoding'].includes(name);
        }));
        return finish(null, httpCheck({ ...options, url: next.href, headers, method: changeMethod ? 'GET' : method, body: changeMethod ? undefined : options.body }, context, redirects + 1));
      }
      response.on('data', (chunk) => { bytes += chunk.length; if (bytes <= context.maxResponseBytes) chunks.push(Buffer.from(chunk)); else request.destroy(Object.assign(new Error('Synthetic HTTP response exceeded the configured byte limit.'), { code: 'MONITOR_SYNTHETIC_RESPONSE_TOO_LARGE' })); });
      response.on('aborted', () => finish(Object.assign(new Error('Synthetic HTTP response aborted.'), { code: 'MONITOR_SYNTHETIC_ABORTED' })));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString(options.encoding || 'utf8');
        const okStatus = expectedStatus(status, options.expectedStatus ?? '2xx');
        const okBody = options.bodyIncludes == null || body.includes(String(options.bodyIncludes));
        if (!okStatus || !okBody) return finish(Object.assign(new Error(!okStatus ? `Unexpected HTTP status ${status}.` : 'Expected response content was not found.'), { code: !okStatus ? 'MONITOR_SYNTHETIC_STATUS' : 'MONITOR_SYNTHETIC_BODY', statusCode: status }));
        finish(null, { statusCode: status, headers: safeHeaders(response.headers), bytes, redirects, timings: { ...timings, totalMs: performance.now() - started }, bodyMatched: okBody });
      });
    });
    request.on('socket', (socket) => {
      const mark = (name) => { timings[name] = performance.now() - started; };
      socket.once('lookup', () => mark('dnsMs'));
      socket.once('connect', () => mark('connectMs'));
      socket.once('secureConnect', () => mark('tlsMs'));
    });
    request.once('error', (error) => finish(error));
    const onAbort = () => request.destroy(context.signal.reason instanceof Error ? context.signal.reason : Object.assign(new Error('Synthetic HTTP check aborted.'), { code: 'ABORT_ERR' }));
    context.signal?.addEventListener?.('abort', onAbort, { once: true });
    if (options.body != null) request.write(Buffer.isBuffer(options.body) ? options.body : String(options.body));
    request.end();
  });
}

async function tcpCheck(options, context) {
  const started = performance.now();
  return await new Promise((resolve, reject) => {
    let settled = false; const chunks = []; let bytes = 0;
    const socket = net.createConnection({ host: options.host, port: Number(options.port), family: options.family });
    const finish = (error, value) => { if (settled) return; settled = true; context.signal?.removeEventListener?.('abort', onAbort); socket.destroy(); error ? reject(error) : resolve(value); };
    socket.once('connect', () => {
      if (options.write != null) socket.write(Buffer.isBuffer(options.write) ? options.write : String(options.write));
      if (options.expect == null) finish(null, { host: options.host, port: Number(options.port), connected: true, bytes: 0, durationMs: performance.now() - started });
    });
    socket.on('data', (chunk) => { bytes += chunk.length; if (bytes > context.maxResponseBytes) return finish(Object.assign(new Error('Synthetic TCP response exceeded the configured byte limit.'), { code: 'MONITOR_SYNTHETIC_RESPONSE_TOO_LARGE' })); chunks.push(Buffer.from(chunk)); const body = Buffer.concat(chunks).toString(options.encoding || 'utf8'); if (body.includes(String(options.expect))) finish(null, { host: options.host, port: Number(options.port), connected: true, bytes, matched: true, durationMs: performance.now() - started }); });
    socket.once('error', (error) => finish(error));
    socket.once('end', () => { if (options.expect != null) finish(Object.assign(new Error('Synthetic TCP expectation was not observed.'), { code: 'MONITOR_SYNTHETIC_EXPECTATION' })); });
    const onAbort = () => finish(context.signal.reason instanceof Error ? context.signal.reason : Object.assign(new Error('Synthetic TCP check aborted.'), { code: 'ABORT_ERR' }));
    context.signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

async function dnsCheck(options, context) {
  context.signal?.throwIfAborted?.();
  const hostname = String(options.hostname || options.host);
  if (options.recordType) {
    const values = await dns.resolve(hostname, String(options.recordType));
    return { hostname, recordType: String(options.recordType), records: values.length, values: options.includeValues === true ? values.slice(0, 100) : undefined };
  }
  const values = await dns.lookup(hostname, { all: true, family: options.family || 0, verbatim: true });
  return { hostname, records: values.length, addresses: options.includeValues === true ? values.slice(0, 100) : undefined };
}

function createResult(check, ok, startedAt, durationMs, details, error) { return deepFreeze({ id: randomId('synthetic'), checkId: check.id, check: check.name, type: check.type, ok, startedAt, completedAt: Date.now(), durationMs, severity: check.severity, critical: check.critical, tags: check.tags, details, error }); }
function state(check) { return { id: check.id, name: check.name, type: check.type, critical: check.critical, firing: false, consecutiveFailures: 0, consecutiveSuccesses: 0, lastRunAt: null, firedAt: null, recoveredAt: null, last: null }; }
function randomJitter(max) { return max > 0 ? Math.floor(Math.random() * (max + 1)) : 0; }
function isRedirect(status) { return [301, 302, 303, 307, 308].includes(status); }
function expectedStatus(status, expected) { if (Array.isArray(expected)) return expected.map(Number).includes(status); if (typeof expected === 'number') return status === expected; if (typeof expected === 'string' && /^\dxx$/i.test(expected)) return Math.floor(status / 100) === Number(expected[0]); if (expected && typeof expected === 'object') return status >= Number(expected.min || 100) && status <= Number(expected.max || 599); return status >= 200 && status < 300; }
function safeHeaders(headers) { const output = {}; for (const key of ['content-type', 'content-length', 'server', 'date', 'location']) if (headers[key] != null) output[key] = String(headers[key]).slice(0, 1024); return output; }
function registerInstruments(registry) { return { runs: registry.counter('monitor_synthetic_checks_total'), duration: registry.histogram('monitor_synthetic_duration_seconds', { unit: 'seconds' }), up: registry.gauge('monitor_synthetic_up') }; }
export default SyntheticMonitor;
