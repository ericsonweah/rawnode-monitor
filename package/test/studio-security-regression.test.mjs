import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudioFixture } from '../examples/studio-fixture.mjs';

function controlledError(details, status = 422) {
  return Object.assign(new Error('Synthetic capability rejected Bearer fixture-secret-token'), { code: 'MONITOR_SYNTHETIC_FAILURE', status, details });
}
async function safeFailure(response, { status = 422, maxBytes = 20_000 } = {}) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  const text = await response.text(); assert.ok(Buffer.byteLength(text) <= maxBytes, 'The configured serializer bounds error output plus the JSON envelope.');
  assert.equal(text.includes('fixture-secret'), false); assert.equal(text.includes('studio-security-regression'), false);
  const payload = JSON.parse(text); assert.equal(payload.ok, false); assert.equal(payload.error.code, 'MONITOR_SYNTHETIC_FAILURE'); assert.equal(Object.hasOwn(payload.error, 'stack'), false);
  return payload.error;
}

test('actual HTTP: Studio read and mutation errors reuse bounded redaction for secret, cyclic, BigInt and oversized details', async t => {
  const fixture = await createStudioFixture(); t.after(() => fixture.close());
  fixture.monitor.serializer.maxStringBytes = 128; fixture.monitor.serializer.maxPayloadBytes = 4096;
  const cyclic = { password: 'fixture-secret-password' }; cyclic.self = cyclic;
  const variants = [
    { token: 'fixture-secret-token', nested: { clientSecret: 'fixture-secret-client' } },
    cyclic,
    { secret: 'fixture-secret-bigint', count: 42n },
    { password: 'fixture-secret-large', oversized: 'x'.repeat(100_000) },
    Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`entry${index}`, 'x'.repeat(500)])),
  ];
  for (const details of variants) {
    const error = controlledError(details); fixture.studio.overview = () => { throw error; }; fixture.studio.silence = () => { throw error; };
    const read = await safeFailure(await fetch(`${fixture.url}/api/overview`), { maxBytes: 4608 });
    const mutation = await safeFailure(await fetch(`${fixture.url}/api/silences`, { method: 'POST', headers: { origin: new URL(fixture.url).origin, 'content-type': 'application/json' }, body: '{}' }), { maxBytes: 4608 });
    if (!read.truncated) assert.match(read.message, /\[REDACTED\]/);
    if (details === cyclic) assert.equal(mutation.details.self, '[Circular]');
    if (details.count === 42n) assert.equal(mutation.details.count, '42');
    if (details.oversized) assert.ok(mutation.details.oversized.length < 200);
  }
  fixture.studio.overview = () => { throw controlledError({}, 999); };
  await safeFailure(await fetch(`${fixture.url}/api/overview`), { status: 500 });
});

test('actual HTTP: ingestion failures and custom authorizer exceptions cross the same safe error boundary', async t => {
  const fixture = await createStudioFixture(); t.after(() => fixture.close());
  const get = fixture.monitor.configuration.get.bind(fixture.monitor.configuration);
  fixture.monitor.configuration.get = (key, fallback) => key === 'security.allowRemoteIngest' ? true : get(key, fallback);
  fixture.monitor.authenticator.assert = () => { throw controlledError({ authorization: 'fixture-secret-ingest', count: 7n }); };
  const ingestion = await safeFailure(await fetch(`${fixture.url}/api/ingest`, { method: 'POST', body: '{}' }));
  assert.equal(ingestion.details.authorization, '[REDACTED]'); assert.equal(ingestion.details.count, '7');
  fixture.studio.authorizer.authorize = () => { throw controlledError({ password: 'fixture-secret-authorizer' }); };
  const auth = await safeFailure(await fetch(`${fixture.url}/api/overview`)); assert.equal(auth.details.password, '[REDACTED]');
});
