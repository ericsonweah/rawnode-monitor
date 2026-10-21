'use strict';

import { ProcessManager } from '../foundation/ProcessManager.js';
import { parseArgs, numberOption } from './arguments.js';
import { ensureDaemon, createClient, pingDaemon, RAWNODE_PM_BIN } from './daemon.js';
import { renderStatus, print, style } from './format.js';
import { StartupGenerator } from '../integrations/StartupGenerator.js';
import { RawNodeIntegrator } from '../integrations/RawNodeIntegrator.js';
import { atomicWriteFile } from '../support/fs.js';
import { resolveStatePaths } from '../support/paths.js';
import path from 'node:path';

function usage() {
  return `RawNode PM — RawNode-aware runtime control plane

Usage:
  rawnode-pm start [manifest] [--name app] [--instances N] [--force]
  rawnode-pm stop <app>
  rawnode-pm restart <app>
  rawnode-pm reload <app>
  rawnode-pm scale <app> <instances>
  rawnode-pm status [app] [--json]
  rawnode-pm show <app> [--json]
  rawnode-pm logs <app> [--lines 100] [--stream stdout|stderr] [--follow]
  rawnode-pm monitor [--app name]
  rawnode-pm metrics [--prometheus] [--json]
  rawnode-pm health [--json]
  rawnode-pm doctor [--json]
  rawnode-pm diagnostics <app>
  rawnode-pm save
  rawnode-pm resurrect
  rawnode-pm startup [systemd|launchd] [--output file] [--user-service]
  rawnode-pm integrate [--root path] [--dry-run] [--force]
  rawnode-pm delete <app>
  rawnode-pm kill
  rawnode-pm daemon [--resurrect]

Global options:
  --state-dir <path>   Override ~/.rawnode-pm
  --cwd <path>         Project directory
  --json               Machine-readable output
`;
}

async function integrateRawNode(options, global) {
  const integrator = new RawNodeIntegrator({
    root: options.root || global.cwd,
    applicationFile: options.application,
    serveFile: options.serve,
    configFile: options.config,
    manifestFile: options.manifest,
  });
  const result = await integrator.integrate({
    dryRun: options['dry-run'] === true || options.dryRun === true,
    force: options.force === true,
  });
  print(result, { json: true });
  return 0;
}

async function generateStartup(positionals, options, global) {
  const platform = positionals[0] || options.platform || process.platform;
  const stateDir = resolveStatePaths(global.stateDir).root;
  const generator = new StartupGenerator({
    nodePath: process.execPath,
    binPath: options.bin || RAWNODE_PM_BIN,
    stateDir,
    cwd: global.cwd,
    user: options.user || null,
    group: options.group || null,
    userService: options['user-service'] === true,
    label: options.label || 'org.rawnode.pm',
    resurrect: options.resurrect !== false,
  });
  const result = generator.generate(platform);
  if (options.output) {
    const file = path.resolve(global.cwd, String(options.output));
    await atomicWriteFile(file, result.content, { encoding: 'utf8', mode: 0o600 });
    print({ ok: true, platform: result.platform, file, installTarget: result.installTarget }, { json: options.json });
  } else {
    process.stdout.write(result.content);
  }
  return 0;
}

async function runDaemon(options) {
  const manager = new ProcessManager({ stateDir: options['state-dir'], cwd: options.cwd });
  const done = new Promise((resolve) => manager.once('closed', resolve));
  const shutdown = () => manager.close().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGHUP', () => manager.saveState().catch(() => {}));
  await manager.start({ resurrect: options.resurrect === true });
  await done;
  return 0;
}

async function followLogs(client, name, options) {
  const initial = await client.request('logs', { name, lines: numberOption(options.lines, 100), stream: options.stream });
  for (const entry of initial) process.stdout.write(`[${new Date(entry.at).toISOString()}] ${entry.name}:${entry.slot} ${entry.stream} ${entry.line}\n`);
  const close = await client.subscribe({ events: ['log:line'], app: name }, (packet) => {
    const entry = packet.payload;
    if (options.stream && entry.stream !== options.stream) return;
    process.stdout.write(`[${new Date(entry.at).toISOString()}] ${entry.name}:${entry.slot} ${entry.stream} ${entry.line}\n`);
  });
  await new Promise((resolve) => {
    const stop = () => { close(); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function monitor(client, options) {
  let stopped = false;
  let rendering = false;
  let dirty = true;
  const close = await client.subscribe({ events: ['*'], app: options.app || null }, () => { dirty = true; });
  const render = async () => {
    if (rendering || stopped || !dirty) return;
    rendering = true;
    dirty = false;
    try {
      const groups = await client.request('status', { name: options.app || null });
      const values = Array.isArray(groups) ? groups : [groups];
      if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write(`${style.bold('RawNode PM Monitor')}  ${new Date().toISOString()}\n\n${renderStatus(values)}\n`);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
    } finally { rendering = false; }
  };
  const timer = setInterval(() => render(), 1_000);
  await render();
  await new Promise((resolve) => {
    const stop = () => { stopped = true; clearInterval(timer); close(); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

export async function runCli(argv = process.argv.slice(2)) {
  const { command, positionals, options } = parseArgs(argv);
  const global = { stateDir: options['state-dir'], cwd: options.cwd || process.cwd() };
  if (command === 'help' || options.help || options.h) {
    process.stdout.write(usage());
    return 0;
  }
  if (command === 'daemon') return runDaemon(options);
  if (command === 'startup') return generateStartup(positionals, options, global);
  if (command === 'integrate') return integrateRawNode(options, global);

  if (command === 'kill') {
    const running = await pingDaemon(global);
    if (!running) {
      print({ ok: true, running: false }, { json: options.json });
      return 0;
    }
    const result = await createClient(global).request('shutdown-daemon');
    print(result, { json: options.json });
    return 0;
  }

  const client = await ensureDaemon(global);
  let result;
  switch (command) {
    case 'start':
      result = await client.request('start', {
        manifest: positionals[0] || options.manifest || null,
        name: options.name || null,
        all: options.all === true,
        force: options.force === true,
        instances: numberOption(options.instances),
        cwd: global.cwd,
      }, { timeoutMs: numberOption(options.timeout, 120_000) });
      break;
    case 'stop': result = await client.request('stop', { name: positionals[0] || options.name }); break;
    case 'restart': result = await client.request('restart', { name: positionals[0] || options.name, force: options.force === true }, { timeoutMs: 120_000 }); break;
    case 'reload': result = await client.request('reload', { name: positionals[0] || options.name }, { timeoutMs: 120_000 }); break;
    case 'scale': result = await client.request('scale', { name: positionals[0] || options.name, instances: numberOption(positionals[1] || options.instances) }, { timeoutMs: 120_000 }); break;
    case 'delete': result = await client.request('delete', { name: positionals[0] || options.name }); break;
    case 'show': result = await client.request('show', { name: positionals[0] || options.name }); break;
    case 'status': {
      result = await client.request('status', { name: positionals[0] || options.name || null });
      if (!options.json) {
        const groups = Array.isArray(result) ? result : [result];
        print(renderStatus(groups));
        return 0;
      }
      break;
    }
    case 'logs': {
      const name = positionals[0] || options.name;
      if (options.follow || options.f) {
        await followLogs(client, name, options);
        return 0;
      }
      result = await client.request('logs', { name, lines: numberOption(options.lines, 100), stream: options.stream });
      if (!options.json) {
        for (const entry of result) process.stdout.write(`[${new Date(entry.at).toISOString()}] ${entry.name}:${entry.slot} ${entry.stream} ${entry.line}\n`);
        return 0;
      }
      break;
    }
    case 'monitor':
      await monitor(client, options);
      return 0;
    case 'metrics':
      if (options.prometheus) {
        const response = await client.request('prometheus');
        process.stdout.write(response.body);
        return 0;
      }
      result = await client.request('metrics', { history: options.history === true });
      break;
    case 'health': result = await client.request('health'); break;
    case 'doctor': result = await client.request('doctor'); break;
    case 'diagnostics': result = await client.request('diagnostics', { name: positionals[0] || options.name, slot: numberOption(options.slot), logLines: numberOption(options.lines) }, { timeoutMs: 120_000 }); break;
    case 'save': result = await client.request('save'); break;
    case 'resurrect': result = await client.request('resurrect', { force: options.force === true }, { timeoutMs: 120_000 }); break;
    case 'history': result = await client.request('history', { event: options.event, limit: numberOption(options.limit, 100) }); break;
    default:
      process.stderr.write(`Unknown command '${command}'.\n\n${usage()}`);
      return 2;
  }
  print(result, { json: options.json || typeof result !== 'string' });
  return 0;
}

export default runCli;
