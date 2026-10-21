'use strict';

import { spawn } from 'node:child_process';
import { DriverHandle } from './DriverHandle.js';

export class ExternalProcessDriver {
  async spawn(definition, context = {}) {
    const child = spawn(definition.script, definition.args, {
      cwd: definition.cwd,
      env: {
        ...definition.env,
        RAWNODE_PM_MANAGED: '1',
        RAWNODE_PM_APP: definition.name,
        RAWNODE_PM_SLOT: String(context.slot ?? 0),
        RAWNODE_PM_GENERATION: String(context.generation ?? 0),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      uid: definition.uid,
      gid: definition.gid,
    });
    const handle = new DriverHandle({
      kind: 'external',
      child,
      connected: false,
      kill: (signal) => child.kill(signal),
    });
    child.on('spawn', () => handle.emit('spawn'));
    child.on('error', (error) => handle.emit('error', error));
    child.on('exit', (code, signal) => handle.emit('exit', code, signal));
    return handle;
  }
}

export default ExternalProcessDriver;
