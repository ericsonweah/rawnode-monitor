import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import InMemorySpanStore from '../src/tracing/InMemorySpanStore.js';
import Tracer from '../src/tracing/Tracer.js';
import CompositeTelemetryStore from '../src/storage/CompositeTelemetryStore.js';
import SyntheticMonitor from '../src/synthetics/SyntheticMonitor.js';

test('configured span cap controls actual retained spans', () => {
  const tracer = new Tracer({ enabled: true, sampleRate: 1, maxSpansInMemory: 1 });
  tracer.startSpan('first').end();
  tracer.startSpan('second').end();
  assert.equal(tracer.store.maxSpans, 1);
  assert.deepEqual(tracer.query().map(span => span.name), ['second']);
});

test('pruning removes expired records from every index and reuses ring capacity', () => {
  const store = new InMemorySpanStore({ maxSpans: 2, maxTraceAgeMs: 1_000 });
  const now = Date.now();
  const span = id => ({ traceId: id, startTimeUnixNano: String(BigInt(now) * 1_000_000n) });
  store.add(span('expired'));
  assert.equal(store.prune(now + 1_001), 1);
  assert.equal(store.query().length, 0);
  assert.equal(store.trace('expired').length, 0);
  assert.equal(store.snapshot().length, 0);
  assert.equal(store.spans.filter(Boolean).length, 0);
  assert.equal(store.add({ traceId: 'already-old', startTimeUnixNano: String(BigInt(now - 2_000) * 1_000_000n) }), false);
  store.add(span('new'));
  assert.deepEqual(store.query().map(value => value.traceId), ['new']);
});

test('read paths enforce elapsed span retention without a timer', () => {
  const store = new InMemorySpanStore({ maxTraceAgeMs: 1_000 });
  store.add({ traceId: 'entry', startTimeUnixNano: String(BigInt(Date.now()) * 1_000_000n) });
  // Model a clock advance at the retention boundary without a real long wait.
  const original = Date.now;
  const future = original() + 2_000;
  try { Date.now = () => future; assert.equal(store.all().length, 0); }
  finally { Date.now = original; }
  assert.equal(store.byTrace.size, 0);
});

test('durability requires a full acknowledged write and optional partial stores report failure', async () => {
  const signals = [{ kind: 'event' }, { kind: 'event' }];
  for (const result of [{ written: 0, closed: true }, { written: 1 }, { written: NaN }, false]) {
    const store = new CompositeTelemetryStore([{ name: 'disk', durable: true, store: { writeMany: async () => result } }], { requireDurable: true });
    await assert.rejects(store.writeMany(signals), { code: 'MONITOR_DURABLE_STORAGE_UNAVAILABLE' });
    assert.equal(store.stats.written, 0);
  }
  const healthy = new CompositeTelemetryStore([
    { name: 'partial', durable: true, store: { writeMany: async () => ({ written: 1 }) } },
    { name: 'complete', durable: true, store: { writeMany: async rows => ({ written: rows.length }) } },
  ], { requireDurable: true });
  assert.equal((await healthy.writeMany(signals)).durable, true);
  assert.equal(healthy.stats.partialBatches, 1);
});

test('unregister aborts the current check and late completion cannot restore state or scheduling', async () => {
  const monitor = new SyntheticMonitor({ enabled: true, concurrency: 1 });
  let release;
  let began;
  const started = new Promise(resolve => { began = resolve; });
  monitor.register({ id: 'old', type: 'custom', run: async () => { began(); await new Promise(resolve => { release = resolve; }); return {}; } });
  monitor.start({ immediate: false });
  const running = monitor.run('old');
  await started;
  assert.equal(monitor.unregister('old'), true);
  const result = await running;
  assert.equal(result.error.code, 'MONITOR_SYNTHETIC_UNREGISTERED');
  release();
  await delay(1);
  assert.equal(monitor.states.has('old'), false);
  assert.equal(monitor.timers.has('old'), false);
  assert.equal(monitor.history.length, 0);
  assert.equal(monitor.inFlight, 0);
  await monitor.close();
});

test('replacement preserves its new timer when an older scheduled run settles', async () => {
  const monitor = new SyntheticMonitor({ enabled: true });
  let release;
  let began;
  const started = new Promise(resolve => { began = resolve; });
  monitor.register({ id: 'same', type: 'custom', run: async () => { began(); await new Promise(resolve => { release = resolve; }); }, jitterMs: 0 });
  monitor.start();
  const keepAlive = setTimeout(() => {}, 1_000);
  try {
    await started;
    monitor.register({ id: 'same', type: 'custom', run: () => true }, { replace: true, immediate: false });
    const current = monitor.timers.get('same');
    release();
    await delay(1);
    assert.equal(monitor.timers.get('same'), current);
    assert.equal(monitor.states.get('same').last, null);
  } finally { clearTimeout(keepAlive); await monitor.close(); }
});

test('non-cooperative checks retain their concurrency slot and waiting runs are bounded', async () => {
  const monitor = new SyntheticMonitor({ concurrency: 1, maxWaiters: 1 });
  let calls = 0;
  let release;
  monitor.register({ id: 'stuck', type: 'custom', run: () => { calls++; return new Promise(resolve => { release = resolve; }); } });
  const first = await monitor.run('stuck', { timeoutMs: 15 });
  assert.equal(first.error.code, 'MONITOR_TIMEOUT');
  assert.equal(monitor.inFlight, 1);
  const external = new AbortController();
  const waiting = monitor.run('stuck', { timeoutMs: 100, signal: external.signal });
  const waitingResult = assert.rejects(waiting, { code: 'MONITOR_SYNTHETIC_CLOSED' });
  await assert.rejects(monitor.run('stuck', { timeoutMs: 100 }), { code: 'MONITOR_SYNTHETIC_WAITER_LIMIT' });
  assert.equal(calls, 1);
  await monitor.close();
  await waitingResult;
  assert.equal(getEventListeners(external.signal, 'abort').length, 0);
  assert.equal(monitor.waiters.length, 0);
  release();
  await delay(1);
  assert.equal(monitor.inFlight, 0);
  await assert.rejects(monitor.run('stuck'), { code: 'MONITOR_CLOSED' });
});
