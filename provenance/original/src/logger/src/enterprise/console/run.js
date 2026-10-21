'use strict';

import { open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import createLogger from '../public/createLogger.js';
import MemoryTransport from '../transports/MemoryTransport.js';
import FileTransport from '../transports/FileTransport.js';
import AuditFileTransport from '../transports/AuditFileTransport.js';
import LevelRegistry from '../core/LevelRegistry.js';
import ChannelManager from '../channels/ChannelManager.js';
import LoggerConfiguration from '../config/LoggerConfiguration.js';
import defaultConfig from '../../../config/logger.js';
import runDoctor from './LoggerDoctor.js';

function parse(args) {
  const positionals = [];
  const options = Object.create(null);
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (!value.startsWith('--')) { positionals.push(value); continue; }
    const equals = value.indexOf('=');
    if (equals > 2) { options[value.slice(2, equals)] = value.slice(equals + 1); continue; }
    const key = value.slice(2);
    const next = args[index + 1];
    if (next != null && !next.startsWith('--')) { options[key] = next; index++; }
    else options[key] = true;
  }
  return { command: positionals.shift() || 'help', positionals, options };
}

function truthy(value) {
  return value === true || ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function mask(value, key = '') {
  if (/(?:secret|token|password|passwd|private[_-]?key|api[_-]?key|authorization|cookie|pepper)/i.test(key) && value != null) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => mask(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([child, item]) => [child, mask(item, child)]));
  return value;
}

function output(value, json = false) {
  if (json || typeof value === 'object') process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(`${String(value)}\n`);
}

async function benchmark(options) {
  const iterations = Math.max(1, Number(options.iterations || 25_000));
  const transport = new MemoryTransport({ maxItems: Math.min(iterations, 50_000) });
  const logger = createLogger({
    profile: 'production',
    level: 'debug',
    transports: [transport],
    security: { enabled: truthy(options.redaction) },
    pipelineQueue: {
      maxItems: iterations + 64,
      maxBytes: Math.max(64 * 1024 * 1024, iterations * 2048),
      overflow: 'throw',
    },
  });
  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const cpuStart = process.cpuUsage();
  const startedAt = performance.now();
  for (let index = 0; index < iterations; index++) logger.debug('benchmark', { index, active: true });
  const enqueueMs = performance.now() - startedAt;
  await logger.flush({ throwOnError: true });
  const totalMs = performance.now() - startedAt;
  const cpu = process.cpuUsage(cpuStart);
  delay.disable();
  const result = {
    scenario: 'structured-memory-transport',
    iterations,
    enqueueMs,
    totalMs,
    enqueuePerSecond: iterations / Math.max(enqueueMs, 0.001) * 1000,
    deliveredPerSecond: iterations / Math.max(totalMs, 0.001) * 1000,
    cpuMs: (cpu.user + cpu.system) / 1000,
    eventLoopDelayMs: {
      mean: Number.isFinite(delay.mean) ? delay.mean / 1e6 : 0,
      max: Number.isFinite(delay.max) ? delay.max / 1e6 : 0,
      p99: Number.isFinite(delay.percentile(99)) ? delay.percentile(99) / 1e6 : 0,
    },
    stored: transport.all().length,
    metrics: logger.metricsSnapshot(),
  };
  await logger.close();
  return result;
}

async function tail(file, count = 50, maxBytes = 4 * 1024 * 1024) {
  const target = path.resolve(file);
  const handle = await open(target, 'r');
  try {
    const stats = await handle.stat();
    const length = Math.min(stats.size, Math.max(1024, Number(maxBytes) || maxBytes));
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, stats.size - length);
    return buffer.toString('utf8').trimEnd().split('\n').slice(-Math.max(1, Number(count) || 50)).join('\n');
  } finally { await handle.close(); }
}

function normalizeFileDefinition(definition = {}) {
  return {
    ...definition,
    logDirectory: definition.logDirectory || definition.directory,
    fileName: definition.fileName || definition.filename,
    maxSize: definition.maxSize ?? definition.maxBytes,
    rotateInterval: definition.rotateInterval ?? definition.rotateIntervalMs,
    compressOnRotate: definition.compressOnRotate ?? definition.compress,
    retention: definition.retention ? {
      ...definition.retention,
      maxTotalBytes: definition.retention.maxTotalBytes ?? definition.retention.maxBytes,
    } : undefined,
  };
}

async function managerSnapshot(configuration = defaultConfig) {
  const compiled = new LoggerConfiguration(configuration, { defaults: false });
  const snapshot = compiled.snapshot();
  const manager = new ChannelManager({
    default: snapshot.channel || snapshot.default,
    base: {
      profile: snapshot.profile,
      level: snapshot.level,
      service: snapshot.service,
      environment: snapshot.environment,
      security: snapshot.security,
      queue: snapshot.queue,
    },
    channels: snapshot.channels,
  });
  try {
    const logger = manager.channel();
    await logger.ready?.();
    return { configuration: mask(snapshot), manager: manager.snapshot(), health: manager.health() };
  } finally {
    await manager.close();
  }
}

function activeFileDefinition(configuration, requested) {
  const channels = configuration.channels || {};
  if (requested && channels[requested]) return { name: requested, definition: channels[requested] };
  for (const [name, definition] of Object.entries(channels)) {
    if (['file', 'daily', 'audit'].includes(String(definition?.driver))) return { name, definition };
  }
  return null;
}

function help() {
  return `RawNode Logger CLI

Commands:
  doctor [--json]
  health [--json]
  channels [--json]
  transports [--json]
  levels [--json]
  config [--json] [--reveal]
  bench [--iterations 25000] [--redaction] [--json]
  verify-audit <file> [--secret value] [--json]
  rotate [channel] [--json]
  tail <file> [--lines 50] [--max-bytes 4194304]
  version [--json]
`;
}

export async function runCli(args = process.argv.slice(2)) {
  const { command: rawCommand, positionals, options } = parse(args);
  const command = rawCommand.replace(/^logger:/, '');
  const json = truthy(options.json);
  try {
    if (['help', '--help', '-h'].includes(command)) output(help());
    else if (command === 'doctor') {
      const result = await runDoctor({ configuration: defaultConfig });
      output(result, true);
      return result.ok ? 0 : 2;
    } else if (command === 'health') {
      output(await managerSnapshot(defaultConfig), true);
    } else if (command === 'channels') {
      const compiled = new LoggerConfiguration(defaultConfig, { defaults: false }).snapshot();
      output({ default: compiled.channel || compiled.default, channels: mask(compiled.channels || {}) }, true);
    } else if (command === 'transports') {
      const compiled = new LoggerConfiguration(defaultConfig, { defaults: false }).snapshot();
      output(mask(Object.fromEntries(Object.entries(compiled.channels || {}).filter(([, definition]) => definition?.driver !== 'stack'))), true);
    } else if (command === 'levels') {
      output(new LevelRegistry().definitions(), true);
    } else if (command === 'config') {
      const compiled = new LoggerConfiguration(defaultConfig, { defaults: false });
      output(truthy(options.reveal) ? compiled.snapshot() : mask(compiled.snapshot()), true);
    } else if (command === 'bench') {
      output(await benchmark(options), true);
    } else if (command === 'verify-audit') {
      if (!positionals[0]) throw new Error('verify-audit requires a file path.');
      const result = await AuditFileTransport.verifyFile(path.resolve(positionals[0]), {
        secret: options.secret || process.env.LOG_AUDIT_SECRET || process.env.APP_KEY,
      });
      output(result, true);
      return result.valid ? 0 : 3;
    } else if (command === 'rotate') {
      const entry = activeFileDefinition(defaultConfig, positionals[0]);
      if (!entry) throw new Error('No file, daily, or audit channel is configured.');
      const Definition = entry.definition.driver === 'audit' ? AuditFileTransport : FileTransport;
      const transport = new Definition(normalizeFileDefinition(entry.definition));
      try { output({ channel: entry.name, ...(await transport.rotate({ reason: 'cli', force: true })) }, true); }
      finally { await transport.close(); }
    } else if (command === 'tail') {
      if (!positionals[0]) throw new Error('tail requires a file path.');
      output(await tail(positionals[0], options.lines || 50, options['max-bytes']));
    } else if (command === 'version') {
      const packageJson = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
      output(json ? { name: packageJson.name, version: packageJson.version } : packageJson.version, json);
    } else {
      output(help());
      return 1;
    }
    return 0;
  } catch (error) {
    if (json) output({ ok: false, error: error?.message || String(error), code: error?.code }, true);
    else process.stderr.write(`[rawnode-logger] ${error?.stack || error}\n`);
    return 1;
  }
}

export { benchmark as runLoggerBenchmark, tail as tailLogFile };
export default runCli;
