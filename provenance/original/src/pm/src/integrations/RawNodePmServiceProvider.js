'use strict';

import path from 'node:path';
import { RuntimeAgent } from '../runtime/RuntimeAgent.js';
import { RawNodeRuntimeAdapter } from '../runtime/RawNodeRuntimeAdapter.js';
import { RAWNODE_PM_COMMANDS } from './commands.js';

function safeResolve(app, key, fallback = null) {
  try { return app?.resolve?.(key) ?? fallback; } catch { return fallback; }
}

function configGet(app, key, fallback = undefined) {
  const config = safeResolve(app, 'config');
  try {
    const value = config?.get?.(key);
    return value === undefined ? fallback : value;
  } catch { return fallback; }
}

export class RawNodePmServiceProvider {
  static dependencies = ['app'];
  static priority = 1_000;

  constructor(app) {
    this.app = app;
    this.runtime = null;
  }

  register() {
    const app = this.app;
    app.singleton('runtime.pm.adapter', () => new RawNodeRuntimeAdapter({
      app,
      logger: safeResolve(app, 'logger', console),
      incidentDir: path.resolve(app.rootPath || process.cwd(), configGet(app, 'pm.runtime.incidentDir', 'storage/framework/pm/incidents')),
    }));
    app.singleton('runtime.pm', () => {
      this.runtime = new RuntimeAgent({
        adapter: app.resolve('runtime.pm.adapter'),
        managed: process.env.RAWNODE_PM_MANAGED === '1',
        intervalMs: configGet(app, 'pm.runtime.telemetryIntervalMs', 2_000),
        captureSignals: configGet(app, 'pm.runtime.captureSignals', true),
      });
      return this.runtime;
    });
    app.singleton('pm.runtime', () => app.resolve('runtime.pm'));

    if (typeof app.runtime !== 'function') app.runtime = () => app.resolve('runtime.pm');
    if (typeof app.runtimeReady !== 'function') app.runtimeReady = (meta = {}) => app.resolve('runtime.pm').ready(meta);
  }

  async boot() {
    const enabled = configGet(this.app, 'pm.runtime.enabled', process.env.RAWNODE_PM_MANAGED === '1');
    if (enabled) {
      const runtime = this.app.resolve('runtime.pm');
      runtime.start({ framework: 'rawnode' });
      if (configGet(this.app, 'pm.runtime.autoReadyAfterBoot', false)) runtime.ready({ source: 'provider-boot' });
    }

    const registry = safeResolve(this.app, 'console.registry');
    if (registry?.addMany) registry.addMany(RAWNODE_PM_COMMANDS);
  }

  async teardown() {
    await this.runtime?.close?.();
  }
}

export default RawNodePmServiceProvider;
