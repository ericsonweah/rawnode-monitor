import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

const taskRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const receiptPath = path.join(taskRoot, 'distribution.json');
const distribution = JSON.parse(await readFile(receiptPath, 'utf8'));
assert.equal(typeof distribution.installed?.package, 'string', 'Run distribution verification before the final Studio smoke.');
const packageRoot = path.resolve(distribution.installed.package);
const fixturePath = path.join(packageRoot, 'examples/studio-fixture.mjs');
const { createStudioFixture } = await import(pathToFileURL(fixturePath));
const results = { startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, distributionReceipt: receiptPath, distribution, fixturePath, scope: 'Actual loopback HTTP and SSE protocol; browser execution and native EventSource reconnection remain unverified.', checks: [] };
let fixture;
const record = (name, details = {}) => { results.checks.push({ name, passed: true, ...details }); };
async function bounded(promise, ms = 3000) { let timeout; try { return await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Fixture operation exceeded ${ms} ms.`)), ms); })]); } finally { clearTimeout(timeout); } }
let reader;
let streamAbort;
try {
  fixture = await bounded(createStudioFixture());
  const origin = new URL(fixture.url).origin;
  const request = (url, options = {}) => fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(3000) });
  const json = async (url, options) => { const response = await request(url, options); const text = await response.text(); return { status: response.status, headers: response.headers, text, body: JSON.parse(text) }; };
  const state = async () => (await json(`${origin}/fixture/status`)).body;
  const mode = async value => { const response = await request(`${origin}/fixture/mode?mode=${value}`, { method: 'POST' }); assert.equal(response.status, 200); await response.text(); };
  const initial = await state(); assert.equal(initial.silences, 0); assert.equal(initial.mutationRequests, 0); assert.equal(initial.incidentState, 'open'); assert.equal(initial.alertState, 'firing'); assert.equal(initial.clients, 0);
  record('Synthetic fixture initial operator state', initial);
  const shell = await request(fixture.url); const html = await shell.text(); assert.equal(shell.status, 200); assert.match(html, /Local fixture &lt;img/); assert.match(html, /\/fixture\/client\.js/); assert.match(shell.headers.get('content-security-policy'), /script-src 'self'; style-src 'self'/);
  record('Packaged shell and escaped identity', { status: shell.status, csp: shell.headers.get('content-security-policy') });
  for (const [asset, contentType] of [['studio.js', 'javascript'], ['studio.css', 'text/css']]) { const response = await request(`${fixture.url}/assets/${asset}`); const content = await response.text(); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), new RegExp(contentType)); if (asset === 'studio.js') { assert.match(content, /mountMonitorStudio/); assert.match(content, /<progress class="rn-bar"/); assert.equal(content.includes('<i style='), false); } record(`Packaged ${asset}`, { status: response.status, bytes: Buffer.byteLength(content) }); }
  const controls = await request(`${origin}/fixture/client.js`); const harness = await controls.text(); assert.equal(controls.status, 200); for (const control of ['unmount', 'mount', 'cycle', 'empty', 'error', 'delayed', 'recover', 'disconnect']) assert.ok(harness.includes(`fixture-${control}`)); record('Portable fixture controls are served', { status: controls.status, controls: ['unmount', 'mount', 'cycle', 'empty', 'error', 'delayed', 'recover', 'disconnect'], execution: 'Source/HTTP inspection only; controls were not clicked in a browser.' });
  const endpoints = ['overview', 'metrics', 'traces', 'signals', 'health', 'resources', 'alerts', 'slos', 'incidents', 'fleet', 'deployments', 'anomalies', 'synthetics', 'diagnostics', 'doctor'];
  for (const endpoint of endpoints) { const response = await json(`${fixture.url}/api/${endpoint}`); assert.equal(response.status, 200, endpoint); assert.equal(response.text.includes('fixture-secret'), false, endpoint); record(`API ${endpoint}`, { status: response.status }); }
  const traces = (await json(`${fixture.url}/api/traces`)).body.data; assert.ok(traces.length); const trace = await json(`${fixture.url}/api/traces/${encodeURIComponent(traces[0].traceId)}`); assert.equal(trace.status, 200); assert.equal(trace.text.includes('fixture-secret'), false); assert.ok(trace.body.data.some(span => span.attributes?.token === '[REDACTED]')); record('Trace detail redacts synthetic token', { status: trace.status, spans: trace.body.data.length });
  const denied = await json(`${fixture.url}/api/overview`, { headers: { origin: 'https://evil.invalid' } }); assert.equal(denied.status, 403); record('Read origin enforcement', { status: denied.status });
  const ingest = await json(`${fixture.url}/api/ingest`, { method: 'POST', body: '{}' }); assert.equal(ingest.status, 404); record('Remote ingestion disabled', { status: ingest.status });
  await mode('empty'); const empty = await json(`${fixture.url}/api/traces`); assert.deepEqual(empty.body.data, []); record('Empty traces mode', { status: empty.status });
  await mode('error'); const error = await json(`${fixture.url}/api/overview`); assert.equal(error.status, 503); assert.match(error.body.error.message, /Fixture unavailable/); record('Controlled HTTP failure mode', { status: error.status, note: 'Error text contains synthetic HTML for client escaping checks; no browser rendering claim.' });
  await mode('delayed'); const before = performance.now(); const delayed = await json(`${fixture.url}/api/health`); const elapsedMs = performance.now() - before; assert.equal(delayed.status, 200); assert.ok(elapsedMs >= 400, 'The fixture inserts a 500 ms delay.'); record('Delayed HTTP request mode', { status: delayed.status, elapsedMs });
  const cancel = new AbortController(); const pending = request(`${fixture.url}/api/overview`, { signal: cancel.signal }); cancel.abort(); await assert.rejects(pending, { name: 'AbortError' }); record('HTTP client cancellation', { note: 'Abort of a task-owned read request; this is not browser navigation validation.' });
  await mode('seeded'); const recovery = await json(`${fixture.url}/api/overview`); assert.equal(recovery.status, 200); record('HTTP recovery', { status: recovery.status });

  async function openStream() {
    streamAbort = new AbortController();
    const response = await bounded(fetch(`${fixture.url}/api/stream`, { signal: streamAbort.signal })); assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    reader = response.body.getReader(); let buffer = ''; const decoder = new TextDecoder();
    return async function nextEvent() { for (let count = 0; count < 20; count++) { const boundary = buffer.indexOf('\n\n'); if (boundary >= 0) { const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); const event = /^event: (.+)$/m.exec(frame)?.[1]; const data = /^data: (.+)$/m.exec(frame)?.[1]; if (event) return { event, data: data ? JSON.parse(data) : null, frame }; continue; } const chunk = await bounded(reader.read()); if (chunk.done) return null; buffer += decoder.decode(chunk.value, { stream: true }); } throw new Error('No bounded SSE event was received.'); };
  }
  let nextEvent = await openStream(); const ready = await nextEvent(); assert.equal(ready.event, 'ready'); assert.equal((await state()).clients, 1); record('Actual SSE ready frame', { event: ready.event, state: ready.data.state });
  fixture.monitor.emitSignal('health', { name: 'synthetic-stream-probe', token: 'fixture-secret-stream' }); await fixture.studio.drainEvents(); const signal = await nextEvent(); assert.equal(signal.event, 'signal'); assert.equal(signal.data.kind, 'health'); assert.equal(signal.frame.includes('fixture-secret'), false); record('Actual SSE signal frame', { event: signal.event, kind: signal.data.kind });
  const disconnected = await request(`${origin}/fixture/disconnect`, { method: 'POST' }); assert.equal(disconnected.status, 200); await disconnected.text(); assert.equal(await nextEvent(), null); assert.equal((await state()).clients, 0); await reader.cancel(); streamAbort.abort(); reader = null; record('SSE server disconnect closes protocol stream and removes client');
  nextEvent = await openStream(); assert.equal((await nextEvent()).event, 'ready'); assert.equal((await state()).clients, 1); await reader.cancel(); streamAbort.abort(); reader = null;
  for (let attempt = 0; attempt < 50 && (await state()).clients !== 0; attempt++) await delay(2);
  assert.equal((await state()).clients, 0); record('SSE manual reconnect and client cancellation cleanup', { note: 'A fresh HTTP stream was opened manually; native EventSource reconnection was not executed.' });
  results.beforeClose = await state();
  await bounded(fixture.close()); await bounded(fixture.close()); assert.equal(fixture.server.listening, false); assert.equal(fixture.studio.clients.size, 0); assert.equal(fixture.monitor.listenerCount('signal'), 0); assert.equal(fixture.monitor.closed, true); assert.equal(fixture.monitor.timers.size, 0);
  record('Idempotent fixture close releases server, stream clients, signal listener and runtime timers');
  results.status = 'passed';
} catch (error) {
  results.status = 'failed'; results.error = { name: error.name, code: error.code || null, message: error.message, stack: error.stack }; process.exitCode = 1;
} finally {
  try { await reader?.cancel(); } catch {}
  streamAbort?.abort();
  try { await bounded(fixture?.close()); } catch (error) { results.cleanupError = error.message; process.exitCode = 1; }
  results.finishedAt = new Date().toISOString(); results.checkCount = results.checks.length;
  await writeFile(path.join(taskRoot, 'studio-final-smoke.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(JSON.stringify({ status: results.status, checks: results.checkCount, node: process.version, installedPackage: packageRoot, evidence: path.join(taskRoot, 'studio-final-smoke.json'), error: results.error?.message, cleanupError: results.cleanupError }));
}
