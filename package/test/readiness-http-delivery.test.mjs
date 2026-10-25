import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { HttpJsonExporter, SignalPipeline } from '../src/index.js';

async function endpoint(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}/telemetry`,
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

test('HTTP acknowledgement timeout reports uncertain delivery without repeating the request', { timeout: 2_000 }, async () => {
  let requests = 0;
  const target = await endpoint(request => { requests++; request.resume(); });
  const exporter = new HttpJsonExporter({ url: target.url, compression: false, timeoutMs: 100, maxAttempts: 3, retryBaseMs: 1, retryMaxMs: 1 });
  try {
    await assert.rejects(exporter.export([{ kind: 'event', id: 'received-without-ack' }]), error => {
      assert.equal(error.code, 'MONITOR_EXPORT_TIMEOUT');
      assert.equal(error.retryable, false);
      assert.equal(error.details.delivery, 'unknown');
      return true;
    });
    assert.equal(requests, 1);
    assert.equal(exporter.stats.retries, 0);
    assert.equal(exporter.stats.signals, 0);
  } finally { await exporter.close(); await target.close(); }
});

test('a failed split export does not make the pipeline replay its acknowledged prefix', { timeout: 2_000 }, async () => {
  const received = [];
  const target = await endpoint(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const id = JSON.parse(body).signals[0].id;
    received.push(id);
    response.writeHead(id === 'acknowledged' ? 200 : 503).end();
  });
  const exporter = new HttpJsonExporter({ url: target.url, compression: false, maxBatchSignals: 1, maxAttempts: 1 });
  const pipeline = new SignalPipeline({ deliveryAttempts: 3, retryBaseMs: 1, retryMaxMs: 1, maxInFlightBatches: 1 });
  pipeline.addSink('http', exporter, { required: true });
  try {
    pipeline.admit({ kind: 'event', id: 'acknowledged' });
    pipeline.admit({ kind: 'event', id: 'unacknowledged' });
    await assert.rejects(pipeline.flush({ throwOnError: true }), { code: 'MONITOR_PIPELINE_FLUSH_FAILED' });
    assert.deepEqual(received, ['acknowledged', 'unacknowledged']);
    assert.equal(pipeline.stats.sinkRetries, 0);
    assert.equal(exporter.stats.signals, 1);
    const failure = pipeline.snapshot().failures[0].error;
    assert.equal(failure.retryable, false);
    assert.equal(failure.details.acknowledgedSignals, 1);
    assert.equal(failure.details.unacknowledgedSignals, 1);
  } finally { await pipeline.close({ flush: false }); await target.close(); }
});

test('a truncated HTTP acknowledgement reports uncertainty without replaying accepted telemetry', { timeout: 2_000 }, async () => {
  let requests = 0;
  const target = await endpoint(async (request, response) => {
    for await (const _chunk of request) { /* Accept the complete payload. */ }
    requests++;
    response.writeHead(200, { 'content-length': '100' });
    response.write('partial', () => setImmediate(() => response.destroy()));
  });
  const exporter = new HttpJsonExporter({ url: target.url, compression: false, maxAttempts: 3, retryBaseMs: 1, retryMaxMs: 1 });
  try {
    await assert.rejects(exporter.export([{ kind: 'event', id: 'accepted-before-truncated-ack' }]), error => {
      assert.equal(error.retryable, false);
      assert.equal(error.details.delivery, 'unknown');
      return true;
    });
    assert.equal(requests, 1);
    assert.equal(exporter.stats.retries, 0);
    assert.equal(exporter.stats.signals, 0);
  } finally { await exporter.close(); await target.close(); }
});

test('a reset after sending the HTTP payload is not evidence that delivery failed', { timeout: 2_000 }, async () => {
  let requests = 0;
  const target = await endpoint(async request => {
    for await (const _chunk of request) { /* Accept the complete payload. */ }
    requests++;
    request.socket.destroy();
  });
  const exporter = new HttpJsonExporter({ url: target.url, compression: false, maxAttempts: 3, retryBaseMs: 1, retryMaxMs: 1 });
  try {
    await assert.rejects(exporter.export([{ kind: 'event', id: 'accepted-before-reset' }]), error => {
      assert.equal(error.code, 'ECONNRESET');
      assert.equal(error.retryable, false);
      assert.equal(error.details.delivery, 'unknown');
      return true;
    });
    assert.equal(requests, 1);
    assert.equal(exporter.stats.retries, 0);
  } finally { await exporter.close(); await target.close(); }
});

test('HTTP timeout bounds the whole request even while acknowledgement bytes keep arriving', { timeout: 2_000 }, async () => {
  let requests = 0;
  let completedResponses = 0;
  const target = await endpoint((request, response) => {
    requests++;
    request.resume();
    response.writeHead(200);
    response.write('start');
    let chunks = 0;
    const timer = setInterval(() => {
      response.write('.');
      if (++chunks === 20) {
        clearInterval(timer);
        completedResponses++;
        response.end();
      }
    }, 20);
    response.once('close', () => clearInterval(timer));
  });
  const exporter = new HttpJsonExporter({ url: target.url, compression: false, timeoutMs: 100, maxAttempts: 3, retryBaseMs: 1, retryMaxMs: 1 });
  try {
    await assert.rejects(exporter.export([{ kind: 'event', id: 'slow-acknowledgement' }]), error => {
      assert.equal(error.code, 'MONITOR_EXPORT_TIMEOUT');
      assert.equal(error.retryable, false);
      assert.equal(error.details.delivery, 'unknown');
      return true;
    });
    assert.equal(requests, 1);
    assert.equal(completedResponses, 0);
    assert.equal(exporter.stats.retries, 0);
    assert.equal(exporter.stats.signals, 0);
    assert.equal(exporter.pending.size, 0);
  } finally { await exporter.close(); await target.close(); }
});
