'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { ProcessManager } from '../src/foundation/ProcessManager.js';
import { ControlClient } from '../src/control/ControlClient.js';
import { resolveStatePaths } from '../src/support/paths.js';

const fixture = path.resolve('tests/fixtures/runtime-app.mjs');

test('process manager provides authenticated control, encrypted save, and resurrection', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawnode-pm-manager-'));
  const stateDir = path.join(root, 'state');
  const manifest = path.join(root, 'rawnode.process.mjs');
  await writeFile(manifest, `export default { apps: [{
    name: 'managed-api',
    script: ${JSON.stringify(fixture)},
    mode: 'fork',
    env: { APP_MARKER: 'encrypted-marker', READY_DELAY_MS: '10' },
    readiness: { mode: 'ipc', timeoutMs: 3000 },
    health: { heartbeatTimeoutMs: 2000 },
    telemetry: { intervalMs: 100 },
    logs: { enabled: true }
  }] };\n`);

  const paths = resolveStatePaths(stateDir);
  const first = new ProcessManager({ stateDir, cwd: root });
  await first.start();
  try {
    const client = new ControlClient({ socketPath: paths.socket, tokenPath: paths.token });
    assert.equal((await client.request('ping')).ok, true);
    const started = await client.request('start', { manifest }, { timeoutMs: 10_000 });
    assert.equal(started.activeInstances, 1);
    assert.equal(started.processes[0].state, 'running');
    const health = await client.request('health');
    assert.equal(health.ready, true);
    await client.request('save');
    const rawState = await readFile(paths.state, 'utf8');
    assert.doesNotMatch(rawState, /encrypted-marker/);
  } finally { await first.close(); }

  const second = new ProcessManager({ stateDir, cwd: root });
  await second.start({ resurrect: true });
  try {
    const status = second.supervisor.status('managed-api');
    assert.equal(status.activeInstances, 1);
    assert.equal(status.processes[0].state, 'running');
    await second.stopProcess('managed-api');
  } finally { await second.close(); }
});


test('process manager rolls back lock, PID, sockets, and timers after startup failure', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawnode-pm-start-rollback-'));
  const stateDir = path.join(root, 'state');
  const paths = resolveStatePaths(stateDir);
  const occupied = http.createServer((_req, res) => res.end('occupied'));
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  const port = occupied.address().port;

  const failed = new ProcessManager({
    stateDir,
    cwd: root,
    managementEnabled: true,
    managementHost: '127.0.0.1',
    managementPort: port,
  });

  try {
    await assert.rejects(
      () => failed.start(),
      (error) => error?.code === 'EADDRINUSE',
    );
    assert.equal(failed.closed, true);
    await assert.rejects(() => stat(paths.daemonLock), (error) => error?.code === 'ENOENT');
    await assert.rejects(() => stat(paths.daemonPid), (error) => error?.code === 'ENOENT');
    if (process.platform !== 'win32') {
      await assert.rejects(() => stat(paths.socket), (error) => error?.code === 'ENOENT');
    }
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }

  const recovered = new ProcessManager({ stateDir, cwd: root, managementEnabled: false });
  await recovered.start();
  try {
    assert.equal(recovered.health().ok, true);
  } finally {
    await recovered.close();
  }
});
