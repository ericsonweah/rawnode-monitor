'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { ProcessManager } from '../src/foundation/ProcessManager.js';

test('management HTTP server exposes redacted public health and authenticated operations', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawnode-pm-http-'));
  const manager = new ProcessManager({
    stateDir: root,
    managementEnabled: true,
    managementHost: '127.0.0.1',
    managementPort: 0,
  });

  try {
    await manager.start();
    const address = manager.management.address();
    assert.equal(typeof address?.port, 'number');
    const base = `http://127.0.0.1:${address.port}`;

    const publicHealthResponse = await fetch(`${base}/health`);
    assert.equal(publicHealthResponse.status, 200);
    const publicHealth = await publicHealthResponse.json();
    assert.equal(publicHealth.ok, true);
    assert.equal('socket' in publicHealth, false);
    assert.equal('stateDir' in publicHealth, false);
    assert.equal('pid' in publicHealth, false);

    const unauthorizedMetrics = await fetch(`${base}/metrics`);
    assert.equal(unauthorizedMetrics.status, 401);

    const token = (await readFile(manager.paths.token, 'utf8')).trim();
    const auth = { Authorization: `Bearer ${token}` };
    const metricsResponse = await fetch(`${base}/metrics`, { headers: auth });
    assert.equal(metricsResponse.status, 200);
    assert.match(await metricsResponse.text(), /rawnode_pm_up 1/);

    const commandResponse = await fetch(`${base}/v1/command`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'ping' }),
    });
    assert.equal(commandResponse.status, 200);
    const command = await commandResponse.json();
    assert.equal(command.result.ok, true);

    const invalidJsonResponse = await fetch(`${base}/v1/command`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{invalid',
    });
    assert.equal(invalidJsonResponse.status, 400);
  } finally {
    await manager.close();
  }
});
