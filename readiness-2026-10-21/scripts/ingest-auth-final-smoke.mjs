import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const taskRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distribution = JSON.parse(await readFile(path.join(taskRoot, 'distribution.json'), 'utf8'));
const packageRoot = path.resolve(distribution.installed.package);
const { createStudioFixture } = await import(pathToFileURL(path.join(packageRoot, 'examples/studio-fixture.mjs')));
const result = { startedAt: new Date().toISOString(), node: process.version, archive: distribution.archive, sha256: distribution.sha256, bytes: distribution.bytes, installedPackage: packageRoot, scope: 'Actual task-owned loopback HTTP using the unchanged final installed package; synthetic HMAC and bearer credentials only; no browser execution or live production ingestion.', checks: [] };
const record = (name, details = {}) => result.checks.push({ name, passed: true, ...details });
const syntheticSecret = 'task-owned-hmac-key-2026-10-21';
const syntheticToken = 'task-owned-operator-token-2026-10-21';
let fixture;
try {
  fixture = await createStudioFixture();
  const origin = new URL(fixture.url).origin;
  const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(3000) });
  const parsed = async (response, expectedStatus) => { assert.equal(response.status, expectedStatus); const text = await response.text(); assert.ok(Buffer.byteLength(text) < (expectedStatus >= 400 ? 4096 : 2 * 1024 * 1024 + 512)); assert.equal(text.includes(syntheticSecret), false); assert.equal(text.includes(syntheticToken), false); const payload = JSON.parse(text); assert.equal(Object.hasOwn(payload.error || {}, 'stack'), false); return payload; };

  fixture.studio.authorizer.token = syntheticToken;
  let response = await request(fixture.url); const unauthenticated = await parsed(response, 401); assert.equal(unauthenticated.error.code, 'MONITOR_STUDIO_UNAUTHORIZED'); record('Token-required shell rejects navigation without bearer', { status: 401 });
  response = await request(fixture.url, { headers: { authorization: `Bearer ${syntheticToken}` } }); assert.equal(response.status, 200); const shell = await response.text(); assert.match(shell, /data-token-required="true"/); assert.equal(shell.includes(syntheticToken), false); record('Token-required shell accepts explicit synthetic Authorization header', { status: 200, credentialTransport: 'HTTP header only; no URL or persistent storage.' });
  await parsed(await request(`${fixture.url}/assets/studio.js`), 401); record('Token-required assets require authorization', { status: 401 });
  response = await request(`${fixture.url}/assets/studio.js`, { headers: { authorization: `Bearer ${syntheticToken}` } }); assert.equal(response.status, 200); await response.text(); record('Token-required assets accept explicit synthetic Authorization header', { status: 200 });
  await parsed(await request(`${fixture.url}/api/overview`, { headers: { authorization: `Bearer ${syntheticToken}`, origin: 'https://evil.invalid' } }), 403); record('Bearer authorization preserves origin enforcement', { status: 403 });
  await parsed(await request(`${fixture.url}/api/incidents/fixture-incident/resolve`, { method: 'POST', headers: { authorization: `Bearer ${syntheticToken}`, origin: 'https://evil.invalid', 'content-type': 'application/json' }, body: '{}' }), 403); assert.equal(fixture.monitor.incidents.get('fixture-incident').state, 'open'); record('Bearer mutation authorization preserves origin enforcement and incident state', { status: 403 });

  const originalGet = fixture.monitor.configuration.get.bind(fixture.monitor.configuration);
  fixture.monitor.configuration.get = (key, fallback) => key === 'security.allowRemoteIngest' ? true : originalGet(key, fallback);
  fixture.monitor.authenticator.secret = syntheticSecret;
  const sign = (raw, timestamp = Date.now()) => ({ 'x-rawnode-monitor-timestamp': String(timestamp), 'x-rawnode-monitor-signature': `sha256=${createHmac('sha256', syntheticSecret).update(String(timestamp)).update('.').update(raw).digest('hex')}` });
  const ingest = (raw, headers = {}) => request(`${fixture.url}/api/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
  const raw = Buffer.from(' { "kind": "event", "payload": {"name":"readiness.hmac.exact-bytes","token":"synthetic-ingest-secret","message":"Bearer synthetic-ingest-bearer"}, "context":{"password":"synthetic-ingest-context"} }\n');
  const signed = sign(raw); const accepted = await parsed(await ingest(raw, signed), 202); assert.equal(accepted.accepted, 1); assert.equal(accepted.rejected, 0); record('HMAC accepts the exact signed raw JSON bytes', { status: 202, accepted: accepted.accepted, rejected: accepted.rejected, rawBytes: raw.length });
  await fixture.monitor.flush({ timeoutMs: 2000, throwOnError: true });
  const stored = await fixture.monitor.query.signals({ kind: 'event', limit: 100 }); const signal = stored.items.find(item => item.payload?.name === 'readiness.hmac.exact-bytes'); assert.ok(signal); assert.equal(signal.payload.token, '[REDACTED]'); assert.equal(signal.payload.message, '[REDACTED]'); assert.equal(signal.context.password, '[REDACTED]'); assert.equal(signal.context.remote, true); assert.equal(JSON.stringify(signal).includes('synthetic-ingest-secret'), false); record('Accepted remote telemetry is redacted in the actual memory store', { tokenRedacted: true, bearerRedacted: true, contextPasswordRedacted: true, remote: true });
  const throughStudio = await parsed(await request(`${fixture.url}/api/signals?kind=event&limit=100`, { headers: { authorization: `Bearer ${syntheticToken}` } }), 200); assert.ok(throughStudio.data.items.some(item => item.payload?.name === 'readiness.hmac.exact-bytes')); assert.equal(JSON.stringify(throughStudio).includes('synthetic-ingest-secret'), false); record('Studio returns the accepted remote signal with redaction', { status: 200 });
  const authFailures = [
    ['Exact-byte tamper', Buffer.concat([raw, Buffer.from(' ')]), signed],
    ['Missing signature and timestamp', raw, {}],
    ['Malformed signature', raw, { ...signed, 'x-rawnode-monitor-signature': 'sha256=not-hex' }],
    ['Wrong same-length signature', raw, { ...signed, 'x-rawnode-monitor-signature': `sha256=${'0'.repeat(64)}` }],
    ['Missing timestamp', raw, { 'x-rawnode-monitor-signature': signed['x-rawnode-monitor-signature'] }],
    ['Malformed timestamp', raw, { ...signed, 'x-rawnode-monitor-timestamp': 'not-a-timestamp' }],
    ['Expired timestamp with valid HMAC', raw, sign(raw, Date.now() - fixture.monitor.authenticator.maxSkewMs - 10_000)],
  ];
  const emittedBefore = fixture.monitor.stats.emitted.event;
  for (const [name, bytes, headers] of authFailures) { const payload = await parsed(await ingest(bytes, headers), 401); assert.equal(payload.error.code, 'MONITOR_INGEST_SIGNATURE_INVALID'); record(name, { status: 401, code: payload.error.code }); }
  assert.equal(fixture.monitor.stats.emitted.event, emittedBefore);
  const oversized = Buffer.from(JSON.stringify({ kind: 'event', payload: { padding: 'x'.repeat(1024 * 1024) } })); const tooLarge = await parsed(await ingest(oversized, sign(oversized)), 413); assert.equal(tooLarge.error.code, 'MONITOR_BODY_TOO_LARGE'); record('Authenticated body above the 1 MiB cap returns a bounded serializable error', { status: 413, code: tooLarge.error.code, rawBytes: oversized.length });
  const unknownKind = 'readiness-unknown-kind'; const unknownRaw = Buffer.from(JSON.stringify({ kind: unknownKind, payload: { token: 'synthetic-unknown-secret' } })); const beforeUnknown = { ...fixture.monitor.stats.emitted }; const unknown = await parsed(await ingest(unknownRaw, sign(unknownRaw)), 202); assert.equal(unknown.accepted, 0); assert.equal(unknown.rejected, 1); assert.equal(Object.hasOwn(fixture.monitor.stats.emitted, unknownKind), false); assert.deepEqual({ ...fixture.monitor.stats.emitted }, beforeUnknown); record('Signed unknown kind is rejected without unknown-kind emission accounting', { status: 202, accepted: unknown.accepted, rejected: unknown.rejected, unknownStatsPresent: false });
  result.limitations = ['Timestamp freshness plus HMAC authenticates bytes; nonce-based replay prevention is not provided.', 'Token-required shell success used an explicit Authorization header; a token entered after page load cannot authorize initial browser navigation.', 'No bearer tokens were put in URLs or persistent browser storage.', 'Only a task-owned loopback memory-store fixture was enabled; production ingestion remains disabled in the package defaults.'];
  await fixture.close(); await fixture.close(); assert.equal(fixture.server.listening, false); assert.equal(fixture.studio.clients.size, 0); assert.equal(fixture.monitor.listenerCount('signal'), 0); assert.equal(fixture.monitor.timers.size, 0); record('Fixture closes idempotently with no server, streams, signal listener or runtime timers');
  result.status = 'passed';
} catch (error) { result.status = 'failed'; result.error = { name: error.name, code: error.code || null, message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  try { await fixture?.close(); } catch (error) { result.cleanupError = error.message; process.exitCode = 1; }
  result.finishedAt = new Date().toISOString(); result.checkCount = result.checks.length;
  await writeFile(path.join(taskRoot, 'ingest-auth-final-smoke.json'), `${JSON.stringify(result, null, 2)}\n`);
  const log = [`Command: node ${path.relative(process.cwd(), path.join(taskRoot, 'scripts/ingest-auth-final-smoke.mjs'))}`, `Runtime: ${process.version}`, `Archive SHA-256: ${result.sha256}`, `Started: ${result.startedAt}`, `Finished: ${result.finishedAt}`, `Status: ${result.status}`, `Checks: ${result.checkCount}`, `Error: ${result.error?.message || 'none'}`, 'Scope: actual loopback HTTP; unchanged installed final package; no browser result.', ''];
  await writeFile(path.join(taskRoot, 'logs/ingest-auth-final-smoke.log'), log.join('\n'));
  console.log(JSON.stringify({ status: result.status, checks: result.checkCount, sha256: result.sha256, evidence: path.join(taskRoot, 'ingest-auth-final-smoke.json'), error: result.error?.message }));
}
