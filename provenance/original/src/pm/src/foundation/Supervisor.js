'use strict';

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ProcessRegistry } from './ProcessRegistry.js';
import { ForkDriver } from '../drivers/ForkDriver.js';
import { ClusterDriver } from '../drivers/ClusterDriver.js';
import { ExternalProcessDriver } from '../drivers/ExternalProcessDriver.js';
import { waitForProbe } from '../drivers/probes.js';
import { Deferred, AsyncLock, sleep, withTimeout, mapLimit } from '../support/async.js';
import { RUNTIME_MESSAGE, SUPERVISOR_MESSAGE } from '../constants.js';
import { runtimePacket, isRuntimePacket } from '../runtime/RuntimeProtocol.js';
import { serializeError, ProcessLifecycleError } from '../errors.js';

function liveState(state) {
  return !['stopped', 'crashed', 'quarantined', 'boot_failed'].includes(state);
}

export class Supervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.registry = options.registry || new ProcessRegistry();
    this.logs = options.logs || null;
    this.metrics = options.metrics || null;
    this.journal = options.journal || null;
    this.drivers = {
      fork: options.forkDriver || new ForkDriver(),
      cluster: options.clusterDriver || new ClusterDriver(),
      external: options.externalDriver || new ExternalProcessDriver(),
    };
    this.operationLocks = new Map();
    this.pendingRuntimeRequests = new Map();
    this.closed = false;
    this.healthTickMs = Math.max(500, Number(options.healthTickMs) || 2_000);
    this._healthTimer = setInterval(() => this._healthTick().catch((error) => this.emit('error', error)), this.healthTickMs);
    this._healthTimer.unref?.();
    this.on('error', (error) => options.logger?.error?.('[rawnode-pm] supervisor error', error));
    this._wireRegistry();
  }

  _wireRegistry() {
    this.registry.on('transition', (record, entry) => {
      this.emit('transition', record, entry);
      this.journal?.append?.('process.transition', { id: record.id, name: record.name, slot: record.slot, ...entry }).catch(() => {});
    });
  }

  _lock(name) {
    let lock = this.operationLocks.get(name);
    if (!lock) {
      lock = new AsyncLock();
      this.operationLocks.set(name, lock);
    }
    return lock;
  }

  async start(input, options = {}) {
    const group = typeof input === 'string' ? this.registry.requireGroup(input) : this.registry.define(input);
    return this._lock(group.name).run(() => this._startGroup(group, options));
  }

  async _startGroup(group, options = {}) {
    if (this.closed) throw new ProcessLifecycleError('Supervisor is closed.');
    if (group.quarantined && options.force !== true) {
      throw new ProcessLifecycleError(`Process '${group.name}' is quarantined. Start with force after correcting the failure.`, {
        code: 'RNPM_PROCESS_QUARANTINED',
        status: 409,
      });
    }
    if (options.force) {
      group.quarantined = false;
      group.restartPolicy.markStable();
    }
    group.desiredRunning = true;
    if (options.instances != null) group.desiredInstances = Math.max(1, Number(options.instances) || 1);

    const created = [];
    for (let slot = 0; slot < group.desiredInstances; slot++) {
      const current = this.registry.active(group.name, slot);
      if (current && liveState(current.state.state)) continue;
      created.push(await this._spawn(group, slot, { activate: true }));
    }
    await Promise.all(created.map((record) => this._waitReady(record)));
    return this.registry.snapshotGroup(group.name);
  }

  async _spawn(group, slot, options = {}) {
    const definition = group.definition;
    const record = this.registry.createRecord(group.name, slot, {
      replacementFor: options.replacementFor || null,
    });
    record.suppressRestart = options.suppressRestart === true;
    record.waiters.set('ready', new Deferred());
    record.waiters.set('drained', new Deferred());
    record.waiters.set('shutdown', new Deferred());
    record.waiters.set('exit', new Deferred());
    record.state.transition('starting', { reason: options.replacementFor ? 'replacement' : 'start' });
    this.emit('process:starting', record);
    await this.journal?.append?.('process.starting', { id: record.id, name: record.name, slot, generation: record.generation });

    let handle;
    try {
      handle = await this.drivers[definition.mode].spawn(definition, {
        slot,
        generation: record.generation,
        replacementFor: options.replacementFor || null,
      });
    } catch (error) {
      record.error = serializeError(error, { stack: true });
      record.state.transition('boot_failed', { reason: 'spawn-error', details: record.error });
      record.waiters.get('ready').reject(error);
      throw error;
    }

    record.handle = handle;
    record.child = handle.child;
    record.worker = handle.worker;
    record.pid = handle.pid;
    record.startedAt = Date.now();
    record.lastHeartbeatAt = record.startedAt;
    this._attachHandle(record);
    this.logs?.attach?.(record);
    if (record.state.state === 'starting') record.state.transition('online', { reason: 'spawned' });
    this.emit('process:online', record);

    if (definition.readiness.mode === 'immediate') {
      queueMicrotask(() => this._markReady(record, { source: 'immediate' }));
    } else if (definition.readiness.mode === 'http' || definition.readiness.mode === 'tcp') {
      waitForProbe(definition.readiness)
        .then(() => this._markReady(record, { source: definition.readiness.mode }))
        .catch((error) => record.waiters.get('ready')?.reject(error));
    }

    if (options.activate === true && definition.readiness.mode === 'immediate') {
      this.registry.activate(record);
    }
    return record;
  }

  _attachHandle(record) {
    const handle = record.handle;
    handle.on('message', (message) => this._onRuntimeMessage(record, message));
    handle.on('listening', (address) => this.emit('process:listening', record, address));
    handle.on('error', (error) => {
      record.error = serializeError(error, { stack: true });
      this.emit('process:error', record, error);
    });
    handle.once('exit', (code, signal) => {
      this._onExit(record, code, signal).catch((error) => this.emit('error', error));
    });
  }

  _markReady(record, meta = {}) {
    if (!record || ['stopped', 'crashed', 'quarantined', 'boot_failed'].includes(record.state.state)) return;
    record.readyAt = record.readyAt || Date.now();
    if (record.state.state !== 'ready' && record.state.state !== 'running') {
      record.state.transition('ready', { reason: meta.source || 'runtime' });
      record.state.transition('running', { reason: 'accepted-traffic' });
    }
    record.waiters.get('ready')?.resolve(record);
    this.emit('process:ready', record, meta);
  }

  async _waitReady(record) {
    try {
      await withTimeout(record.waiters.get('ready').promise, record.definition.readiness.timeoutMs, {
        message: `Process '${record.name}' slot ${record.slot} did not become ready within ${record.definition.readiness.timeoutMs}ms.`,
        code: 'RNPM_READINESS_TIMEOUT',
      });
      if (!record.replacementFor && this.registry.active(record.name, record.slot)?.id !== record.id) this.registry.activate(record);
      return record;
    } catch (error) {
      record.error = serializeError(error, { stack: true });
      if (liveState(record.state.state)) record.state.transition('boot_failed', { reason: 'readiness-failed', details: record.error, force: true });
      record.expectedExit = true;
      await this._terminateRecord(record, { skipDrain: true }).catch(() => {});
      throw error;
    }
  }

  _onRuntimeMessage(record, message) {
    if (!isRuntimePacket(message)) return;
    record.hasRuntimeAgent = true;
    record.lastHeartbeatAt = Date.now();

    if (message.replyTo) {
      const pending = this.pendingRuntimeRequests.get(message.replyTo);
      if (pending) {
        this.pendingRuntimeRequests.delete(message.replyTo);
        clearTimeout(pending.timer);
        if (message.type === RUNTIME_MESSAGE.ERROR) {
          const error = new Error(message.payload?.error?.message || 'Runtime request failed.');
          error.code = message.payload?.error?.code || 'RNPM_RUNTIME_REQUEST_FAILED';
          pending.deferred.reject(error);
        } else pending.deferred.resolve(message.payload);
      }
    }

    switch (message.type) {
      case RUNTIME_MESSAGE.ONLINE:
        if (record.state.state === 'starting') record.state.transition('online', { reason: 'runtime-online' });
        this.emit('runtime:online', record, message.payload);
        break;
      case RUNTIME_MESSAGE.READY:
        this._markReady(record, { source: 'ipc', payload: message.payload });
        break;
      case RUNTIME_MESSAGE.HEARTBEAT:
        this.emit('runtime:heartbeat', record, message.payload);
        break;
      case RUNTIME_MESSAGE.HEALTH:
        record.lastHealth = message.payload;
        record.healthFailures = message.payload?.ok === false ? record.healthFailures + 1 : 0;
        this.emit('runtime:health', record, message.payload);
        break;
      case RUNTIME_MESSAGE.METRICS:
        record.metrics = message.payload;
        this.metrics?.update?.(record, message.payload);
        this.emit('runtime:metrics', record, message.payload);
        break;
      case RUNTIME_MESSAGE.DRAINING:
        if (record.state.can('draining')) record.state.transition('draining', { reason: 'runtime-draining' });
        break;
      case RUNTIME_MESSAGE.DRAINED:
        record.waiters.get('drained')?.resolve(message.payload);
        this.emit('runtime:drained', record, message.payload);
        break;
      case RUNTIME_MESSAGE.SHUTDOWN_COMPLETE:
        record.waiters.get('shutdown')?.resolve(message.payload);
        break;
      case RUNTIME_MESSAGE.ERROR:
        record.error = message.payload?.error || message.payload;
        this.emit('runtime:error', record, message.payload);
        break;
      case RUNTIME_MESSAGE.DIAGNOSTIC_READY:
        this.emit('runtime:diagnostic', record, message.payload);
        break;
      default:
        this.emit('runtime:message', record, message);
    }
  }

  async _requestRuntime(record, type, payload = {}, timeoutMs = 5_000) {
    if (!record.handle?.connected || !record.hasRuntimeAgent) {
      const error = new Error(`Process '${record.name}' slot ${record.slot} has no connected RawNode runtime agent.`);
      error.code = 'RNPM_RUNTIME_UNAVAILABLE';
      throw error;
    }
    const requestId = randomUUID();
    const deferred = new Deferred();
    const timer = setTimeout(() => {
      this.pendingRuntimeRequests.delete(requestId);
      const error = new Error(`Runtime request '${type}' timed out after ${timeoutMs}ms.`);
      error.code = 'RNPM_RUNTIME_TIMEOUT';
      deferred.reject(error);
    }, timeoutMs);
    timer.unref?.();
    this.pendingRuntimeRequests.set(requestId, { deferred, timer, record });
    try {
      await record.handle.send(runtimePacket(type, payload, { requestId }));
    } catch (error) {
      clearTimeout(timer);
      this.pendingRuntimeRequests.delete(requestId);
      deferred.reject(error);
    }
    return deferred.promise;
  }

  async _onExit(record, code, signal) {
    record.exitCode = code;
    record.signal = signal;
    record.stoppedAt = Date.now();
    if (!record.waiters.get('ready')?.settled) {
      const readinessError = new Error(`Process '${record.name}' slot ${record.slot} exited before readiness (code=${code}, signal=${signal || 'none'}).`);
      readinessError.code = 'RNPM_EXIT_BEFORE_READY';
      record.waiters.get('ready')?.reject(readinessError);
    }
    for (const [requestId, pending] of this.pendingRuntimeRequests) {
      if (pending.record.id !== record.id) continue;
      clearTimeout(pending.timer);
      pending.deferred.reject(new Error(`Process exited before runtime request completed.`));
      this.pendingRuntimeRequests.delete(requestId);
    }
    if (this.logs?.detach) await this.logs.detach(record).catch(() => {});
    this.metrics?.remove?.(record);
    this.registry.deactivate(record);

    const expected = record.expectedExit === true;
    if (expected) {
      if (record.state.state !== 'stopped') record.state.transition('stopped', { reason: 'expected-exit', force: true, details: { code, signal } });
      this.emit('process:stopped', record);
      record.waiters.get('exit')?.resolve({ code, signal });
      this.registry.prune(record.name);
      return;
    }

    record.state.transition('crashed', { reason: 'unexpected-exit', force: true, details: { code, signal } });
    this.emit('process:crashed', record);
    record.waiters.get('exit')?.resolve({ code, signal });
    this.registry.prune(record.name);
    const group = this.registry.get(record.name);
    if (!group || !group.desiredRunning || record.suppressRestart || record.slot >= group.desiredInstances) return;

    const decision = group.restartPolicy.decide({ expected, exitCode: code, signal, startedAt: record.startedAt });
    if (decision.quarantine) {
      group.quarantined = true;
      record.state.transition('quarantined', { reason: decision.reason, details: decision });
      this.emit('process:quarantined', record, decision);
      return;
    }
    if (!decision.restart) return;

    record.state.transition('backoff', { reason: decision.reason, details: decision });
    this.emit('process:backoff', record, decision);
    const timer = setTimeout(() => {
      this._lock(group.name).run(async () => {
        if (this.closed || !group.desiredRunning || group.quarantined || record.slot >= group.desiredInstances) return;
        const active = this.registry.active(group.name, record.slot);
        if (active && liveState(active.state.state)) return;
        const replacement = await this._spawn(group, record.slot, { activate: true });
        await this._waitReady(replacement);
      }).catch((error) => this.emit('error', error));
    }, decision.delayMs);
    timer.unref?.();
    record.timers.add(timer);
  }

  async stop(name, options = {}) {
    const group = this.registry.requireGroup(name);
    return this._lock(name).run(() => this._stopGroup(group, options));
  }

  async _stopGroup(group, options = {}) {
    group.desiredRunning = false;
    const records = this.registry.groupProcesses(group.name, { includeStopped: false });
    await mapLimit(records, options.concurrency || 8, (record) => this._drainAndStop(record, options));
    if (options.deleteDefinition) this.registry.deleteGroup(group.name);
    return options.deleteDefinition ? { name: group.name, deleted: true } : this.registry.snapshotGroup(group.name);
  }

  async _drainAndStop(record, options = {}) {
    if (!record || record.waiters.get('exit')?.settled || record.stoppedAt) return;
    record.expectedExit = true;
    const graceMs = Number(options.graceMs ?? record.definition.shutdown.graceMs);
    const killMs = Number(options.killMs ?? record.definition.shutdown.killMs);

    if (record.hasRuntimeAgent && !options.skipDrain) {
      if (record.state.can('draining')) record.state.transition('draining', { reason: options.reason || 'stop' });
      try {
        await record.handle.send(runtimePacket(SUPERVISOR_MESSAGE.DRAIN, { deadlineMs: graceMs }, { requestId: randomUUID() }));
        await withTimeout(record.waiters.get('drained').promise, graceMs, { message: `Drain timed out for ${record.name}:${record.slot}` });
      } catch (error) {
        this.emit('process:drain-timeout', record, error);
      }
      try {
        await record.handle.send(runtimePacket(SUPERVISOR_MESSAGE.SHUTDOWN, { deadlineMs: killMs }, { requestId: randomUUID() }));
      } catch {}
    } else if (!options.skipDrain && record.state.can('draining')) {
      record.state.transition('draining', { reason: 'signal-drain' });
    }

    if (record.state.can('stopping')) record.state.transition('stopping', { reason: options.reason || 'stop' });

    if (record.hasRuntimeAgent) {
      try {
        await withTimeout(record.waiters.get('exit').promise, killMs, { message: `Graceful shutdown timed out for ${record.name}:${record.slot}` });
        return;
      } catch {}
    }

    try { record.handle.kill(record.definition.shutdown.signal); } catch {}
    try {
      await withTimeout(record.waiters.get('exit').promise, killMs, { message: `${record.definition.shutdown.signal} timed out for ${record.name}:${record.slot}` });
      return;
    } catch {}

    try { record.handle.kill(record.definition.shutdown.killSignal); } catch {}
    await withTimeout(record.waiters.get('exit').promise, Math.max(1_000, killMs), {
      message: `Process ${record.name}:${record.slot} did not exit after ${record.definition.shutdown.killSignal}.`,
    }).catch(() => {});
  }

  async _terminateRecord(record, options = {}) {
    record.expectedExit = true;
    return this._drainAndStop(record, { ...options, reason: options.reason || 'terminate' });
  }

  async restart(name, options = {}) {
    const group = this.registry.requireGroup(name);
    return this._lock(name).run(async () => {
      await this._stopGroup(group, { ...options, deleteDefinition: false });
      group.desiredRunning = true;
      return this._startGroup(group, { ...options, force: options.force ?? true });
    });
  }

  async reload(name, options = {}) {
    const group = this.registry.requireGroup(name);
    if (group.definition.mode !== 'cluster') return this.restart(name, options);
    return this._lock(name).run(async () => {
      if (!group.desiredRunning) return this._startGroup(group, options);
      const oldRecords = this.registry.active(name);
      for (const oldRecord of oldRecords) {
        const replacement = await this._spawn(group, oldRecord.slot, {
          activate: false,
          replacementFor: oldRecord.id,
          suppressRestart: true,
        });
        try {
          await this._waitReady(replacement);
          this.registry.activate(replacement);
          replacement.suppressRestart = false;
          oldRecord.expectedExit = true;
          await this._drainAndStop(oldRecord, { ...options, reason: 'rolling-reload' });
          this.emit('process:reloaded', replacement, oldRecord);
        } catch (error) {
          replacement.expectedExit = true;
          await this._terminateRecord(replacement, { skipDrain: true, reason: 'failed-replacement' }).catch(() => {});
          this.emit('process:reload-failed', oldRecord, error);
          throw error;
        }
      }
      return this.registry.snapshotGroup(name);
    });
  }

  async scale(name, instances, options = {}) {
    const group = this.registry.requireGroup(name);
    const target = Math.max(1, Math.trunc(Number(instances) || 1));
    if (group.definition.mode !== 'cluster' && target !== 1) {
      throw new ProcessLifecycleError(`Only cluster mode can scale beyond one instance.`, { code: 'RNPM_SCALE_MODE_INVALID', status: 409 });
    }
    return this._lock(name).run(async () => {
      const previous = group.desiredInstances;
      group.desiredInstances = target;
      if (!group.desiredRunning) return this.registry.snapshotGroup(name);
      if (target > previous) {
        const records = [];
        for (let slot = previous; slot < target; slot++) records.push(await this._spawn(group, slot, { activate: true }));
        await Promise.all(records.map((record) => this._waitReady(record)));
      } else if (target < previous) {
        const records = this.registry.active(name).filter((record) => record.slot >= target).sort((a, b) => b.slot - a.slot);
        await mapLimit(records, options.concurrency || 4, (record) => {
          record.expectedExit = true;
          return this._drainAndStop(record, { ...options, reason: 'scale-down' });
        });
      }
      this.emit('process:scaled', group, previous, target);
      return this.registry.snapshotGroup(name);
    });
  }

  async diagnostics(name, options = {}) {
    const group = this.registry.requireGroup(name);
    const records = options.slot == null ? this.registry.active(name) : [this.registry.active(name, Number(options.slot))].filter(Boolean);
    const out = [];
    for (const record of records) {
      try {
        out.push({ id: record.id, pid: record.pid, result: await this._requestRuntime(record, SUPERVISOR_MESSAGE.DIAGNOSTICS, {}, options.timeoutMs || 10_000) });
      } catch (error) {
        out.push({ id: record.id, pid: record.pid, error: serializeError(error) });
      }
    }
    return { name: group.name, diagnostics: out };
  }

  async _healthTick() {
    if (this.closed) return;
    const now = Date.now();
    for (const group of this.registry.groups.values()) {
      if (!group.desiredRunning || group.quarantined) continue;
      for (const record of this.registry.active(group.name)) {
        if (!record || !['online', 'ready', 'running', 'unhealthy'].includes(record.state.state)) continue;
        const health = record.definition.health;
        if (!health.enabled || !record.hasRuntimeAgent) continue;

        if (now - record.lastHeartbeatAt > health.heartbeatTimeoutMs) {
          record.healthFailures++;
          record.lastHealth = { ok: false, error: 'heartbeat-timeout', lastHeartbeatAt: record.lastHeartbeatAt };
        } else if (!record.healthProbePending && (!record.lastHealthProbeAt || now - record.lastHealthProbeAt >= health.intervalMs)) {
          record.lastHealthProbeAt = now;
          record.healthProbePending = true;
          this._requestRuntime(record, SUPERVISOR_MESSAGE.HEALTH, {}, health.timeoutMs)
            .then((result) => {
              record.lastHealth = result;
              record.healthFailures = result?.ok === false ? record.healthFailures + 1 : 0;
            })
            .catch((error) => {
              record.lastHealth = { ok: false, error: error?.message || String(error) };
              record.healthFailures++;
            })
            .finally(() => { record.healthProbePending = false; });
        }

        if (record.healthFailures >= health.unhealthyThreshold && !record.healthRestarting) {
          record.healthRestarting = true;
          if (record.state.can('unhealthy')) record.state.transition('unhealthy', { reason: 'health-threshold', details: record.lastHealth });
          this.emit('process:unhealthy', record, record.lastHealth);
          if (health.restart) {
            this._lock(group.name).run(async () => {
              const active = this.registry.active(group.name, record.slot);
              if (!active || active.id !== record.id || !group.desiredRunning) return;
              if (group.definition.mode === 'cluster') {
                const replacement = await this._spawn(group, record.slot, { activate: false, replacementFor: record.id, suppressRestart: true });
                await this._waitReady(replacement);
                this.registry.activate(replacement);
                replacement.suppressRestart = false;
                record.expectedExit = true;
                await this._drainAndStop(record, { reason: 'unhealthy-replacement' });
              } else {
                record.expectedExit = true;
                await this._drainAndStop(record, { reason: 'unhealthy-restart' });
                const replacement = await this._spawn(group, record.slot, { activate: true });
                await this._waitReady(replacement);
              }
            }).catch((error) => this.emit('error', error)).finally(() => { record.healthRestarting = false; });
          } else record.healthRestarting = false;
        }
      }
    }
  }

  status(name = null) {
    return name ? this.registry.snapshotGroup(name) : this.registry.list();
  }

  async close(options = {}) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this._healthTimer);
    for (const record of this.registry.processes.values()) {
      for (const timer of record.timers || []) clearTimeout(timer);
      record.timers?.clear?.();
    }
    const groups = Array.from(this.registry.groups.values());
    await mapLimit(groups, options.concurrency || 4, async (group) => {
      group.desiredRunning = false;
      const records = this.registry.groupProcesses(group.name, { includeStopped: false });
      await mapLimit(records, 8, (record) => this._drainAndStop(record, { reason: 'supervisor-close' }));
    });
    for (const pending of this.pendingRuntimeRequests.values()) {
      clearTimeout(pending.timer);
      pending.deferred.reject(new Error('Supervisor closed.'));
    }
    this.pendingRuntimeRequests.clear();
  }
}

export default Supervisor;
