'use strict';

import { fork } from 'node:child_process';
import { DriverHandle } from './DriverHandle.js';

function sendAsync(child, message) {
  return new Promise((resolve, reject) => {
    if (!child.connected) return resolve(false);
    child.send(message, (error) => error ? reject(error) : resolve(true));
  });
}

export class ForkDriver {
  constructor(options = {}) {
    this.options = options;
  }

  async spawn(definition, context = {}) {
    const env = {
      ...definition.env,
      RAWNODE_PM_MANAGED: '1',
      RAWNODE_PM_APP: definition.name,
      RAWNODE_PM_SLOT: String(context.slot ?? 0),
      RAWNODE_PM_GENERATION: String(context.generation ?? 0),
      RAWNODE_PM_TELEMETRY_INTERVAL: String(definition.telemetry.intervalMs),
    };
    const child = fork(definition.script, definition.args, {
      cwd: definition.cwd,
      env,
      execPath: definition.interpreter || process.execPath,
      execArgv: [...definition.nodeArgs],
      silent: true,
      serialization: 'advanced',
      windowsHide: true,
      uid: definition.uid,
      gid: definition.gid,
    });
    const handle = new DriverHandle({
      kind: 'fork',
      child,
      send: (message) => sendAsync(child, message),
      kill: (signal) => child.kill(signal),
      disconnect: () => child.disconnect?.(),
    });
    child.on('spawn', () => handle.emit('spawn'));
    child.on('message', (message, sendHandle) => handle.emit('message', message, sendHandle));
    child.on('error', (error) => handle.emit('error', error));
    child.on('disconnect', () => { handle.connected = false; handle.emit('disconnect'); });
    child.on('exit', (code, signal) => { handle.connected = false; handle.emit('exit', code, signal); });
    return handle;
  }
}

export default ForkDriver;
