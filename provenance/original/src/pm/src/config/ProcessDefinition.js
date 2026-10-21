'use strict';

import os from 'node:os';
import path from 'node:path';
import { ConfigurationError } from '../errors.js';
import { durationMs } from '../support/duration.js';

const VALID_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const VALID_MODES = new Set(['fork', 'cluster', 'external']);
const VALID_READINESS = new Set(['ipc', 'immediate', 'http', 'tcp']);
const VALID_WATCH_MODE = new Set(['reload', 'restart', 'none']);

function bool(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).toLowerCase());
}

function int(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const out = Math.trunc(number);
  return out >= min && out <= max ? out : fallback;
}

function stringArray(value) {
  if (value == null || value === false) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function resolveInstances(value, mode) {
  if (mode !== 'cluster') return 1;
  if (value === 'max' || value === 'auto' || value === 0) return Math.max(1, os.availableParallelism?.() || os.cpus().length || 1);
  return int(value, 1, 1, 1024);
}

function normalizeProbe(value, defaults = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const mode = String(input.mode || defaults.mode || 'ipc').toLowerCase();
  if (!VALID_READINESS.has(mode)) throw new ConfigurationError(`Invalid readiness mode '${mode}'.`);
  return Object.freeze({
    mode,
    timeoutMs: durationMs(input.timeoutMs ?? input.timeout ?? defaults.timeoutMs, 30_000),
    intervalMs: durationMs(input.intervalMs ?? defaults.intervalMs, 250),
    url: input.url || defaults.url || null,
    host: input.host || defaults.host || '127.0.0.1',
    port: input.port == null ? defaults.port ?? null : int(input.port, null, 1, 65535),
    path: input.path || defaults.path || '/health/ready',
    expectedStatus: int(input.expectedStatus ?? defaults.expectedStatus, 200, 100, 599),
  });
}

export class ProcessDefinition {
  constructor(input = {}, options = {}) {
    const cwd = path.resolve(input.cwd || options.cwd || process.cwd());
    const name = String(input.name || '').trim();
    if (!VALID_NAME.test(name)) throw new ConfigurationError(`Invalid process name '${name}'. Use letters, numbers, dots, dashes, or underscores.`);

    const mode = String(input.mode || input.execMode || 'fork').toLowerCase();
    if (!VALID_MODES.has(mode)) throw new ConfigurationError(`Invalid process mode '${mode}'.`);

    const scriptValue = input.script || input.entry || input.command;
    if (!scriptValue) throw new ConfigurationError(`Process '${name}' requires script or command.`);
    const script = mode === 'external' ? String(scriptValue) : path.resolve(cwd, String(scriptValue));

    const watchInput = input.watch && typeof input.watch === 'object' ? input.watch : { enabled: input.watch === true };
    const watchMode = String(watchInput.mode || (mode === 'cluster' ? 'reload' : 'restart')).toLowerCase();
    if (!VALID_WATCH_MODE.has(watchMode)) throw new ConfigurationError(`Invalid watch mode '${watchMode}'.`);

    this.name = name;
    this.namespace = String(input.namespace || 'default');
    this.cwd = cwd;
    this.script = script;
    this.args = Object.freeze(stringArray(input.args));
    this.nodeArgs = Object.freeze(stringArray(input.nodeArgs || input.execArgv));
    this.mode = mode;
    this.instances = resolveInstances(input.instances ?? input.workers, mode);
    this.interpreter = input.interpreter || (mode === 'external' ? null : process.execPath);
    this.envOverrides = Object.freeze({ ...(input.env || {}) });
    this.env = Object.freeze({ ...process.env, ...this.envOverrides });
    this.autostart = input.autostart !== false;
    this.autorestart = input.autorestart !== false;
    this.readiness = normalizeProbe(input.readiness, { mode: mode === 'external' ? 'immediate' : 'ipc' });
    this.health = Object.freeze({
      enabled: input.health?.enabled !== false,
      intervalMs: durationMs(input.health?.intervalMs, 5_000),
      timeoutMs: durationMs(input.health?.timeoutMs, 2_000),
      heartbeatTimeoutMs: durationMs(input.health?.heartbeatTimeoutMs, 12_000),
      unhealthyThreshold: int(input.health?.unhealthyThreshold, 3, 1, 100),
      restart: input.health?.restart !== false,
    });
    this.restart = Object.freeze({
      enabled: input.restart?.enabled ?? this.autorestart,
      onCleanExit: bool(input.restart?.onCleanExit, false),
      maxRestarts: int(input.restart?.maxRestarts, 10, 0, 100_000),
      windowMs: durationMs(input.restart?.windowMs, 60_000),
      stableMs: durationMs(input.restart?.stableMs, 30_000),
      minDelayMs: durationMs(input.restart?.minDelayMs, 100),
      maxDelayMs: durationMs(input.restart?.maxDelayMs, 30_000),
      factor: Math.max(1, Number(input.restart?.factor) || 2),
      jitter: Math.max(0, Math.min(1, Number(input.restart?.jitter) || 0.2)),
    });
    this.shutdown = Object.freeze({
      graceMs: durationMs(input.shutdown?.graceMs, 15_000),
      killMs: durationMs(input.shutdown?.killMs, 5_000),
      signal: String(input.shutdown?.signal || 'SIGTERM'),
      killSignal: String(input.shutdown?.killSignal || 'SIGKILL'),
    });
    this.watch = Object.freeze({
      enabled: watchInput.enabled === true,
      mode: watchMode,
      paths: Object.freeze(stringArray(watchInput.paths?.length ? watchInput.paths : ['app', 'src', 'config', 'resources'])),
      ignore: Object.freeze(stringArray(watchInput.ignore?.length ? watchInput.ignore : ['node_modules/**', '.git/**', 'storage/**', 'logs/**', '*.log'])),
      debounceMs: durationMs(watchInput.debounceMs, 250),
      pollingIntervalMs: durationMs(watchInput.pollingIntervalMs, 2_000),
      reconcileIntervalMs: durationMs(watchInput.reconcileIntervalMs, 10_000),
    });
    this.logs = Object.freeze({
      enabled: input.logs?.enabled !== false,
      maxBytes: int(input.logs?.maxBytes, 50 * 1024 * 1024, 64 * 1024),
      maxFiles: int(input.logs?.maxFiles, 5, 1, 100),
      bufferBytes: int(input.logs?.bufferBytes, 2 * 1024 * 1024, 64 * 1024),
      timestamp: input.logs?.timestamp !== false,
    });
    this.telemetry = Object.freeze({
      enabled: input.telemetry?.enabled !== false,
      intervalMs: durationMs(input.telemetry?.intervalMs, 2_000),
    });
    this.metadata = Object.freeze({ ...(input.metadata || {}) });
    this.uid = Number.isInteger(input.uid) ? input.uid : undefined;
    this.gid = Number.isInteger(input.gid) ? input.gid : undefined;
    Object.freeze(this);
  }

  toJSON({ includeEnv = true } = {}) {
    return {
      name: this.name,
      namespace: this.namespace,
      cwd: this.cwd,
      script: this.script,
      args: [...this.args],
      nodeArgs: [...this.nodeArgs],
      mode: this.mode,
      instances: this.instances,
      interpreter: this.interpreter,
      ...(includeEnv ? { env: { ...this.envOverrides } } : {}),
      autostart: this.autostart,
      autorestart: this.autorestart,
      readiness: { ...this.readiness },
      health: { ...this.health },
      restart: { ...this.restart },
      shutdown: { ...this.shutdown },
      watch: { ...this.watch, paths: [...this.watch.paths], ignore: [...this.watch.ignore] },
      logs: { ...this.logs },
      telemetry: { ...this.telemetry },
      metadata: { ...this.metadata },
      uid: this.uid,
      gid: this.gid,
    };
  }

  static from(input, options) {
    return input instanceof ProcessDefinition ? input : new ProcessDefinition(input, options);
  }
}

export default ProcessDefinition;
