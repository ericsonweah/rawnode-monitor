'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EventSchemaRegistry,
  EventCodecRegistry,
  SafeJsonCodec,
  EventDiagnostics,
  MemoryOutboxStore,
  EventOutbox,
  OutboxPublisher,
  MemoryEventInbox,
  MemoryEventTransport,
  AdvancedEventDispatcher,
  Event,
} from '../../src/events/index.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('versioned contracts validate payloads and apply sequential upcasters', async () => {
  const schemas = new EventSchemaRegistry();
  schemas.register('billing:paid', 1, {
    validate: (payload) => payload.amount > 0,
    upcast: (payload) => ({ ...payload, currency: 'USD' }),
  });
  schemas.register('billing:paid', 2, {
    validate: (payload) => ({ ok: typeof payload.currency === 'string', payload: { ...payload, currency: payload.currency.toUpperCase() } }),
  });

  const upgraded = schemas.upcast('billing:paid', 1, { amount: 42 });
  assert.deepEqual(upgraded, { eventName: 'billing:paid', version: 2, payload: { amount: 42, currency: 'USD' } });
  const validated = schemas.validate('billing:paid', 2, upgraded.payload);
  assert.equal(validated.ok, true);
  assert.throws(() => schemas.validate('billing:paid', 1, { amount: 0 }), /rejected|validation/i);
  schemas.freeze();
  assert.throws(() => schemas.register('billing:paid', 3, {}), /frozen/i);
});

test('codec registry exposes replace-safe named codecs', () => {
  const registry = new EventCodecRegistry();
  const encoded = registry.encode({ value: 9n });
  assert.equal(registry.parse(encoded.text).value, 9n);
  assert.throws(() => registry.register('json', registry.get()), /already exists/i);
  assert.deepEqual(registry.names(), ['json']);
});

test('codec registry enforces bounded codec cardinality', () => {
  const registry = new EventCodecRegistry({ maxCodecs: 2 });
  const codec = new SafeJsonCodec();
  registry.register('secondary', codec);
  assert.throws(
    () => registry.register('third', codec),
    (error) => error?.code === 'EVENT_CODEC_LIMIT',
  );
  assert.equal(registry.snapshot().limits.maxCodecs, 2);
});

test('diagnostics are isolated, redacted, bounded, and safe for the error name', () => {
  const diagnostics = new EventDiagnostics({ enabled: true, historyLimit: 2, maxHistoryBytes: 4096 });
  const seen = [];
  diagnostics.on('*', (name, payload) => seen.push([name, payload]));
  assert.doesNotThrow(() => diagnostics.emit('error', { token: 'hidden', nested: { password: 'hidden' } }));
  diagnostics.emit('dispatch', { value: 1 });
  diagnostics.emit('slow', { value: 2 });
  assert.equal(seen[0][1].token, '[redacted]');
  assert.equal(seen[0][1].nested.password, '[redacted]');
  assert.equal(diagnostics.history().length, 2);
  assert.equal(diagnostics.snapshot().stats.historyEvictions, 1);
  diagnostics.close();
});

test('durable outbox publishes with leases, retry metadata, and idempotency', async () => {
  const store = new MemoryOutboxStore({ maxItems: 100, maxBytes: 1024 * 1024 });
  const transport = new MemoryEventTransport();
  const outbox = new EventOutbox({ store, nodeId: 'test-node' });
  const first = await outbox.enqueue('billing:paid', [{ id: 1 }], { idempotencyKey: 'pay-1' });
  const duplicate = await outbox.enqueue('billing:paid', [{ id: 1 }], { idempotencyKey: 'pay-1' });
  assert.equal(first.inserted, true);
  assert.equal(duplicate.duplicate, true);

  const publisher = new OutboxPublisher(store, transport, { batchSize: 10, concurrency: 2 });
  const result = await publisher.runOnce();
  assert.deepEqual(result, { claimed: 1, published: 1, failed: 0 });
  assert.equal(store.get(first.record.id).status, 'published');
  assert.equal(transport.all('billing:paid').length, 1);
  await publisher.close();
  await transport.close();
});

test('idempotency inbox coalesces concurrent duplicates and remembers completion', async () => {
  const inbox = new MemoryEventInbox({ ttlMs: 1000 });
  let calls = 0;
  const handler = async () => { calls++; await Promise.resolve(); return 'ok'; };
  const [one, two] = await Promise.all([inbox.run('message-1', handler), inbox.run('message-1', handler)]);
  assert.equal(calls, 1);
  assert.equal(one.value, 'ok');
  assert.equal(two.value, 'ok');
  const duplicate = await inbox.run('message-1', handler);
  assert.equal(duplicate.duplicate, true);
  assert.equal(calls, 1);
});

test('dispatcher can auto-validate registered event-object contracts and freeze registrations', () => {
  class UserCreated extends Event { static eventName = 'user:created'; static version = 1; }
  const schemas = new EventSchemaRegistry();
  schemas.register('user:created', 1, (payload) => typeof payload.id === 'string');
  const events = new AdvancedEventDispatcher({ logger: silentLogger, schemaRegistry: schemas, contracts: { autoValidate: true } });
  events.dispatch(new UserCreated({ id: 'u1' }));
  assert.throws(() => events.dispatch(new UserCreated({ id: 1 })), /rejected|validation/i);
  events.freezeRegistrations();
  assert.throws(() => events.on('user:created', () => {}), /frozen/i);
});
