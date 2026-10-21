'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventOutbox, MemoryOutboxStore, OutboxPublisher } from '../../src/events/index.js';

test('outbox publisher awaits admission-style transport delivery before completing', async () => {
  const store = new MemoryOutboxStore();
  const outbox = new EventOutbox({ store });
  const record = await outbox.enqueue('durable:admission', [{ ok: true }]);
  let delivered = false;
  const transport = {
    publish() {
      return { accepted: true, promise: new Promise((resolve) => setImmediate(() => { delivered = true; resolve({ published: true }); })) };
    },
  };
  const publisher = new OutboxPublisher(store, transport, { unrefTimers: false });
  const result = await publisher.runOnce();
  assert.equal(delivered, true);
  assert.equal(result.published, 1);
  assert.equal(store.get(record.record.id).status, 'published');
});

test('outbox publisher retries when admission is rejected', async () => {
  const store = new MemoryOutboxStore({ maxAttempts: 2 });
  const outbox = new EventOutbox({ store });
  const record = await outbox.enqueue('durable:rejected', []);
  const publisher = new OutboxPublisher(store, { publish: () => ({ accepted: false, code: 'FULL', promise: Promise.resolve() }) }, { retryBaseMs: 0, unrefTimers: false });
  const result = await publisher.runOnce();
  assert.equal(result.failed, 1);
  assert.equal(store.get(record.record.id).status, 'failed');
});
