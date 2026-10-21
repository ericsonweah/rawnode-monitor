'use strict';

import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { createLogger, MemoryTransport, NullTransport, EnterpriseFileTransport, SafeSerializer } from '../../index.js';

function numeric(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}

async function measure(name, iterations, operation, cleanup = null) {
  const startCpu = process.cpuUsage();
  const startHeap = process.memoryUsage().heapUsed;
  const started = performance.now();
  await operation();
  const elapsedMs = performance.now() - started;
  const cpu = process.cpuUsage(startCpu);
  const endHeap = process.memoryUsage().heapUsed;
  await cleanup?.();
  return {
    name,
    iterations,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    operationsPerSecond: Math.round(iterations / Math.max(0.001, elapsedMs) * 1000),
    cpuMs: Number(((cpu.user + cpu.system) / 1000).toFixed(3)),
    heapDeltaBytes: endHeap - startHeap,
  };
}

export async function runBenchmarks(options = {}) {
  const iterations = numeric(options.iterations, 100_000);
  const acceptedIterations = Math.min(iterations, numeric(options.acceptedIterations, 25_000));
  const serializerIterations = Math.min(iterations, numeric(options.serializerIterations, 50_000));
  const results = [];
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  await new Promise((resolve) => setImmediate(resolve));

  const disabled = createLogger({ profile: 'production', level: 'info', transports: [new NullTransport()] });
  results.push(await measure('disabled-level-fast-path', iterations, async () => {
    for (let index = 0; index < iterations; index++) disabled.debug('disabled', { index });
  }, () => disabled.close()));

  const memory = new MemoryTransport({ maxItems: Math.max(acceptedIterations, 1000), clone: false });
  const accepted = createLogger({ profile: 'production', level: 'debug', transports: [memory] });
  results.push(await measure('accepted-structured-records', acceptedIterations, async () => {
    for (let index = 0; index < acceptedIterations; index++) accepted.info('accepted', { index, ok: true });
    await accepted.flush();
  }, () => accepted.close()));

  const serializer = new SafeSerializer();
  const object = { id: 42n, nested: { values: [1, 2, 3], token: 'secret' }, error: new Error('benchmark') };
  object.self = object;
  results.push(await measure('safe-serialization', serializerIterations, async () => {
    for (let index = 0; index < serializerIterations; index++) serializer.stringify(object);
  }));

  if (options.file === true) {
    const file = path.join(tmpdir(), `rawnode-logger-bench-${process.pid}-${Date.now()}.log`);
    const transport = new EnterpriseFileTransport({ logDirectory: path.dirname(file), fileName: path.basename(file), rotateInterval: 0, durability: 'none' });
    const logger = createLogger({ profile: 'production', level: 'info', transports: [transport] });
    const fileIterations = Math.min(acceptedIterations, 10_000);
    results.push(await measure('file-transport-delivery', fileIterations, async () => {
      for (let index = 0; index < fileIterations; index++) logger.info('file', { index });
      await logger.flush();
    }, async () => { await logger.close(); await rm(file, { force: true }); }));
  }

  await new Promise((resolve) => setImmediate(resolve));
  delay.disable();
  return {
    schemaVersion: 1,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    iterations,
    results,
    eventLoopDelayMs: {
      min: Number((delay.min / 1e6).toFixed(3)),
      max: Number((delay.max / 1e6).toFixed(3)),
      mean: Number((delay.mean / 1e6).toFixed(3)),
      p99: Number((delay.percentile(99) / 1e6).toFixed(3)),
    },
  };
}

async function main() {
  const report = await runBenchmarks({
    iterations: process.env.LOG_BENCH_ITERATIONS,
    file: process.argv.includes('--file'),
  });
  if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    console.table(report.results);
    console.log('Event-loop delay:', report.eventLoopDelayMs);
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
}
