import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import SignalPipeline from '../src/pipeline/SignalPipeline.js';
import BoundedSignalQueue from '../src/pipeline/BoundedSignalQueue.js';
import MetricRegistry from '../src/metrics/MetricRegistry.js';

test('metric reset/remove releases ownership without corrupting replacements', () => {
  const registry = new MetricRegistry({ maxSeries: 2 });
  const counter = registry.counter('requests');
  const oldHandle = counter.labels({ route: '/' });
  assert.equal(oldHandle.inc(), true);
  counter.reset();
  assert.equal(oldHandle.inc(), false);
  assert.equal(counter.inc({ route: '/' }), true);
  assert.equal(registry.seriesCount, 1);
  assert.equal(registry.remove('requests'), true);
  const replacement = registry.counter('requests');
  assert.equal(replacement.inc({ route: '/' }), true);
  counter.reset();
  assert.equal(counter.inc({ route: '/old' }), false);
  assert.equal(replacement.inc({ route: '/new' }), true);
  assert.equal(registry.seriesCount, 2);
  assert.equal(registry.seriesKeys.size, 2);
});

test('aggregate policy reserves an overflow slot and respects both series bounds', () => {
  const registry = new MetricRegistry({ maxSeries: 3, maxSeriesPerInstrument: 2, cardinalityPolicy: 'aggregate' });
  const a = registry.counter('a');
  for (let i = 0; i < 100; i++) a.inc({ input: String(i) });
  assert.equal(a.series.size, 2);
  assert.equal(a.snapshot().series.find(s => s.labels._overflow === 'true').value, 99);
  for (let i = 0; i < 20; i++) registry.counter('metric' + i).inc();
  assert.equal(registry.seriesCount, 3);
  assert.equal(registry.seriesKeys.size, 3);
  assert.equal([...registry.instruments.values()].reduce((sum, value) => sum + value.series.size, 0), 3);
});

test('observable callback deadline does not launch overlapping stuck collectors or accept late observations', async () => {
  const registry = new MetricRegistry({ collectionTimeoutMs: 15 });
  let calls = 0;
  let observe;
  let release;
  const gauge = registry.observableGauge('slow', async context => {
    calls++;
    observe = context.observe;
    await new Promise(resolve => { release = resolve; });
    return 9;
  });
  await registry.collect();
  assert.equal(gauge.lastError.code, 'MONITOR_TIMEOUT');
  await registry.collect();
  assert.equal(calls, 1);
  assert.equal(observe(8), false);
  release();
  await delay(1);
  assert.equal(gauge.series.size, 0);
});

test('stalled sink writes are bounded and a following sink remains usable', async () => {
  const pipeline = new SignalPipeline({ batchSize: 1, maxInFlightBatches: 2, sinkTimeoutMs: 15, deliveryAttempts: 1 });
  let calls = 0;
  let written = 0;
  let sawAbort = false;
  pipeline.addSink('stalled', { writeMany(_batch, { signal }) { calls++; signal.addEventListener('abort', () => { sawAbort = true; }, { once: true }); return new Promise(() => {}); } });
  pipeline.addSink('healthy', { writeMany(batch) { written += batch.length; } });
  for (let i = 0; i < 8; i++) pipeline.admit({ id: i, kind: 'event' });
  await pipeline.flush({ timeoutMs: 300 });
  assert.equal(calls, 2);
  assert.equal(written, 8);
  assert.equal(sawAbort, true);
  assert.equal(pipeline.snapshot().sinks[0].pendingWrites, 2);
  await pipeline.close({ timeoutMs: 30 });
});

test('pipeline close is idempotent and finalizes despite required stalled lifecycle callback', async () => {
  const pipeline = new SignalPipeline({ sinkTimeoutMs: 10 });
  let closes = 0;
  pipeline.addSink('sink', { writeMany() {}, close() { closes++; return new Promise(() => {}); } }, { required: true });
  pipeline.admit({ kind: 'event' });
  const before = Date.now();
  const results = await Promise.allSettled([pipeline.close({ timeoutMs: 25, throwOnError: true }), pipeline.close({ timeoutMs: 25, throwOnError: true })]);
  assert.ok(Date.now() - before < 500);
  assert.equal(closes, 1);
  assert.deepEqual(results.map(value => value.status), ['rejected', 'rejected']);
  assert.equal(pipeline.closed, true);
  assert.equal(pipeline.closing, false);
  assert.equal(pipeline.queue.length, 0);
  assert.equal(pipeline.timer, null);
  assert.equal(pipeline.inFlight.size, 0);
  assert.equal(pipeline.admit({ kind: 'event' }).accepted, false);
  assert.equal((await pipeline.flush()).closed, true);
});

test('flush cancellation reaches cooperative sinks and shutdown clears queued references', async () => {
  const pipeline = new SignalPipeline({ batchSize: 1, maxInFlightBatches: 1, sinkTimeoutMs: 100 });
  let activeSignal;
  pipeline.addSink('cancel', { writeMany(_batch, { signal }) { activeSignal = signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); } });
  pipeline.admit({ kind: 'event' });
  pipeline.admit({ kind: 'event' });
  await assert.rejects(pipeline.flush({ timeoutMs: 15 }), { code: 'MONITOR_TIMEOUT' });
  assert.equal(activeSignal.aborted, true);
  await pipeline.close({ flush: false, timeoutMs: 20 });
  assert.equal(pipeline.queue.length, 0);
  assert.equal(pipeline.inFlight.size, 0);
});

test('required sinks cannot acknowledge incomplete delivery as a success', async () => {
  const pipeline = new SignalPipeline({ deliveryAttempts: 1 });
  pipeline.addSink('closed-store', { writeMany() { return { written: 0, closed: true }; } }, { required: true });
  pipeline.admit({ kind: 'event' });
  await assert.rejects(pipeline.flush({ timeoutMs: 100, throwOnError: true }), { code: 'MONITOR_PIPELINE_FLUSH_FAILED' });
  assert.equal(pipeline.stats.sinkWrites, 0);
  assert.equal(pipeline.stats.failedSignals, 1);
  await pipeline.close();
});

test('pre-cancelled admission never retains a queue value', async () => {
  const queue = new BoundedSignalQueue({ maxItems: 1 });
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await assert.rejects(queue.push({ kind: 'event' }, { signal: controller.signal }), /cancelled/);
  assert.equal(queue.length, 0);
});

test('repeated flushes cannot accumulate unresolved sink lifecycle calls', async () => {
  const pipeline = new SignalPipeline({ sinkTimeoutMs: 10 });
  let calls = 0;
  pipeline.addSink('stuck-flush', { writeMany() {}, flush() { calls++; return new Promise(() => {}); } });
  await pipeline.flush({ timeoutMs: 50 });
  await pipeline.flush({ timeoutMs: 50 });
  assert.equal(calls, 1);
  assert.deepEqual(pipeline.snapshot().sinks[0].pendingLifecycle, ['flush']);
  await pipeline.close({ flush: false, timeoutMs: 20 });
});
