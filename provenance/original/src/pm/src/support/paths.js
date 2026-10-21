'use strict';

import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function defaultStateDir() {
  if (process.env.RAWNODE_PM_HOME) return path.resolve(process.env.RAWNODE_PM_HOME);
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), 'RawNode', 'pm');
  }
  return path.join(os.homedir(), '.rawnode-pm');
}

export function controlSocketPath(stateDir = defaultStateDir()) {
  const digest = createHash('sha256').update(path.resolve(stateDir)).digest('hex').slice(0, 16);
  if (process.platform === 'win32') return `\\\\.\\pipe\\rawnode-pm-${digest}`;
  return path.join(os.tmpdir(), `rawnode-pm-${typeof process.getuid === 'function' ? process.getuid() : 'user'}-${digest}.sock`);
}

export function resolveStatePaths(stateDir = defaultStateDir()) {
  const root = path.resolve(stateDir);
  return Object.freeze({
    root,
    token: path.join(root, 'token'),
    state: path.join(root, 'state.json'),
    journal: path.join(root, 'journal.jsonl'),
    audit: path.join(root, 'audit.jsonl'),
    daemonPid: path.join(root, 'daemon.pid'),
    daemonLock: path.join(root, 'daemon.lock'),
    logs: path.join(root, 'logs'),
    incidents: path.join(root, 'incidents'),
    socket: controlSocketPath(root),
  });
}

export function safeName(value) {
  return String(value || 'process').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 128) || 'process';
}
