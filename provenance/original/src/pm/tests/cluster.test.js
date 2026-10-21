'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ProcessRegistry } from '../src/foundation/ProcessRegistry.js';
import { Supervisor } from '../src/foundation/Supervisor.js';

const fixture = path.resolve('tests/fixtures/runtime-app.mjs');

test('cluster driver scales and performs readiness-gated rolling reload', { timeout: 20_000 }, async () => {
  const registry = new ProcessRegistry();
  const supervisor = new Supervisor({ registry, healthTickMs: 100 });
  try {
    const initial = await supervisor.start({
      name: 'cluster-api',
      script: fixture,
      mode: 'cluster',
      instances: 2,
      env: { READY_DELAY_MS: '10' },
      readiness: { mode: 'ipc', timeoutMs: 4_000 },
      health: { heartbeatTimeoutMs: 2_000 },
      logs: { enabled: false },
      telemetry: { intervalMs: 100 },
    });
    assert.equal(initial.activeInstances, 2);
    const oldPids = registry.active('cluster-api').map((record) => record.pid);

    const reloaded = await supervisor.reload('cluster-api');
    const newPids = registry.active('cluster-api').map((record) => record.pid);
    assert.equal(reloaded.activeInstances, 2);
    assert.ok(newPids.every((pid) => !oldPids.includes(pid)));

    const scaled = await supervisor.scale('cluster-api', 3);
    assert.equal(scaled.activeInstances, 3);
    const down = await supervisor.scale('cluster-api', 1);
    assert.equal(down.activeInstances, 1);
  } finally { await supervisor.close(); }
});
