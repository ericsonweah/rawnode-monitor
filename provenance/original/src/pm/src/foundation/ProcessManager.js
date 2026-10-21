'use strict';

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { ProcessRegistry } from './ProcessRegistry.js';
import { Supervisor } from './Supervisor.js';
import { ManifestLoader } from '../config/ManifestLoader.js';
import { ProcessDefinition } from '../config/ProcessDefinition.js';
import { ControlAuthenticator } from '../security/ControlAuthenticator.js';
import { AuditTrail } from '../security/AuditTrail.js';
import { defaultRedactor } from '../security/SecretRedactor.js';
import { AtomicJournal } from '../persistence/AtomicJournal.js';
import { JsonStateStore } from '../persistence/JsonStateStore.js';
import { DaemonLock } from '../persistence/DaemonLock.js';
import { LogMultiplexer } from '../logs/LogMultiplexer.js';
import { MetricsAggregator } from '../telemetry/MetricsAggregator.js';
import { formatPrometheus } from '../telemetry/PrometheusFormatter.js';
import { WatchManager } from '../watch/WatchManager.js';
import { RealtimeGateway } from '../realtime/RealtimeGateway.js';
import { DiagnosticManager } from '../diagnostics/DiagnosticManager.js';
import { ControlServer } from '../control/ControlServer.js';
import { ManagementHttpServer } from '../control/ManagementHttpServer.js';
import { resolveStatePaths } from '../support/paths.js';
import { ensureDir, atomicWriteFile, removeIfExists } from '../support/fs.js';
import { serializeError } from '../errors.js';

function recordView(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name,
    slot: record.slot,
    generation: record.generation,
    pid: record.pid,
    state: record.state?.state,
    startedAt: record.startedAt,
    readyAt: record.readyAt,
    lastHeartbeatAt: record.lastHeartbeatAt,
    error: record.error,
  };
}

export class ProcessManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.paths = resolveStatePaths(options.stateDir);
    this.cwd = path.resolve(options.cwd || process.cwd());
    this.autoSave = options.autoSave !== false;
    this.registry = options.registry || new ProcessRegistry();
    this.authenticator = options.authenticator || new ControlAuthenticator({ tokenPath: this.paths.token });
    this.journal = options.journal || new AtomicJournal({ file: this.paths.journal });
    this.audit = options.audit || new AuditTrail({ file: this.paths.audit, redactor: defaultRedactor });
    this.logs = options.logs || new LogMultiplexer({ root: this.paths.logs });
    this.metrics = options.metrics || new MetricsAggregator();
    this.realtime = options.realtime || new RealtimeGateway();
    this.watcher = options.watcher || new WatchManager();
    this.supervisor = options.supervisor || new Supervisor({
      registry: this.registry,
      logs: this.logs,
      metrics: this.metrics,
      journal: this.journal,
    });
    this.diagnostics = options.diagnostics || new DiagnosticManager({
      root: this.paths.incidents,
      registry: this.registry,
      supervisor: this.supervisor,
      logs: this.logs,
      metrics: this.metrics,
      realtime: this.realtime,
      redactor: defaultRedactor,
    });
    this.control = options.control || new ControlServer({
      socketPath: this.paths.socket,
      authenticator: this.authenticator,
      handler: (command, params, meta) => this.handleCommand(command, params, meta),
    });
    this.management = options.management || new ManagementHttpServer({
      manager: this,
      authenticator: this.authenticator,
      host: options.managementHost || process.env.RAWNODE_PM_HTTP_HOST || '127.0.0.1',
      port: options.managementPort ?? (process.env.RAWNODE_PM_HTTP_PORT ? Number(process.env.RAWNODE_PM_HTTP_PORT) : null),
      enabled: options.managementEnabled ?? (options.managementPort != null || process.env.RAWNODE_PM_HTTP_PORT != null),
      publicHealth: options.publicHealth ?? process.env.RAWNODE_PM_PUBLIC_HEALTH !== 'false',
      publicMetrics: options.publicMetrics ?? process.env.RAWNODE_PM_PUBLIC_METRICS === 'true',
    });
    this.stateStore = options.stateStore || new JsonStateStore({
      file: this.paths.state,
      encrypted: options.encryptState !== false,
      keyProvider: async () => this.authenticator.keyBytes(),
    });
    this.lock = options.lock || new DaemonLock(this.paths.daemonLock);
    this.startedAt = null;
    this.closed = false;
    this._wireEvents();
  }

  _wireEvents() {
    const publishRecord = (event) => (record, details = null) => {
      this.publish(event, { record: recordView(record), details });
    };
    for (const event of [
      'process:starting', 'process:online', 'process:ready', 'process:stopped',
      'process:crashed', 'process:backoff', 'process:quarantined', 'process:unhealthy',
      'process:reloaded', 'process:reload-failed', 'process:drain-timeout', 'process:error',
    ]) this.supervisor.on(event, publishRecord(event));
    this.supervisor.on('transition', (record, entry) => this.publish('process:transition', { record: recordView(record), entry }));
    this.supervisor.on('runtime:health', (record, health) => this.publish('runtime:health', { record: recordView(record), health }));
    this.supervisor.on('runtime:error', (record, error) => this.publish('runtime:error', { record: recordView(record), error }));
    this.supervisor.on('error', (error) => this.publish('daemon:error', { error: serializeError(error, { stack: true }) }));
    this.logs.on('line', (line) => this.publish('log:line', line));
    this.logs.on('error', (error, record) => this.publish('log:error', { record: recordView(record), error: serializeError(error) }));
    this.watcher.on('changes', (name, changes) => this.publish('watch:changes', { name, changes }));
    this.watcher.on('nativeError', (error, name, dir) => this.publish('watch:native-error', { name, dir, error: serializeError(error) }));
    this.watcher.on('error', (error, name) => this.publish('watch:error', { name, error: serializeError(error) }));
    this.control.on('error', (error) => this.publish('control:error', { error: serializeError(error, { stack: false }) }));
    this.control.on('serverError', (error) => this.publish('control:error', { error: serializeError(error, { stack: false }) }));
    this.realtime.on('event', (packet) => this.control.broadcast(packet.event, packet.payload));
  }

  publish(event, payload = {}) {
    const packet = this.realtime.publish(event, payload);
    this.emit(event, payload);
    return packet;
  }

  async start(options = {}) {
    if (this.startedAt) return this;
    if (this.closed) {
      const error = new Error('ProcessManager cannot be started after it has been closed.');
      error.code = 'RNPM_MANAGER_CLOSED';
      throw error;
    }

    try {
      await ensureDir(this.paths.root, 0o700);
      await ensureDir(this.paths.logs, 0o700);
      await ensureDir(this.paths.incidents, 0o700);
      await this.lock.acquire();
      await this.authenticator.initialize();
      await this.journal.open();
      await this.audit.open();
      await atomicWriteFile(this.paths.daemonPid, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600 });
      await this.control.start();
      await this.management.start();
    } catch (error) {
      await this._rollbackFailedStart(error);
      throw error;
    }

    try {
      await this.journal.append('daemon.started', { pid: process.pid, socket: this.paths.socket });
      this.startedAt = Date.now();
      this.publish('daemon:started', { pid: process.pid, socket: this.paths.socket, stateDir: this.paths.root });
    } catch (error) {
      this.startedAt = null;
      await this._rollbackFailedStart(error);
      throw error;
    }

    if (options.resurrect === true) {
      try {
        await this.resurrect({ ignoreMissing: true });
      } catch (error) {
        const details = { error: serializeError(error, { stack: false }) };
        await this.journal.append('state.resurrect-failed', details).catch(() => {});
        await this.audit.record('state.resurrect-failed', details).catch(() => {});
        this.publish('state:resurrect-failed', details);
        if (options.failOnResurrectError === true) throw error;
      }
    }

    return this;
  }

  async _rollbackFailedStart(cause) {
    this.closed = true;
    const errors = [];
    const attempt = async (name, fn) => {
      try { await fn(); }
      catch (error) { errors.push({ name, error }); }
    };

    await attempt('watcher.close', () => this.watcher.close());
    await attempt('supervisor.close', () => this.supervisor.close());
    await attempt('logs.close', () => this.logs.close());
    await attempt('management.close', () => this.management.close());
    await attempt('control.close', () => this.control.close());
    await attempt('journal.close', () => this.journal.close());
    await attempt('audit.close', () => this.audit.close());
    await attempt('daemon.pid.remove', () => removeIfExists(this.paths.daemonPid));
    await attempt('daemon.lock.release', () => this.lock.release());

    this.emit('start-failed', {
      cause: serializeError(cause, { stack: false }),
      cleanupErrors: errors.map(({ name, error }) => ({ name, error: serializeError(error, { stack: false }) })),
    });
    this.emit('closed');
  }

  async handleCommand(command, params = {}, meta = {}) {
    const normalized = String(command || '').trim().toLowerCase();
    await this.audit.record(`control.${normalized || 'unknown'}`, {
      requestId: meta.requestId || null,
      params,
    });

    switch (normalized) {
      case 'ping': return { ok: true, pid: process.pid, uptimeMs: this.uptimeMs(), protocol: 1 };
      case 'start': return this.startProcesses(params);
      case 'stop': return this.stopProcess(params.name, params);
      case 'restart': return this.restartProcess(params.name, params);
      case 'reload': return this.reloadProcess(params.name, params);
      case 'scale': return this.scaleProcess(params.name, params.instances, params);
      case 'delete': return this.deleteProcess(params.name, params);
      case 'status': return this.supervisor.status(params.name || null);
      case 'show': return this.supervisor.status(params.name);
      case 'logs': return this.logs.query(params.name, { lines: params.lines, stream: params.stream });
      case 'metrics': return { registry: this.registry.list(), aggregate: this.metrics.snapshot({ includeHistory: params.history === true }) };
      case 'prometheus': return { contentType: 'text/plain; version=0.0.4', body: formatPrometheus({ registry: this.registry, metrics: this.metrics }) };
      case 'health': return this.health();
      case 'doctor': return this.doctor();
      case 'save': return this.saveState();
      case 'resurrect': return this.resurrect(params);
      case 'diagnostics': return this.collectDiagnostics(params.name, params);
      case 'history': return this.realtime.recent({ event: params.event, limit: params.limit });
      case 'shutdown-daemon': {
        setImmediate(() => this.close().catch((error) => this.emit('error', error)));
        return { ok: true, shuttingDown: true, pid: process.pid };
      }
      default: {
        const error = new Error(`Unknown control command '${normalized}'.`);
        error.code = 'RNPM_UNKNOWN_COMMAND';
        error.status = 404;
        throw error;
      }
    }
  }

  async startProcesses(params = {}) {
    let definitions;
    if (params.definition) {
      definitions = [ProcessDefinition.from(params.definition, { cwd: this.cwd })];
    } else {
      const loader = new ManifestLoader({ cwd: params.cwd || this.cwd });
      const manifest = await loader.load(params.manifest || null, { fresh: true });
      definitions = params.name ? manifest.apps.filter((app) => app.name === params.name) : manifest.apps.filter((app) => app.autostart || params.all === true);
      if (params.name && definitions.length === 0) {
        const error = new Error(`Process '${params.name}' was not found in ${manifest.file}.`);
        error.code = 'RNPM_PROCESS_NOT_IN_MANIFEST';
        throw error;
      }
    }

    const results = [];
    for (const definition of definitions) {
      const result = await this.supervisor.start(definition, { force: params.force === true, instances: params.instances });
      await this._syncWatch(definition.name);
      results.push(result);
    }
    if (this.autoSave) await this.saveState();
    return results.length === 1 ? results[0] : results;
  }

  async stopProcess(name, options = {}) {
    if (!name) throw new Error('stop requires process name.');
    await this.watcher.unwatch(name);
    const result = await this.supervisor.stop(name, options);
    if (this.autoSave) await this.saveState();
    return result;
  }

  async restartProcess(name, options = {}) {
    if (!name) throw new Error('restart requires process name.');
    const result = await this.supervisor.restart(name, options);
    await this._syncWatch(name);
    if (this.autoSave) await this.saveState();
    return result;
  }

  async reloadProcess(name, options = {}) {
    if (!name) throw new Error('reload requires process name.');
    const result = await this.supervisor.reload(name, options);
    if (this.autoSave) await this.saveState();
    return result;
  }

  async scaleProcess(name, instances, options = {}) {
    if (!name) throw new Error('scale requires process name.');
    const result = await this.supervisor.scale(name, instances, options);
    if (this.autoSave) await this.saveState();
    return result;
  }

  async deleteProcess(name, options = {}) {
    if (!name) throw new Error('delete requires process name.');
    await this.watcher.unwatch(name);
    const result = await this.supervisor.stop(name, { ...options, deleteDefinition: true });
    if (this.autoSave) await this.saveState();
    return result;
  }

  async _syncWatch(name) {
    const group = this.registry.requireGroup(name);
    if (!group.desiredRunning || !group.definition.watch.enabled) {
      await this.watcher.unwatch(name);
      group.watchStatus = null;
      return;
    }
    await this.watcher.watch(group.definition, async (changes) => {
      this.publish('watch:action', { name, mode: group.definition.watch.mode, changes });
      if (!group.desiredRunning) return;
      if (group.definition.watch.mode === 'reload') await this.supervisor.reload(name, { reason: 'watch' });
      else if (group.definition.watch.mode === 'restart') await this.supervisor.restart(name, { reason: 'watch' });
      group.watchStatus = this.watcher.status(name);
      if (this.autoSave) await this.saveState();
    });
    group.watchStatus = this.watcher.status(name);
  }

  async saveState() {
    const state = {
      daemon: { cwd: this.cwd },
      desired: this.registry.desiredState(),
    };
    const saved = await this.stateStore.save(state);
    await this.journal.append('state.saved', { processCount: state.desired.processes.length });
    return { ok: true, file: this.paths.state, savedAt: saved.savedAt, processCount: state.desired.processes.length };
  }

  async resurrect(options = {}) {
    const state = await this.stateStore.load(null);
    if (!state) {
      if (options.ignoreMissing) return { ok: true, missing: true, processes: [] };
      const error = new Error('No saved RawNode PM state exists.');
      error.code = 'RNPM_STATE_MISSING';
      throw error;
    }
    const results = [];
    for (const item of state.desired?.processes || []) {
      const definition = ProcessDefinition.from(item.definition, { cwd: state.daemon?.cwd || this.cwd });
      const group = this.registry.define(definition);
      group.desiredInstances = Math.max(1, Number(item.desiredInstances) || definition.instances);
      group.quarantined = item.quarantined === true;
      if (item.desiredRunning !== false && !group.quarantined) {
        results.push(await this.supervisor.start(group.name, { force: options.force === true, instances: group.desiredInstances }));
        await this._syncWatch(group.name);
      }
    }
    await this.journal.append('state.resurrected', { processCount: results.length });
    return { ok: true, processes: results };
  }

  async collectDiagnostics(name, options = {}) {
    if (!name) throw new Error('diagnostics requires process name.');
    return this.diagnostics.collect(name, options);
  }

  uptimeMs() {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }

  health() {
    const groups = this.registry.list();
    const unhealthy = [];
    let activeProcesses = 0;
    for (const group of this.registry.groups.values()) {
      const active = this.registry.active(group.name);
      activeProcesses += active.length;
      if (group.quarantined) unhealthy.push({ name: group.name, state: 'quarantined' });
      for (const record of active) {
        if (['crashed', 'unhealthy', 'quarantined', 'boot_failed'].includes(record.state.state)) {
          unhealthy.push({ ...recordView(record) });
        }
      }
      if (group.desiredRunning && active.length < group.desiredInstances) {
        unhealthy.push({ name: group.name, state: 'capacity-mismatch', active: active.length, desired: group.desiredInstances });
      }
    }
    return {
      ok: !this.closed && unhealthy.length === 0,
      ready: !!this.startedAt && !this.closed,
      pid: process.pid,
      uptimeMs: this.uptimeMs(),
      socket: this.paths.socket,
      stateDir: this.paths.root,
      management: this.management.address(),
      groups: groups.length,
      activeProcesses,
      historyRecords: groups.reduce((sum, group) => sum + group.processes.length, 0),
      unhealthy,
    };
  }

  async doctor() {
    const issues = [];
    const nodeMajor = Number(process.versions.node.split('.')[0]);
    if (nodeMajor < 20) issues.push({ severity: 'error', code: 'NODE_VERSION', message: 'Node.js 20 or newer is required.' });
    for (const group of this.registry.list()) {
      if (group.quarantined) issues.push({ severity: 'error', code: 'PROCESS_QUARANTINED', process: group.name, message: 'Process is quarantined after repeated failures.' });
      if (group.desiredRunning && group.activeInstances < group.desiredInstances) issues.push({ severity: 'warning', code: 'CAPACITY_MISMATCH', process: group.name, message: `${group.activeInstances}/${group.desiredInstances} active instances.` });
      if (group.definition?.mode === 'fork' && group.desiredInstances > 1) issues.push({ severity: 'error', code: 'FORK_SCALE_INVALID', process: group.name, message: 'Fork mode cannot own multiple instances.' });
    }
    return {
      ok: !issues.some((issue) => issue.severity === 'error'),
      node: process.version,
      platform: process.platform,
      pid: process.pid,
      paths: { ...this.paths },
      health: this.health(),
      issues,
    };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;

    const errors = [];
    try { this.publish('daemon:stopping', { pid: process.pid }); }
    catch (error) { errors.push({ name: 'daemon.stopping.publish', error }); }

    const attempt = async (name, fn) => {
      try { await fn(); }
      catch (error) { errors.push({ name, error }); }
    };

    await attempt('watcher.close', () => this.watcher.close());
    await attempt('supervisor.close', () => this.supervisor.close());
    await attempt('logs.close', () => this.logs.close());
    await attempt('journal.stopped', () => this.journal.append('daemon.stopped', { pid: process.pid }));
    await attempt('audit.stopped', () => this.audit.record('daemon.stopped', { pid: process.pid }));
    await attempt('management.close', () => this.management.close());
    await attempt('control.close', () => this.control.close());
    await attempt('journal.close', () => this.journal.close());
    await attempt('audit.close', () => this.audit.close());
    await attempt('daemon.pid.remove', () => removeIfExists(this.paths.daemonPid));
    await attempt('daemon.lock.release', () => this.lock.release());

    this.emit('closed', errors.map(({ name, error }) => ({ name, error: serializeError(error, { stack: false }) })));

    if (errors.length) {
      throw new AggregateError(
        errors.map(({ error }) => error),
        `RawNode PM daemon shutdown completed with ${errors.length} cleanup error(s).`,
      );
    }
  }
}

export default ProcessManager;
