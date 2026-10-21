'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EventConfiguration,
  EventJournal,
  DeferredEventScheduler,
  EventMetricsStore,
  AdvancedEventDispatcher,
} from '../../src/events/index.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('production profile validates bounded history and freezes configuration', () => {
  const config = new EventConfiguration({ profile: 'production', historyLimit: 10 });
  assert.equal(config.get('history.maxEntriesPerEvent'), 10);
  assert.ok(config.get('history.maxEventNames') > 0);
  assert.equal(Object.isFrozen(config.value), true);
  assert.throws(
    () => new EventConfiguration({ profile: 'production', historyLimit: 10, maxHistoryEvents: 0 }),
    /maxEventNames/,
  );
});

test('journal enforces per-event, global event-name, total-entry, byte and TTL bounds', () => {
  const journal = new EventJournal({
    historyLimit: 2,
    maxEventNames: 2,
    maxEntriesTotal: 3,
    maxBytes: 1024,
    maxPayloadBytes: 256,
    ttlMs: 100,
    clonePolicy: 'shallow',
  });
  journal.record('a:event', [1], null, 0);
  journal.record('a:event', [2], null, 1);
  journal.record('a:event', [3], null, 2);
  assert.deepEqual(journal.get('a:event', { now: 2 }).map((entry) => entry.args[0]), [2, 3]);

  journal.record('b:event', [4], null, 3);
  journal.record('c:event', [5], null, 4);
  assert.ok(journal.eventCount <= 2);
  assert.ok(journal.totalEntries <= 3);
  assert.ok(journal.totalBytes <= 1024);

  journal.pruneExpired(1000);
  assert.equal(journal.totalEntries, 0);
});

test('journal rejects oversized payloads without retaining them', () => {
  const journal = new EventJournal({ historyLimit: 10, maxPayloadBytes: 32 });
  const result = journal.record('large:event', ['x'.repeat(100)]);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'maxPayloadBytes');
  assert.equal(journal.totalEntries, 0);
});

test('deferred scheduler applies bounded overflow and resolves flush', async () => {
  const scheduler = new DeferredEventScheduler({ maxItems: 2, maxBytes: 1024, overflow: 'drop-newest', maxPerSlice: 1 });
  const order = [];
  const one = scheduler.schedule(() => order.push(1), { bytes: 1 });
  const two = scheduler.schedule(() => order.push(2), { bytes: 1 });
  const three = scheduler.schedule(() => order.push(3), { bytes: 1 });
  assert.equal(one.accepted, true);
  assert.equal(two.accepted, true);
  assert.equal(three.accepted, false);
  await scheduler.flush();
  assert.deepEqual(order, [1, 2]);
  assert.equal(scheduler.snapshot().stats.dropped, 1);
  await scheduler.close();
});

test('metrics bound event-name cardinality and expose Prometheus text', () => {
  const metrics = new EventMetricsStore({ enabled: true, maxSeries: 2, prefix: 'rawnode_events_test' });
  metrics.recordDispatch('a:event', 1, 0, 1);
  metrics.recordDispatch('b:event', 2, 0, 1);
  metrics.recordDispatch('c:event', 3, 0, 1);
  assert.ok(metrics.series.size <= 2, 'maxSeries is a strict total including overflow');
  assert.ok(metrics.snapshot().counters.series_overflow_total >= 1);
  assert.match(metrics.prometheus(), /rawnode_events_test_dispatch_total/);
});

test('dispatcher production profile exposes health, snapshots and bounded metrics', () => {
  const events = new AdvancedEventDispatcher({ profile: 'production', logger: silentLogger });
  events.on('health:check', () => {});
  events.dispatch('health:check');
  assert.equal(events.health().ok, true);
  assert.equal(events.metrics().counters.dispatches_total, 1);
  assert.match(events.prometheus(), /rawnode_events_dispatch_total/);
  assert.equal(events.snapshot().profile, 'production');
});
