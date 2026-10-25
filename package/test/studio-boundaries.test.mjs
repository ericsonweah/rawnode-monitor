import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MonitorRuntime, MonitorStudioManager, MonitorStudioController, MonitorStudioRateLimiter } from '../src/index.js';

const request = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1' }, params: { asset: 'studio.js' } };
function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name] = value; };
  res.writeHead = status => { res.statusCode = status; res.headersSent = true; };
  res.write = () => true;
  res.end = value => { res.body = value; };
  return res;
}

test('Studio rate limiter bounds client keys for rejected and accepted admissions', () => {
  const limiter = new MonitorStudioRateLimiter({ capacity: 1, maxKeys: 2 });
  for (let index = 0; index < 20; index++) {
    const result = limiter.consume(`rejected-${index}`, 5, 1000 + index);
    assert.equal(result.ok, false);
    assert.ok(result.retryAfterMs > 0);
    assert.ok(limiter.snapshot().keys <= 2, 'Rejected clients obey the same key bound as accepted clients.');
  }
  assert.equal(limiter.snapshot().stats.rejected, 20);
  assert.equal(limiter.snapshot().stats.evicted, 18);
  assert.equal(limiter.consume('accepted', 1, 1020).ok, true);
  assert.equal(limiter.consume('accepted', 1, 1021).ok, false);
  assert.equal(limiter.snapshot().keys, 2);
  assert.equal(limiter.consume('accepted', 1, 61_020).ok, true, 'Ordinary refill remains available.');
});

test('Studio non-JSON route failures use the same bounded redaction before response admission', async t => {
  const monitor = new MonitorRuntime({ profile: 'test', logger: { warn() {}, error() {} } });
  const studio = new MonitorStudioManager({ monitor });
  t.after(async () => { await studio.close(); await monitor.close(); });
  const details = { token: 'fixture-secret-details', value: 42n }; details.self = details;
  const error = Object.assign(new Error('Bearer fixture-secret-message'), { code: 'MONITOR_FIXTURE_ROUTE', status: 503, details });
  const fail = () => { throw error; };
  const controller = new MonitorStudioController({ studio, assets: { read: async () => fail() } });
  monitor.prometheus = fail;
  studio.stream = fail;
  const get = monitor.configuration.get.bind(monitor.configuration);
  monitor.configuration.get = (key, fallback) => key === 'service' ? fail() : get(key, fallback);
  for (const route of ['asset', 'prometheus', 'stream', 'page']) {
    const res = response();
    await controller[route](request, res);
    assert.equal(res.statusCode, 503, route);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.ok(Buffer.byteLength(res.body) < 4096);
    assert.equal(res.body.includes('fixture-secret'), false);
    const payload = JSON.parse(res.body);
    assert.equal(payload.error.code, 'MONITOR_FIXTURE_ROUTE');
    assert.equal(payload.error.details.value, '42');
    assert.equal(payload.error.details.self, '[Circular]');
    assert.equal(Object.hasOwn(payload.error, 'stack'), false);
  }
  const started = response();
  studio.stream = (_req, res) => { res.writeHead(200); throw error; };
  await assert.rejects(controller.stream(request, started), candidate => candidate === error);
  assert.equal(started.body, undefined, 'A response already started is left to its transport owner, without a second JSON response.');
});

test('Studio stream capacity and close reject with a safe response and preserve owned client cleanup', async t => {
  const monitor = new MonitorRuntime({ profile: 'test', logger: { warn() {}, error() {} } });
  const studio = new MonitorStudioManager({ monitor, config: { maxClients: 1 } });
  t.after(async () => { await studio.close(); await monitor.close(); });
  const controller = new MonitorStudioController({ studio });
  const admitted = response();
  await controller.stream(request, admitted);
  assert.equal(admitted.statusCode, 200);
  assert.equal(studio.clients.size, 1);
  const rejected = response();
  await controller.stream(request, rejected);
  assert.equal(rejected.statusCode, 503);
  assert.equal(JSON.parse(rejected.body).error.code, 'MONITOR_STREAM_UNAVAILABLE');
  assert.equal(studio.clients.size, 1);
  await studio.close();
  assert.equal(studio.clients.size, 0);
  for (const event of ['close', 'error', 'drain']) assert.equal(admitted.listenerCount(event), 0);
  const closed = response();
  await controller.stream(request, closed);
  assert.equal(closed.statusCode, 503);
  assert.equal(JSON.parse(closed.body).error.code, 'MONITOR_STREAM_UNAVAILABLE');
});
