'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ControlAuthenticator } from '../src/security/ControlAuthenticator.js';
import { ControlServer } from '../src/control/ControlServer.js';
import { ControlClient } from '../src/control/ControlClient.js';

 test('control server authenticates requests and streams events', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawnode-pm-control-'));
  const tokenPath = path.join(root, 'token');
  const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\rawnode-pm-test-${process.pid}-${Date.now()}` : path.join(root, 'control.sock');
  const auth = new ControlAuthenticator({ tokenPath });
  await auth.initialize();
  const server = new ControlServer({ socketPath, authenticator: auth, handler: async (command) => ({ command }) });
  await server.start();
  if (process.platform !== 'win32') {
    assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
    assert.equal((await stat(socketPath)).mode & 0o777, 0o600);
  }
  try {
    const client = new ControlClient({ socketPath, tokenPath });
    assert.deepEqual(await client.request('ping'), { command: 'ping' });
    const eventPromise = new Promise(async (resolve) => {
      const close = await client.subscribe({ events: ['test:event'] }, (packet) => { close(); resolve(packet); });
      server.broadcast('test:event', { value: 42 });
    });
    const packet = await eventPromise;
    assert.equal(packet.payload.value, 42);

    const bad = new ControlClient({ socketPath, token: 'wrong-token' });
    await assert.rejects(() => bad.request('ping'), (error) => error.code === 'RNPM_UNAUTHORIZED');
  } finally { await server.close(); }
});
