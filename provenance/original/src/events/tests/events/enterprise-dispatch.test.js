'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { AdvancedEventDispatcher } from '../../src/events/index.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('disposable handles support pause, resume, metadata and disposal', () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  let count = 0;
  const handle = events.subscribe('user:updated', () => count++, {
    priority: 50,
    owner: 'users-provider',
    tags: ['domain', 'audit'],
    meta: { source: 'test' },
  });
  assert.equal(handle.active, true);
  assert.equal(handle.metadata.owner, 'users-provider');
  assert.deepEqual(handle.metadata.tags, ['domain', 'audit']);

  handle.pause();
  events.dispatch('user:updated');
  assert.equal(count, 0);
  handle.resume();
  events.dispatch('user:updated');
  assert.equal(count, 1);
  assert.equal(handle.dispose(), true);
  assert.equal(handle.dispose(), false);
  events.dispatch('user:updated');
  assert.equal(count, 1);
});

test('owner and tag cleanup make provider/plugin teardown deterministic', () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  events.subscribe('a:event', () => {}, { owner: 'provider:a', tags: ['shared'] });
  events.subscribe('b:event', () => {}, { owner: 'provider:a', tags: ['other'] });
  events.subscribe('c:event', () => {}, { owner: 'provider:c', tags: ['shared'] });
  assert.equal(events.removeOwner('provider:a'), 2);
  assert.equal(events.listenerCount(), 1);
  assert.equal(events.removeTag('shared'), 1);
  assert.equal(events.listenerCount(), 0);
});

test('fluent subscription builder composes priority, once, replay, owner and tags', () => {
  const events = new AdvancedEventDispatcher({ historyLimit: 10, logger: silentLogger });
  events.dispatch('invoice:paid', 1);
  let count = 0;
  const handle = events.when('invoice:paid')
    .priority(100)
    .owner('billing')
    .tag('financial', 'critical')
    .once()
    .replay(1)
    .listen(() => count++);
  assert.equal(count, 1);
  assert.equal(handle.active, true, 'compatibility replay does not consume once by default');
  events.dispatch('invoice:paid', 2);
  assert.equal(count, 2);
  assert.equal(handle.active, false);
});

test('inspect exposes the exact execution plan without invoking listeners', () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  events.on('http:request:*', () => {});
  events.onPattern('http:**', () => {});
  events.onAny(() => {});
  const inspection = events.inspect('http:request:received');
  assert.equal(inspection.total, 3);
  assert.deepEqual(inspection.wildcardNames, ['http:request:*', 'http:*']);
  assert.equal(inspection.patterns[0].pattern, 'http:**');
});

test('dispatchWithReport captures synchronous values and isolated failures', () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  events.on('math:calculate', (value) => value * 2);
  events.on('math:calculate', () => { throw new Error('bad listener'); });
  const report = events.dispatchWithReport('math:calculate', 4);
  assert.equal(report.invoked, 2);
  assert.equal(report.errorCount, 1);
  assert.equal(report.results[0].value, 8);
  assert.equal(report.ok, false);
});

test('dispatchSettled is sequential and returns a complete report', async () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  const order = [];
  events.on('pipeline:run', async () => { await delay(5); order.push('first'); return 1; });
  events.on('pipeline:run', async () => { order.push('second'); return 2; });
  const report = await events.dispatchSettled('pipeline:run');
  assert.deepEqual(order, ['first', 'second']);
  assert.deepEqual(report.results.map((entry) => entry.value), [1, 2]);
  assert.equal(report.ok, true);
});

test('dispatchParallelWith observes its concurrency ceiling', async () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  let active = 0;
  let highWater = 0;
  for (let index = 0; index < 8; index++) {
    events.on('parallel:run', async () => {
      active++;
      highWater = Math.max(highWater, active);
      await delay(5);
      active--;
      return index;
    });
  }
  const report = await events.dispatchParallelWith({ concurrency: 3 }, 'parallel:run');
  assert.equal(report.invoked, 8);
  assert.ok(highWater <= 3);
  assert.ok(highWater >= 2);
});

test('dispatchFirst and dispatchUntil stop on matching listener results', async () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  events.on('lookup:value', () => undefined);
  events.on('lookup:value', () => 'found');
  events.on('lookup:value', () => 'too-late');
  assert.equal(await events.dispatchFirst('lookup:value'), 'found');

  const report = await events.dispatchUntil((value) => value === 'found', 'lookup:value');
  assert.equal(report.stopped, true);
  assert.equal(report.stopValue, 'found');
  assert.equal(report.invoked, 2);
});

test('waitFor supports exact events, mapping, timeout and AbortSignal', async () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  const waiting = events.waitFor('order:created', {
    timeoutMs: 1000,
    map: (_name, payload) => payload.id,
  });
  events.dispatchDeferred('order:created', { id: 'o-1' });
  assert.equal(await waiting, 'o-1');

  await assert.rejects(events.waitFor('never:happens', { timeoutMs: 5 }), (error) => error.code === 'EVENT_WAIT_TIMEOUT');

  const controller = new AbortController();
  const aborted = events.waitFor('never:again', { signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted, (error) => error.code === 'EVENT_ABORTED');
});

test('bounded async iterator receives events and disposes its subscription', async () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  const iterator = events.iterate('stream:item', { maxItems: 2 });
  events.dispatch('stream:item', 1);
  events.dispatch('stream:item', 2);
  assert.deepEqual((await iterator.next()).value.args, [1]);
  assert.deepEqual((await iterator.next()).value.args, [2]);
  await iterator.return();
  assert.equal(events.listenerCount('stream:item'), 0);
});

test('deferred dispatch preserves extended async context and drains accepted work', async () => {
  const events = new AdvancedEventDispatcher({
    logger: silentLogger,
    deferred: { maxItems: 10, maxBytes: 1024 * 1024, maxInFlight: 1, overflow: 'reject' },
  });
  let received = null;
  events.on('context:check', () => { received = events.getContext(); });
  const context = events.createContext({
    transport: 'http',
    requestId: 'req-42',
    tenantId: 'acme',
    actorId: 'user-7',
    traceId: 'trace-1',
  });
  events.run(context, () => events.dispatchDeferred('context:check'));
  await events.drain();
  assert.equal(received.id, context.id);
  assert.equal(received.tenantId, 'acme');
  assert.equal(received.actorId, 'user-7');
  assert.equal(events.queueSnapshot().queuedItems, 0);
});
