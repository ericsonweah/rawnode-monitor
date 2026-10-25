import assert from 'node:assert/strict';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { Session } from 'node:inspector/promises';
import { readFile } from 'node:fs/promises';

const consumer = path.resolve(process.argv[2]);
const require = createRequire(path.join(consumer, 'package.json'));
// Resolve the installed metadata entry (available to both module conditions),
// then load its declared ESM target. The root intentionally has no CJS target.
const manifestPath = require.resolve('@rawnode/monitor/package.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const { MonitorRuntime } = await import(pathToFileURL(path.resolve(path.dirname(manifestPath), manifest.exports['.'].import)));
const operations = 20_000;
let checksum = 0;
async function trial(enabled) {
  let acceptedBySink = 0;
  const store = {
    async writeMany(signals) { await setTimeout(2); acceptedBySink += signals.length; return { written: signals.length }; },
    async query() { return []; },
    async close() {}, async flush() {},
  };
  const runtime = enabled ? new MonitorRuntime({ store, config: {
    profile: 'test', service: 'overhead-synthetic', system: { enabled: false }, resources: { autoDiscover: false },
    tracing: { sampleRate: 0.1, parentBased: false, maxSpansInMemory: 256 },
    pipeline: { maxItems: 512, maxBytes: 2 * 1024 * 1024, batchSize: 128, maxInFlightBatches: 1, flushIntervalMs: 20, overflow: 'drop-oldest' },
  } }) : null;
  if (runtime) await runtime.start();
  const counter = runtime?.metrics.counter('fixture_operations_total');
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  await setTimeout(5);
  global.gc?.();
  const inspector = new Session();
  inspector.connect();
  await inspector.post('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const initial = process.memoryUsage();
  const cpu = process.cpuUsage();
  const began = performance.now();
  const rssTrend = [];
  for (let i = 0; i < operations; i++) {
    // Identical bounded application work in both legs.
    let value = i;
    for (let n = 0; n < 64; n++) value = Math.imul(value ^ n, 1664525) + 1013904223;
    checksum ^= value;
    if (runtime) {
      counter.inc({ route: '/fixture/:id', method: 'GET' });
      runtime.startSpan('fixture.operation', { attributes: { route: '/fixture/:id' } }).end();
      if (i % 16 === 0) runtime.emitEvent('fixture', { sequence: i, bytes: 'x'.repeat(64) });
    }
    if (i % 128 === 0) await setImmediate();
    if (i % 2000 === 0) rssTrend.push(process.memoryUsage().rss);
  }
  const workloadMs = performance.now() - began;
  const workloadCpu = process.cpuUsage(cpu);
  const allocation = await inspector.post('HeapProfiler.stopSampling');
  inspector.disconnect();
  const allocatedBytes = node => node.selfSize + node.children.reduce((sum, child) => sum + allocatedBytes(child), 0);
  const afterWork = process.memoryUsage();
  const drainStart = performance.now();
  if (runtime) { await runtime.flush({ timeoutMs: 10_000, throwOnError: true }); await runtime.close({ timeoutMs: 10_000, throwOnError: true }); }
  const drainAndCloseMs = performance.now() - drainStart;
  await setTimeout(5);
  delay.disable();
  global.gc?.();
  const afterCleanup = process.memoryUsage();
  if (runtime) { assert.equal(runtime.closed, true); assert.equal(runtime.timers.size, 0); }
  return { enabled, operations, workloadMs, throughputPerSecond: operations * 1000 / workloadMs,
    cpuMs: { user: workloadCpu.user / 1000, system: workloadCpu.system / 1000 },
    memory: { initial, afterWork, afterCleanup, rssTrend, heapUsedChange: afterWork.heapUsed - initial.heapUsed, sampledAllocatedBytes: allocatedBytes(allocation.profile.head) },
    eventLoopMs: { mean: delay.mean / 1e6, p99: delay.percentile(99) / 1e6, max: delay.max / 1e6 },
    drainAndCloseMs, acceptedBySink, runtimeStats: runtime?.stats, pipeline: runtime?.pipeline.snapshot(),
    cleanup: runtime ? { closed: runtime.closed, ownedTimers: runtime.timers.size } : null };
}
// Warm both paths before retaining results.
await trial(false);
await trial(true);
const trials = [];
for (let i = 0; i < 3; i++) { trials.push(await trial(false)); trials.push(await trial(true)); }
console.log(JSON.stringify({ kind: 'bounded synthetic microbenchmark; no universal latency or production-load claim',
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemory: os.totalmem() },
  settings: { operations, labels: { route: '/fixture/:id', method: 'GET' }, sampleRate: 0.1, parentBased: false, sinkDelayMs: 2, batchSize: 128, maxItems: 512, maxInFlightBatches: 1, overflow: 'drop-oldest', gc: 'explicit --expose-gc between legs', allocation: 'V8 sampled allocation at 32768-byte interval, including collected objects; estimate includes harness overhead and perturbs timing' },
  checksum, trials }, null, 2));
