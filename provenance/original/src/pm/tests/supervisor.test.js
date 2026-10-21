'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ProcessRegistry } from '../src/foundation/ProcessRegistry.js';
import { Supervisor } from '../src/foundation/Supervisor.js';
import { LogMultiplexer } from '../src/logs/LogMultiplexer.js';
import { MetricsAggregator } from '../src/telemetry/MetricsAggregator.js';
import { sleep } from '../src/support/async.js';

const fixture = path.resolve('tests/fixtures/runtime-app.mjs');

test('supervisor starts, observes, diagnoses, and gracefully stops a fork worker', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawnode-pm-supervisor-'));
  const registry = new ProcessRegistry();
  const logs = new LogMultiplexer({ root: path.join(root, 'logs') });
  const metrics = new MetricsAggregator({ historyLimit: 10 });
  const supervisor = new Supervisor({ registry, logs, metrics, healthTickMs: 100 });
  try {
    const status = await supervisor.start({
      name: 'api',
      script: fixture,
      mode: 'fork',
      env: { READY_DELAY_MS: '10', RAWNODE_PM_TELEMETRY_INTERVAL: '50' },
      readiness: { mode: 'ipc', timeoutMs: 3_000 },
      health: { intervalMs: 100, timeoutMs: 500, heartbeatTimeoutMs: 1_000 },
      telemetry: { intervalMs: 50 },
      logs: { bufferBytes: 128 * 1024 },
    });
    assert.equal(status.activeInstances, 1);
    assert.equal(status.processes[0].state, 'running');
    await sleep(250);
    const running = registry.active('api', 0);
    assert.ok(running.metrics?.memory?.rss > 0);
    assert.ok(logs.query('api', { lines: 20 }).some((entry) => entry.line.includes('online:')));
    const diagnostics = await supervisor.diagnostics('api', { timeoutMs: 2_000 });
    assert.equal(diagnostics.diagnostics[0].result.fixture, true);

    const stopped = await supervisor.stop('api');
    assert.equal(stopped.activeInstances, 0);
    assert.ok(stopped.processes.some((entry) => entry.state === 'stopped'));
    assert.ok(logs.query('api', { lines: 50 }).some((entry) => entry.line.includes('draining:')));
  } finally {
    await supervisor.close();
    await logs.close();
  }
});

test('supervisor crash policy eventually quarantines an always-crashing process', async () => {
  const registry = new ProcessRegistry();
  const supervisor = new Supervisor({ registry, healthTickMs: 100 });
  try {
    await assert.rejects(() => supervisor.start({
      name: 'crashy',
      script: fixture,
      mode: 'fork',
      env: { CRASH_ALWAYS: '1', CRASH_DELAY_MS: '10' },
      readiness: { mode: 'ipc', timeoutMs: 1_000 },
      restart: { maxRestarts: 2, windowMs: 10_000, minDelayMs: 10, maxDelayMs: 10, jitter: 0 },
      logs: { enabled: false },
    }));
    const deadline = Date.now() + 3_000;
    while (!registry.get('crashy')?.quarantined && Date.now() < deadline) await sleep(25);
    assert.equal(registry.get('crashy').quarantined, true);
  } finally { await supervisor.close(); }
});
