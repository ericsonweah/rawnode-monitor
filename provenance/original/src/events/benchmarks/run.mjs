'use strict';

import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import { AdvancedEventDispatcher } from '../index.js';

function option(name, fallback) {
  const flag = `--${name}`;
  const inlinePrefix = `${flag}=`;
  const inline = process.argv.find((value) => value.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const json = process.argv.includes('--json');
const iterations = Math.max(1, Math.min(10_000_000, Number(option('iterations', 250_000)) || 250_000));
const patternCount = Math.max(0, Math.min(100_000, Number(option('patterns', 100)) || 0));
const warmup = Math.max(0, Math.min(1_000_000, Number(option('warmup', Math.min(25_000, iterations))) || 0));
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function memoryDelta(before) {
  return process.memoryUsage().heapUsed - before;
}

function measureSync(name, operation, count = iterations) {
  for (let index = 0; index < Math.min(warmup, count); index++) operation(index);
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let index = 0; index < count; index++) operation(index);
  const elapsedMs = performance.now() - started;
  return {
    name,
    mode: 'sync',
    iterations: count,
    elapsedMs,
    operationsPerSecond: elapsedMs ? Math.round(count / elapsedMs * 1000) : Infinity,
    nanosecondsPerOperation: elapsedMs ? Math.round(elapsedMs * 1e6 / count) : 0,
    heapDeltaBytes: memoryDelta(before),
  };
}

async function measureAsync(name, operation, count = Math.min(iterations, 50_000)) {
  for (let index = 0; index < Math.min(warmup, count); index++) await operation(index);
  const before = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let index = 0; index < count; index++) await operation(index);
  const elapsedMs = performance.now() - started;
  return {
    name,
    mode: 'async',
    iterations: count,
    elapsedMs,
    operationsPerSecond: elapsedMs ? Math.round(count / elapsedMs * 1000) : Infinity,
    nanosecondsPerOperation: elapsedMs ? Math.round(elapsedMs * 1e6 / count) : 0,
    heapDeltaBytes: memoryDelta(before),
  };
}

const delayHistogram = monitorEventLoopDelay({ resolution: 10 });
delayHistogram.enable();
await yieldImmediate();
const results = [];

{
  const bus = new AdvancedEventDispatcher({ logger: silentLogger });
  results.push(measureSync('no-listener', () => bus.dispatch('bench:none')));
  await bus.close({ force: true });
  await yieldImmediate();
}
{
  const bus = new AdvancedEventDispatcher({ logger: silentLogger });
  let sink = 0;
  bus.on('bench:exact', (value) => { sink += value; });
  results.push(measureSync('exact-one-listener', () => bus.dispatch('bench:exact', 1)));
  results.at(-1).sink = sink;
  await bus.close({ force: true });
  await yieldImmediate();
}
{
  const bus = new AdvancedEventDispatcher({ logger: silentLogger });
  let sink = 0;
  bus.on('bench:request:*', () => { sink++; });
  bus.on('bench:*', () => { sink++; });
  results.push(measureSync('hierarchical-two-listeners', () => bus.dispatch('bench:request:received')));
  results.at(-1).sink = sink;
  await bus.close({ force: true });
  await yieldImmediate();
}
{
  const bus = new AdvancedEventDispatcher({ logger: silentLogger, planCacheMax: Math.max(1024, patternCount + 8) });
  let sink = 0;
  for (let index = 0; index < patternCount; index++) bus.onPattern(`domain:${index}:**`, () => { sink++; });
  bus.onPattern('domain:target:**', () => { sink++; });
  results.push(measureSync(`indexed-${patternCount + 1}-patterns`, () => bus.dispatch('domain:target:created')));
  results.at(-1).sink = sink;
  await bus.close({ force: true });
  await yieldImmediate();
}
{
  const bus = new AdvancedEventDispatcher({ logger: silentLogger });
  bus.on('bench:async', async (value) => value + 1);
  results.push(await measureAsync('async-sequential-one-listener', () => bus.dispatchAsync('bench:async', 1)));
  await bus.close({ force: true });
  await yieldImmediate();
}

await yieldImmediate();
delayHistogram.disable();
const report = {
  schemaVersion: 1,
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  generatedAt: new Date().toISOString(),
  configuration: { iterations, warmup, patternCount },
  eventLoopDelayMs: {
    mean: Number.isFinite(delayHistogram.mean) ? delayHistogram.mean / 1e6 : 0,
    p99: delayHistogram.percentile(99) / 1e6,
    max: delayHistogram.max / 1e6,
  },
  notes: [
    'Results are directional microbenchmarks, not cross-framework HTTP benchmarks.',
    'Synchronous scenarios do not await each operation; the async scenario awaits sequential dispatch.',
    'Heap deltas are noisy and should be interpreted only across repeated controlled runs.',
  ],
  results,
};

if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else {
  for (const result of results) {
    process.stdout.write(`${result.name}: ${result.operationsPerSecond.toLocaleString()} ops/s (${result.nanosecondsPerOperation} ns/op)\n`);
  }
}
