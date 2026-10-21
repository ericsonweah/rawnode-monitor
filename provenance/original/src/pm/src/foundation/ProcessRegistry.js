'use strict';

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ProcessDefinition } from '../config/ProcessDefinition.js';
import { ProcessStateMachine } from '../lifecycle/ProcessStateMachine.js';
import { RestartPolicy } from '../lifecycle/RestartPolicy.js';

function processSnapshot(record) {
  const now = Date.now();
  return {
    id: record.id,
    name: record.name,
    slot: record.slot,
    generation: record.generation,
    pid: record.pid || null,
    state: record.state.state,
    stateChangedAt: record.state.changedAt,
    startedAt: record.startedAt || null,
    readyAt: record.readyAt || null,
    stoppedAt: record.stoppedAt || null,
    uptimeMs: record.startedAt && !record.stoppedAt ? now - record.startedAt : 0,
    expectedExit: record.expectedExit === true,
    exitCode: record.exitCode ?? null,
    signal: record.signal ?? null,
    lastHeartbeatAt: record.lastHeartbeatAt || null,
    lastHealth: record.lastHealth || null,
    metrics: record.metrics || null,
    error: record.error || null,
    replacementFor: record.replacementFor || null,
  };
}

export class ProcessRegistry extends EventEmitter {
  constructor(options = {}) {
    super();
    this.historyPerGroup = Math.max(10, Number(options.historyPerGroup) || 100);
    this.groups = new Map();
    this.processes = new Map();
  }

  define(input) {
    const definition = ProcessDefinition.from(input);
    let group = this.groups.get(definition.name);
    if (!group) {
      group = {
        name: definition.name,
        definition,
        desiredInstances: definition.instances,
        desiredRunning: false,
        generation: 0,
        activeBySlot: new Map(),
        processIds: new Set(),
        restartPolicy: new RestartPolicy(definition.restart),
        quarantined: false,
        watchStatus: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.groups.set(definition.name, group);
      this.emit('defined', group);
    } else {
      group.definition = definition;
      group.desiredInstances = definition.instances;
      group.updatedAt = Date.now();
      group.restartPolicy = new RestartPolicy(definition.restart);
      this.emit('updated', group);
    }
    return group;
  }

  createRecord(name, slot, options = {}) {
    const group = this.requireGroup(name);
    const generation = options.generation ?? ++group.generation;
    const id = options.id || `${name}:${slot}:${generation}:${randomUUID().slice(0, 8)}`;
    const record = {
      id,
      name,
      slot,
      generation,
      definition: group.definition,
      state: new ProcessStateMachine('defined'),
      handle: null,
      child: null,
      worker: null,
      pid: null,
      startedAt: null,
      readyAt: null,
      stoppedAt: null,
      expectedExit: false,
      exitCode: null,
      signal: null,
      lastHeartbeatAt: null,
      lastHealth: null,
      healthFailures: 0,
      metrics: null,
      error: null,
      replacementFor: options.replacementFor || null,
      waiters: new Map(),
      timers: new Set(),
    };
    record.state.on('transition', (entry) => this.emit('transition', record, entry));
    this.processes.set(id, record);
    group.processIds.add(id);
    this.emit('processCreated', record);
    return record;
  }

  activate(record) {
    const group = this.requireGroup(record.name);
    const previousId = group.activeBySlot.get(record.slot) || null;
    group.activeBySlot.set(record.slot, record.id);
    group.updatedAt = Date.now();
    this.emit('activated', record, previousId ? this.processes.get(previousId) : null);
    return previousId ? this.processes.get(previousId) : null;
  }

  active(name, slot = null) {
    const group = this.groups.get(name);
    if (!group) return slot == null ? [] : null;
    if (slot != null) {
      const id = group.activeBySlot.get(slot);
      return id ? this.processes.get(id) || null : null;
    }
    return Array.from(group.activeBySlot.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, id]) => this.processes.get(id))
      .filter(Boolean);
  }

  groupProcesses(name, { includeStopped = true } = {}) {
    const group = this.groups.get(name);
    if (!group) return [];
    const records = Array.from(group.processIds, (id) => this.processes.get(id)).filter(Boolean);
    return includeStopped ? records : records.filter((record) => !['stopped', 'crashed', 'quarantined', 'boot_failed'].includes(record.state.state));
  }

  deactivate(record) {
    const group = this.groups.get(record.name);
    if (!group) return;
    if (group.activeBySlot.get(record.slot) === record.id) group.activeBySlot.delete(record.slot);
    group.updatedAt = Date.now();
  }

  prune(name, limit = this.historyPerGroup) {
    const group = this.groups.get(name);
    if (!group) return 0;
    const activeIds = new Set(group.activeBySlot.values());
    const records = Array.from(group.processIds, (id) => this.processes.get(id)).filter(Boolean);
    const terminal = records
      .filter((record) => !activeIds.has(record.id) && ['stopped', 'crashed', 'quarantined', 'boot_failed'].includes(record.state.state))
      .sort((a, b) => b.generation - a.generation);
    let removed = 0;
    for (const record of terminal.slice(Math.max(0, Number(limit) || this.historyPerGroup))) {
      group.processIds.delete(record.id);
      this.processes.delete(record.id);
      removed++;
    }
    return removed;
  }

  deleteGroup(name) {
    const group = this.groups.get(name);
    if (!group) return false;
    for (const id of group.processIds) this.processes.delete(id);
    this.groups.delete(name);
    this.emit('deleted', name);
    return true;
  }

  get(name) { return this.groups.get(name) || null; }
  requireGroup(name) {
    const group = this.get(name);
    if (!group) {
      const error = new Error(`Unknown process '${name}'.`);
      error.code = 'RNPM_PROCESS_NOT_FOUND';
      throw error;
    }
    return group;
  }

  list() {
    return Array.from(this.groups.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((group) => this.snapshotGroup(group.name));
  }

  snapshotGroup(name) {
    const group = this.requireGroup(name);
    const processes = this.groupProcesses(name).sort((a, b) => a.slot - b.slot || b.generation - a.generation).map(processSnapshot);
    return {
      name: group.name,
      namespace: group.definition.namespace,
      mode: group.definition.mode,
      desiredInstances: group.desiredInstances,
      desiredRunning: group.desiredRunning === true,
      activeInstances: group.activeBySlot.size,
      quarantined: group.quarantined,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      watch: group.watchStatus,
      restart: group.restartPolicy.snapshot(),
      definition: group.definition.toJSON({ includeEnv: false }),
      processes,
    };
  }

  desiredState() {
    return {
      processes: Array.from(this.groups.values()).map((group) => ({
        definition: group.definition.toJSON({ includeEnv: true }),
        desiredInstances: group.desiredInstances,
        desiredRunning: group.desiredRunning === true,
        quarantined: group.quarantined,
      })),
    };
  }
}

export { processSnapshot };
export default ProcessRegistry;
