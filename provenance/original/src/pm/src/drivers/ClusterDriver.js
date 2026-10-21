'use strict';

import cluster from 'node:cluster';
import { DriverHandle } from './DriverHandle.js';
import { AsyncLock } from '../support/async.js';

function sendAsync(worker, message) {
  return new Promise((resolve, reject) => {
    if (!worker.isConnected()) return resolve(false);
    worker.send(message, (error) => error ? reject(error) : resolve(true));
  });
}

export class ClusterDriver {
  constructor(options = {}) {
    if (!cluster.isPrimary) throw new Error('ClusterDriver must run in the supervisor primary process.');
    this.options = options;
    // Node cluster settings are process-global. Serializing setupPrimary()+fork()
    // prevents definitions for concurrent applications from crossing over.
    this._spawnLock = new AsyncLock();
  }

  async spawn(definition, context = {}) {
    return this._spawnLock.run(async () => {
      cluster.setupPrimary({
        exec: definition.script,
        args: [...definition.args],
        execArgv: [...definition.nodeArgs],
        cwd: definition.cwd,
        silent: true,
        serialization: 'advanced',
        windowsHide: true,
        uid: definition.uid,
        gid: definition.gid,
      });
      const worker = cluster.fork({
        ...definition.env,
        RAWNODE_PM_MANAGED: '1',
        RAWNODE_PM_CLUSTER: '1',
        RAWNODE_PM_APP: definition.name,
        RAWNODE_PM_SLOT: String(context.slot ?? 0),
        RAWNODE_PM_GENERATION: String(context.generation ?? 0),
        RAWNODE_PM_TELEMETRY_INTERVAL: String(definition.telemetry.intervalMs),
      });
      const handle = new DriverHandle({
        kind: 'cluster',
        worker,
        child: worker.process,
        send: (message) => sendAsync(worker, message),
        kill: (signal) => worker.process.kill(signal),
        disconnect: () => worker.disconnect(),
      });
      worker.on('online', () => handle.emit('spawn'));
      worker.on('listening', (address) => handle.emit('listening', address));
      worker.on('message', (message, sendHandle) => handle.emit('message', message, sendHandle));
      worker.on('error', (error) => handle.emit('error', error));
      worker.on('disconnect', () => { handle.connected = false; handle.emit('disconnect'); });
      worker.on('exit', (code, signal) => { handle.connected = false; handle.emit('exit', code, signal); });
      return handle;
    });
  }
}

export default ClusterDriver;
