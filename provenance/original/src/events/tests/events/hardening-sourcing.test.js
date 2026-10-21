'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { channel } from 'node:diagnostics_channel';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AdvancedEventDispatcher,
  AggregateRoot,
  Event,
  EventJobQueue,
  MemoryEventStore,
  ProjectionManager,
} from '../../src/events/index.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('child contexts use the immediate parent as causation while preserving correlation', () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  const root = events.createContext({ id: 'root', correlationId: 'correlation' });
  const child = events.run(root, () => events.createContext({ id: 'child' }));
  const grandchild = events.run(child, () => events.createContext({ id: 'grandchild' }));
  assert.equal(child.parentId, 'root');
  assert.equal(child.causationId, 'root');
  assert.equal(grandchild.parentId, 'child');
  assert.equal(grandchild.causationId, 'child');
  assert.equal(grandchild.correlationId, 'correlation');
});

test('per-listener fail-fast overrides an isolating dispatcher policy', async () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger, dispatch: { errorPolicy: 'isolate' } });
  const calls = [];
  events.on('policy:test', () => { calls.push('first'); throw new Error('stop'); }, { errorPolicy: 'fail-fast' });
  events.on('policy:test', () => calls.push('second'));
  await assert.rejects(events.dispatchAsync('policy:test'), /stop/);
  assert.deepEqual(calls, ['first']);
  await events.close();
});

test('late diagnostics-channel subscribers activate diagnostics without dispatcher reconfiguration', async () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  const diagnosticChannel = channel('rawnode.events.diagnostics');
  const records = [];
  const subscriber = (record) => records.push(record);
  diagnosticChannel.subscribe(subscriber);
  try {
    events.dispatch('diagnostic:late', { ok: true });
    assert.equal(records.some((record) => record.name === 'dispatch' && record.payload.eventName === 'diagnostic:late'), true);
  } finally {
    diagnosticChannel.unsubscribe(subscriber);
    await events.close();
  }
});

test('versioned dispatch does not leak internal schema metadata into listener arguments', async () => {
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  events.registerSchema('contract:created', 1, { validate: (payload) => payload?.ok === true });
  let received = null;
  events.on('contract:created', (...args) => { received = args; });
  const result = events.dispatchVersioned('contract:created', { ok: true }, { version: 1 });
  assert.equal(result.version, 1);
  assert.deepEqual(received, [{ ok: true }]);
  await events.close();
});

test('production close has a bounded force-on-timeout path for unresolved listener promises', async () => {
  const events = new AdvancedEventDispatcher({
    profile: 'production',
    logger: silentLogger,
    lifecycle: { shutdownTimeoutMs: 5, forceOnTimeout: true },
  });
  events.on('never:resolves', () => new Promise(() => {}));
  events.dispatch('never:resolves');
  const snapshot = await events.close();
  assert.equal(snapshot.closed, true);
  assert.equal(snapshot.shutdown.forced, true);
  assert.equal(snapshot.shutdown.timeoutMs, 5);
});

test('job queue truly drops the oldest queued item and supports running cancellation', async () => {
  const queue = new EventJobQueue({ maxItems: 2, maxBytes: 1024 * 1024, overflow: 'drop-oldest', concurrency: 1, shutdownTimeoutMs: 20 });
  queue.register('delayed', async (_payload, context) => delay(1000, null, { signal: context.signal }));
  const oldest = queue.enqueue('delayed', 'oldest', { delayMs: 500 });
  const newer = queue.enqueue('delayed', 'newer', { delayMs: 500 });
  const newest = queue.enqueue('delayed', 'newest', { delayMs: 500 });
  await assert.rejects(oldest, /dropped/i);
  assert.equal(queue.get(newer.id)?.status, 'queued');
  assert.equal(queue.get(newest.id)?.status, 'queued');

  const running = queue.enqueue('delayed', 'running', { priority: 100 });
  await delay(5);
  assert.equal(running.cancel('test cancellation'), true);
  await assert.rejects(running, /cancel|abort/i);
  await queue.close({ drain: false, force: true });
});

test('event store enforces optimistic concurrency and projections rebuild from checkpoints', async () => {
  class Deposited extends Event { static eventName = 'account:deposited'; }
  class Account extends AggregateRoot {
    constructor(id) { super(id); this.balance = 0; }
    applyAccountDeposited(payload) { this.balance += payload.amount; }
    deposit(amount) { return this.record(new Deposited({ amount })); }
  }

  const store = new MemoryEventStore({ maxStreams: 10, maxEvents: 100, maxBytes: 1024 * 1024 });
  const account = new Account('account-1').deposit(10).deposit(5);
  const committed = await store.commit(account);
  assert.equal(committed.version, 2);
  assert.equal(account.hasUncommittedEvents(), false);
  await assert.rejects(
    store.append('account-1', new Deposited({ amount: 1 }), { expectedVersion: 0 }),
    (error) => error?.code === 'EVENT_CONCURRENCY_CONFLICT',
  );

  let projectedBalance = 0;
  const projections = new ProjectionManager(store, { batchSize: 1, budgetMs: 1 });
  projections.register('balances', {
    'account:deposited': (payload) => { projectedBalance += payload.amount; },
  }, { reset: () => { projectedBalance = 0; } });
  const rebuilt = await projections.rebuild('balances');
  assert.equal(rebuilt.processed, 2);
  assert.equal(projectedBalance, 15);
  assert.equal(rebuilt.position, 2);
  store.close();
});
