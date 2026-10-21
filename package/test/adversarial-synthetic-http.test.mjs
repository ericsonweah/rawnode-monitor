import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import SyntheticMonitor from '../src/synthetics/SyntheticMonitor.js';

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

test('real loopback cross-origin redirects strip sensitive headers and 303 removes body headers', async () => {
  const received = [];
  const target = await serve((req, res) => { let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { received.push({ headers: req.headers, method: req.method, body }); res.end('ok'); }); });
  const origin = await serve((req, res) => { req.resume(); res.writeHead(req.url === '/post' ? 303 : 302, { location: `${target.url}/target` }); res.end(); });
  const monitor = new SyntheticMonitor();
  try {
    monitor.register({ id: 'get', url: `${origin.url}/get`, headers: { Authorization: 'Bearer fixture-secret', Cookie: 'session=fixture', 'X-Api-Key': 'fixture-key', 'X-Token': 'fixture-token', Accept: 'text/plain' } });
    assert.equal((await monitor.run('get')).ok, true);
    monitor.register({ id: 'post', url: `${origin.url}/post`, method: 'POST', body: 'fixture-private-body', headers: { Authorization: 'Bearer fixture-secret', 'Content-Type': 'text/plain', 'Content-Length': '20' } });
    assert.equal((await monitor.run('post')).ok, true);
    assert.equal(received.length, 2);
    for (const row of received) for (const key of ['authorization', 'cookie', 'x-api-key', 'x-token']) assert.equal(row.headers[key], undefined);
    assert.equal(received[0].headers.accept, 'text/plain');
    assert.equal(received[1].method, 'GET');
    assert.equal(received[1].body, '');
    assert.equal(received[1].headers['content-type'], undefined);
    assert.equal(received[1].headers['content-length'], undefined);
  } finally { await monitor.close(); await origin.close(); await target.close(); }
});

test('real loopback synthetic redirects reject unsafe URLs and cross-origin body forwarding', async () => {
  let targetHits = 0;
  const target = await serve((_req, res) => { targetHits++; res.end('ok'); });
  const origin = await serve((req, res) => {
    req.resume();
    const location = req.url === '/credentials' ? `http://name:fixture@127.0.0.1:${target.server.address().port}/` : req.url === '/protocol' ? 'file:///tmp/fixture' : `${target.url}/`;
    res.writeHead(307, { location }); res.end();
  });
  const monitor = new SyntheticMonitor();
  try {
    for (const path of ['/credentials', '/protocol']) { monitor.register({ id: path, url: `${origin.url}${path}` }); assert.equal((await monitor.run(path)).error.code, 'MONITOR_SYNTHETIC_REDIRECT_UNSAFE'); }
    monitor.register({ id: 'body', url: `${origin.url}/body`, method: 'POST', body: 'fixture-secret' });
    assert.equal((await monitor.run('body')).error.code, 'MONITOR_SYNTHETIC_REDIRECT_BODY');
    assert.equal(targetHits, 0);
  } finally { await monitor.close(); await origin.close(); await target.close(); }
});

test('modeled HTTPS response rejects downgrade before a second request', async () => {
  const original = https.request;
  let requests = 0;
  https.request = (_options, callback) => {
    requests++;
    const request = new EventEmitter();
    request.write = () => {};
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => { const response = new EventEmitter(); response.statusCode = 302; response.headers = { location: 'http://127.0.0.1:1/' }; response.destroy = () => {}; callback(response); });
    return request;
  };
  const monitor = new SyntheticMonitor();
  try {
    monitor.register({ id: 'downgrade', url: 'https://127.0.0.1:1/', headers: { Authorization: 'Bearer fixture' } });
    assert.equal((await monitor.run('downgrade')).error.code, 'MONITOR_SYNTHETIC_REDIRECT_DOWNGRADE');
    assert.equal(requests, 1);
  } finally { https.request = original; await monitor.close(); }
});
