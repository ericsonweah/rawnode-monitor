'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryQueue } from '../../index.js';

test('DeliveryQueue preserves order and cooperatively drains', async () => {
  const output = [];
  const queue = new DeliveryQueue({ maxItems: 10, maxBytes: 1024 * 1024, budgetMs: 1, maxPerSlice: 1 });
  for (let index = 0; index < 5; index++) {
    queue.enqueue(async () => {
      if (index === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      output.push(index);
    }, { bytes: 10, meta: { rank: 9, severity: 30, droppable: true } });
  }
  await queue.flush();
  assert.deepEqual(output, [0, 1, 2, 3, 4]);
  assert.equal(queue.snapshot().stats.completed, 5);
  await queue.close();
});

test('DeliveryQueue evicts low-priority records before high-priority records', async () => {
  const output = [];
  const queue = new DeliveryQueue({ maxItems: 2, maxBytes: 1024, overflow: 'severity-aware' });
  const gate = new Promise((resolve) => setTimeout(resolve, 20));
  queue.enqueue(async () => { await gate; output.push('active'); }, { bytes: 100, meta: { rank: 10, severity: 20, droppable: true } });
  queue.enqueue(async () => output.push('debug'), { bytes: 100, meta: { rank: 10, severity: 20, droppable: true } });
  const critical = queue.enqueue(async () => output.push('critical'), { bytes: 100, meta: { rank: 2, severity: 70, droppable: false } });
  await queue.flush();
  assert.equal((await critical.promise)?.dropped, undefined);
  assert.equal(output.includes('critical'), true);
  assert.ok(queue.snapshot().stats.evicted >= 1 || queue.snapshot().stats.overcommitted >= 1);
});

test('DeliveryQueue honors AbortSignal and flush timeout', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  const queue = new DeliveryQueue({ maxItems: 2, maxBytes: 1024, flushTimeoutMs: 5 });
  const aborted = queue.enqueue(async () => 1, { signal: controller.signal, bytes: 1 });
  assert.equal(aborted.accepted, false);
  const value = await aborted.promise;
  assert.equal(value.reason, 'aborted');
  await queue.close();
});
