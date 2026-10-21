'use strict';

import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { AdvancedEventDispatcher as EnterpriseDispatcher } from '../src/events/AdvancedEventDispatcher.js';

function arg(name, fallback) {
  const flag = `--${name}`;
  const inline = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const baselinePath = path.resolve(arg('baseline', '/mnt/data/rawnode-events-baseline/src/events/AdvancedEventDispatcher.js'));
const { AdvancedEventDispatcher: BaselineDispatcher } = await import(pathToFileURL(baselinePath).href);
const iterations = Math.max(10_000, Math.min(5_000_000, Number(arg('iterations', 500_000)) || 500_000));
const rounds = Math.max(3, Math.min(15, Number(arg('rounds', 7)) || 7));
const patterns = Math.max(10, Math.min(20_000, Number(arg('patterns', 1000)) || 1000));
const silentLogger = { debug() {}, info() {}, warn() {}, error() {}, log() {} };

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function measure(factory, setup, operation, count) {
  const samples = [];
  let sink = 0;
  for (let round = 0; round < rounds; round++) {
    const bus = factory();
    setup(bus, () => { sink++; });
    for (let index = 0; index < Math.min(50_000, count); index++) operation(bus, index);
    const started = performance.now();
    for (let index = 0; index < count; index++) operation(bus, index);
    samples.push(performance.now() - started);
    void bus.close?.({ force: true });
  }
  const elapsedMs = median(samples);
  return {
    elapsedMs,
    operationsPerSecond: Math.round(count / elapsedMs * 1000),
    nanosecondsPerOperation: Math.round(elapsedMs * 1e6 / count),
    samplesMs: samples,
    observedInvocations: sink,
  };
}

const implementations = {
  baseline: () => new BaselineDispatcher({ logger: silentLogger, historyLimit: 0, metrics: false }),
  enterprise: () => new EnterpriseDispatcher({ profile: 'compat', logger: silentLogger, historyLimit: 0, metrics: false }),
};

const scenarios = [
  {
    name: 'no-listener', count: iterations,
    setup() {}, operation(bus) { bus.dispatch('bench:none'); },
  },
  {
    name: 'one-exact-listener', count: iterations,
    setup(bus, sink) { bus.on('bench:exact', sink); }, operation(bus) { bus.dispatch('bench:exact', 1); },
  },
  {
    name: 'hierarchical-two-listeners', count: iterations,
    setup(bus, sink) { bus.on('bench:request:*', sink); bus.on('bench:*', sink); },
    operation(bus) { bus.dispatch('bench:request:received'); },
  },
  {
    name: `${patterns}-patterns-one-match`, count: Math.min(iterations, Math.max(1_000, Math.floor(5_000_000 / patterns))),
    setup(bus, sink) {
      for (let index = 0; index < patterns; index++) bus.onPattern(`domain:${index}:**`, sink);
      bus.onPattern('domain:target:**', sink);
    },
    operation(bus) { bus.dispatch('domain:target:created'); },
  },
];

const results = [];
for (const scenario of scenarios) {
  const baseline = measure(implementations.baseline, scenario.setup, scenario.operation, scenario.count);
  const enterprise = measure(implementations.enterprise, scenario.setup, scenario.operation, scenario.count);
  results.push({
    scenario: scenario.name,
    iterations: scenario.count,
    baseline,
    enterprise,
    enterpriseVsBaseline: {
      throughputRatio: enterprise.operationsPerSecond / baseline.operationsPerSecond,
      latencyChangePercent: (enterprise.nanosecondsPerOperation - baseline.nanosecondsPerOperation) / baseline.nanosecondsPerOperation * 100,
    },
  });
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  baselinePath,
  rounds,
  iterations,
  patterns,
  notes: [
    'Median in-process microbenchmark on one host; not an HTTP/framework benchmark.',
    'Results are directional and should be repeated on production-class hardware.',
    'Both implementations run with history and metrics disabled.',
  ],
  results,
}, null, 2)}\n`);
