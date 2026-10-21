'use strict';

import { ControlClient } from '../control/ControlClient.js';
import { resolveStatePaths } from '../support/paths.js';

function configGet(app, key, fallback = undefined) {
  try {
    const config = app?.resolve?.('config');
    const value = config?.get?.(key);
    return value === undefined ? fallback : value;
  } catch { return fallback; }
}

class BasePmCommand {
  constructor(app) {
    this.app = app;
    this.signature = '';
    this.description = '';
    this.args = Object.create(null);
    this.flags = Object.create(null);
  }

  parse(argv = []) {
    const parts = this.signature.trim().split(/\s+/);
    if (parts[0] !== argv[0]) return false;
    const positionals = [];
    for (let index = 1; index < argv.length; index++) {
      const value = argv[index];
      if (value.startsWith('--')) {
        const [key, item] = value.slice(2).split('=');
        this.flags[key] = item ?? true;
      } else positionals.push(value);
    }
    let cursor = 0;
    for (const part of parts.slice(1)) if (part.startsWith('{') && part.endsWith('}')) this.args[part.slice(1, -1)] = positionals[cursor++];
    return true;
  }

  argument(name) { return this.args[name]; }
  option(name, fallback = undefined) { return this.flags[name] ?? fallback; }

  async client() {
    const paths = resolveStatePaths(configGet(this.app, 'pm.stateDir', process.env.RAWNODE_PM_HOME));
    return new ControlClient({ socketPath: paths.socket, tokenPath: paths.token });
  }

  output(value) {
    if (this.option('json') === true) console.log(JSON.stringify(value, null, 2));
    else console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  }
}

export class PmStatusCommand extends BasePmCommand {
  constructor(app) { super(app); this.signature = 'pm:status {name}'; this.description = 'Show RawNode PM process status'; }
  async handle() { this.output(await (await this.client()).request('status', { name: this.argument('name') || null })); }
}

export class PmStartCommand extends BasePmCommand {
  constructor(app) { super(app); this.signature = 'pm:start {manifest}'; this.description = 'Start applications from a RawNode PM manifest'; }
  async handle() { this.output(await (await this.client()).request('start', { manifest: this.argument('manifest') || null, name: this.option('name') || null, force: this.option('force') === true }, { timeoutMs: 120_000 })); }
}

export class PmStopCommand extends BasePmCommand {
  constructor(app) { super(app); this.signature = 'pm:stop {name}'; this.description = 'Gracefully stop a managed application'; }
  async handle() { this.output(await (await this.client()).request('stop', { name: this.argument('name') })); }
}

export class PmRestartCommand extends BasePmCommand {
  constructor(app) { super(app); this.signature = 'pm:restart {name}'; this.description = 'Restart a managed application'; }
  async handle() { this.output(await (await this.client()).request('restart', { name: this.argument('name') }, { timeoutMs: 120_000 })); }
}

export class PmReloadCommand extends BasePmCommand {
  constructor(app) { super(app); this.signature = 'pm:reload {name}'; this.description = 'Readiness-gated rolling reload'; }
  async handle() { this.output(await (await this.client()).request('reload', { name: this.argument('name') }, { timeoutMs: 120_000 })); }
}

export class PmScaleCommand extends BasePmCommand {
  constructor(app) { super(app); this.signature = 'pm:scale {name} {instances}'; this.description = 'Scale a cluster application'; }
  async handle() { this.output(await (await this.client()).request('scale', { name: this.argument('name'), instances: Number(this.argument('instances')) }, { timeoutMs: 120_000 })); }
}

export class PmDoctorCommand extends BasePmCommand {
  constructor(app) { super(app); this.signature = 'pm:doctor'; this.description = 'Diagnose RawNode PM runtime health'; }
  async handle() { this.output(await (await this.client()).request('doctor')); }
}

export const RAWNODE_PM_COMMANDS = Object.freeze([
  PmStatusCommand,
  PmStartCommand,
  PmStopCommand,
  PmRestartCommand,
  PmReloadCommand,
  PmScaleCommand,
  PmDoctorCommand,
]);
