import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { HealthRegistry, HttpJsonExporter, JsonlTelemetryStore, MonitorRuntime } from '../src/index.js';

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

async function endpoint(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}/telemetry`,
    close: async () => {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

test('replaced health checks discard old cached results and retain registration identity', async () => {
  const health = new HealthRegistry();
  const oldDispose = health.register('database', () => ({ ok: true, details: { version: 'old' } }), {
    cacheTtlMs: 60_000, critical: true, tags: ['old'],
  });
  assert.equal((await health.ready()).ok, true);
  let replacementCalls = 0;
  const dispose = health.register('database', () => {
    replacementCalls++;
    return { ok: false, details: { version: 'replacement' } };
  }, { replace: true, cacheTtlMs: 0, critical: false, tags: ['new'] });
  const report = await health.ready();
  assert.equal(replacementCalls, 1);
  assert.equal(report.status, 'degraded');
  assert.equal(report.checks[0].critical, false);
  assert.deepEqual(report.checks[0].tags, ['new']);
  assert.deepEqual(report.checks[0].details, { version: 'replacement' });
  assert.equal(oldDispose(), false);
  assert.equal((await health.ready()).checks.length, 1);
  assert.equal(dispose(), true);
  assert.equal(dispose(), false);
  assert.equal((await health.ready()).checks.length, 0);
  health.register('explicit', () => true);
  assert.equal(health.unregister('explicit'), true);
});

test('a critical unhealthy replacement controls ordinary readiness immediately', async () => {
  const health = new HealthRegistry();
  health.register('database', () => true, { cacheTtlMs: 60_000 });
  await health.ready();
  health.register('database', () => false, { replace: true, cacheTtlMs: 0 });
  assert.equal((await health.ready()).ready, false);
});

test('late old health callback cannot populate a replacement cache', { timeout: 2_000 }, async () => {
  const health = new HealthRegistry();
  const began = deferred();
  const release = deferred();
  health.register('database', async () => { began.resolve(); await release.promise; return true; }, { cacheTtlMs: 60_000 });
  const oldReport = health.ready();
  await began.promise;
  let calls = 0;
  health.register('database', () => { calls++; return false; }, { replace: true, cacheTtlMs: 0 });
  release.resolve();
  await oldReport;
  assert.equal((await health.ready()).ready, false);
  assert.equal((await health.ready()).ready, false);
  assert.equal(calls, 2);
});

test('HTTP exporter close cancels retry backoff without admitting another request', { timeout: 2_000 }, async () => {
  let requests = 0;
  const target = await endpoint((_request, response) => {
    requests++;
    response.writeHead(requests === 1 ? 503 : 200).end();
  });
  const exporter = new HttpJsonExporter({ url: target.url, compression: false, retryBaseMs: 60, retryMaxMs: 60 });
  const firstResponse = deferred();
  const request = exporter._request.bind(exporter);
  exporter._request = async (...args) => { const result = await request(...args); firstResponse.resolve(); return result; };
  const exporting = exporter.export([{ kind: 'event', id: 'backoff' }]);
  const outcome = exporting.then(value => ({ value }), error => ({ error }));
  try {
    await firstResponse.promise;
    await nextTurn();
    await Promise.all([exporter.close(), exporter.close()]);
    assert.equal((await outcome).error?.code, 'MONITOR_EXPORTER_CLOSED');
    assert.equal(requests, 1);
    assert.equal(exporter.stats.retries, 0);
    assert.equal(exporter.stats.signals, 0);
    assert.equal(await exporter.export([{ kind: 'event' }]), false);
  } finally { await exporter.close(); await target.close(); }
});

test('HTTP exporter close between split chunks preserves acknowledged accounting and stops later chunks', { timeout: 2_000 }, async () => {
  let requests = 0;
  const target = await endpoint((_request, response) => { requests++; response.writeHead(200).end(); });
  const exporter = new HttpJsonExporter({ url: target.url, compression: false, maxBatchSignals: 1 });
  const acknowledged = deferred();
  const release = deferred();
  const request = exporter._request.bind(exporter);
  exporter._request = async (...args) => {
    const result = await request(...args);
    if (requests === 1) { acknowledged.resolve(); await release.promise; }
    return result;
  };
  const exporting = exporter.export([{ kind: 'event', id: 'first' }, { kind: 'event', id: 'second' }]);
  const outcome = exporting.then(value => ({ value }), error => ({ error }));
  try {
    await acknowledged.promise;
    const closed = exporter.close();
    release.resolve();
    await closed;
    assert.equal((await outcome).error?.code, 'MONITOR_EXPORTER_CLOSED');
    assert.equal(requests, 1);
    assert.equal(exporter.stats.batches, 1);
    assert.equal(exporter.stats.signals, 1);
  } finally { release.resolve(); await exporter.close(); await target.close(); }
});

test('HTTP exporter close during compression prevents the continuation from opening a request', { timeout: 2_000 }, async () => {
  let requests = 0;
  const target = await endpoint((_request, response) => { requests++; response.writeHead(200).end(); });
  const formatting = deferred();
  const exporter = new HttpJsonExporter({
    url: target.url, compressionThresholdBytes: 256,
    format(signals) { formatting.resolve(); return { signals, padding: 'x'.repeat(64 * 1024) }; },
  });
  const exporting = exporter.export([{ kind: 'event' }]);
  const outcome = exporting.then(value => ({ value }), error => ({ error }));
  try {
    await formatting.promise;
    await exporter.close();
    assert.equal((await outcome).error?.code, 'MONITOR_EXPORTER_CLOSED');
    assert.equal(requests, 0);
  } finally { await exporter.close(); await target.close(); }
});

test('HTTP exporter close aborts an active request and releases owned sockets', { timeout: 2_000 }, async () => {
  let requests = 0;
  const received = deferred();
  const disconnected = deferred();
  const target = await endpoint((request) => {
    requests++;
    request.socket.once('close', disconnected.resolve);
    request.resume();
    received.resolve();
  });
  const exporter = new HttpJsonExporter({ url: target.url, timeoutMs: 1_000, compression: false });
  const exporting = exporter.export([{ kind: 'event' }]);
  const outcome = exporting.then(value => ({ value }), error => ({ error }));
  try {
    await received.promise;
    await exporter.close();
    await disconnected.promise;
    await nextTurn();
    assert.equal((await outcome).error?.code, 'MONITOR_EXPORTER_CLOSED');
    assert.equal(requests, 1);
    assert.equal(Object.values(exporter.agent.sockets).flat().length, 0);
    assert.equal(Object.values(exporter.agent.freeSockets).flat().length, 0);
    assert.equal(exporter.stats.signals, 0);
  } finally { await exporter.close(); await target.close(); }
});

test('HTTP exporter still retries and acknowledges ordinary requests before close', { timeout: 2_000 }, async () => {
  let requests = 0;
  const target = await endpoint((_request, response) => { requests++; response.writeHead(requests === 1 ? 503 : 200).end(); });
  const exporter = new HttpJsonExporter({ url: target.url, compression: false, retryBaseMs: 1, retryMaxMs: 1 });
  try {
    assert.equal(await exporter.export([{ kind: 'event' }]), true);
    assert.equal(requests, 2);
    assert.equal(exporter.stats.retries, 1);
    assert.equal(exporter.stats.signals, 1);
    assert.equal(exporter.stats.errors, 0);
  } finally { await exporter.close(); await target.close(); }
});

test('runtime-owned HTTP exporter remains terminal when runtime closes during a request', { timeout: 2_000 }, async () => {
  const received = deferred();
  let requests = 0;
  const target = await endpoint(request => { requests++; request.resume(); received.resolve(); });
  const monitor = new MonitorRuntime({ profile: 'test', logger: { warn() {}, error() {} } });
  const exporter = new HttpJsonExporter({ url: target.url, compression: false, retryBaseMs: 60 });
  monitor.registerExporter('controlled', exporter, { maxAttempts: 1, timeoutMs: 1_000 });
  try {
    monitor.emitEvent('shutdown');
    const flushing = monitor.flush({ timeoutMs: 1_000 });
    const outcome = flushing.then(value => ({ value }), error => ({ error }));
    await received.promise;
    await monitor.close({ flush: false, timeoutMs: 500 });
    await outcome;
    assert.equal(exporter.closed, true);
    assert.equal(requests, 1);
    assert.equal(monitor.pipeline.inFlight.size, 0);
    assert.equal(await exporter.export([{ kind: 'event' }]), false);
  } finally { await monitor.close({ flush: false, timeoutMs: 500 }); await target.close(); }
});

test('JSONL close closes admission synchronously and drains writes deferred in initialization', { timeout: 2_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'monitor-jsonl-drain-'));
  const store = new JsonlTelemetryStore({ path: root });
  const began = deferred();
  const release = deferred();
  const initialize = store.initialize.bind(store);
  store.initialize = async () => { began.resolve(); await release.promise; return await initialize(); };
  const writing = store.writeMany([{ kind: 'event', id: 'accepted' }, { kind: 'health', id: 'also-accepted' }]);
  try {
    await began.promise;
    let settled = false;
    const closed = store.close().then(value => { settled = true; return value; });
    const repeated = store.close();
    await nextTurn();
    const wasSettledBeforeRelease = settled;
    const late = await store.writeMany([{ kind: 'event', id: 'late' }]);
    release.resolve();
    assert.deepEqual(await writing, { written: 2 });
    await Promise.all([closed, repeated]);
    assert.equal(wasSettledBeforeRelease, false);
    assert.deepEqual(late, { written: 0, closed: true });
    const files = await readdir(root);
    const rows = (await Promise.all(files.map(file => readFile(path.join(root, file), 'utf8')))).join('');
    assert.match(rows, /accepted/);
    assert.match(rows, /also-accepted/);
    assert.doesNotMatch(rows, /"late"/);
    assert.equal(store.chains.size, 0);
  } finally { release.resolve(); await writing.catch(() => {}); await store.close(); await rm(root, { recursive: true, force: true }); }
});

test('JSONL flush includes writes admitted before initialization starts', { timeout: 2_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'monitor-jsonl-flush-'));
  const store = new JsonlTelemetryStore({ path: root });
  const release = deferred();
  const initialize = store.initialize.bind(store);
  store.initialize = async () => { await release.promise; return await initialize(); };
  const writing = store.write({ kind: 'event', id: 'accepted' });
  let flushed = false;
  const flushing = store.flush().then(value => { flushed = true; return value; });
  try {
    await nextTurn();
    const flushedBeforeRelease = flushed;
    release.resolve();
    await Promise.all([writing, flushing]);
    assert.equal(flushedBeforeRelease, false);
    assert.equal(store.stats.written, 1);
  } finally { release.resolve(); await writing.catch(() => {}); await store.close(); await rm(root, { recursive: true, force: true }); }
});
