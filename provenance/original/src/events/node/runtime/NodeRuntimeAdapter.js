'use strict';

import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { hostname } from 'node:os';
import { UniversalRuntimeAdapter } from '../../universal/runtime/UniversalRuntimeAdapter.js';

export class NodeRuntimeAdapter extends UniversalRuntimeAdapter {
  constructor(options = {}) {
    super({
      ...options,
      name: options.name || 'node',
      id: options.id || `${hostname()}:${process.pid}`,
      now: options.now || Date.now,
      monotonicNow: options.monotonicNow || (() => performance.now()),
      randomId: options.randomId || ((prefix = 'id') => `${prefix}_${randomUUID()}`),
      schedule: options.schedule || ((callback) => setImmediate(callback)),
    });
    this.process = options.process || process;
  }
  capabilities() {
    return Object.freeze({
      ...super.capabilities(),
      asyncLocalStorage: true,
      diagnosticsChannel: true,
      workerThreads: true,
      processSignals: true,
      pid: this.process.pid,
      node: this.process.versions?.node || null,
    });
  }
}
export default NodeRuntimeAdapter;
