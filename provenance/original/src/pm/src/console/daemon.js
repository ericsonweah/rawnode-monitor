'use strict';

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ControlClient } from '../control/ControlClient.js';
import { resolveStatePaths } from '../support/paths.js';
import { sleep } from '../support/async.js';

export const RAWNODE_PM_BIN = fileURLToPath(new URL('../../bin/rawnode-pm.js', import.meta.url));

export function createClient(options = {}) {
  const paths = resolveStatePaths(options.stateDir);
  return new ControlClient({ socketPath: paths.socket, tokenPath: paths.token, timeoutMs: options.timeoutMs || 10_000 });
}

export async function pingDaemon(options = {}) {
  try { return await createClient(options).request('ping', {}, { timeoutMs: options.timeoutMs || 750 }); }
  catch { return null; }
}

export async function ensureDaemon(options = {}) {
  const existing = await pingDaemon(options);
  if (existing) return createClient(options);

  const args = [RAWNODE_PM_BIN, 'daemon'];
  if (options.stateDir) args.push('--state-dir', options.stateDir);
  if (options.cwd) args.push('--cwd', options.cwd);
  if (options.resurrect) args.push('--resurrect');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    cwd: options.cwd || process.cwd(),
    env: { ...process.env },
    windowsHide: true,
  });
  child.unref();

  const deadline = Date.now() + (options.startTimeoutMs || 10_000);
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const client = createClient(options);
      await client.request('ping', {}, { timeoutMs: 500 });
      return client;
    } catch (error) { lastError = error; }
    await sleep(100);
  }
  const error = new Error(`RawNode PM daemon did not become ready.${lastError ? ` ${lastError.message}` : ''}`);
  error.code = 'RNPM_DAEMON_START_TIMEOUT';
  throw error;
}
