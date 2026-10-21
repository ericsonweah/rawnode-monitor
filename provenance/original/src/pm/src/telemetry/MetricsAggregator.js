'use strict';

import { EventEmitter } from 'node:events';

export class MetricsAggregator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.historyLimit = Math.max(10, Number(options.historyLimit) || 300);
    this.processes = new Map();
    this.counters = Object.create(null);
    this.startedAt = Date.now();
  }

  inc(name, value = 1) {
    this.counters[name] = (this.counters[name] || 0) + Number(value || 0);
    return this.counters[name];
  }

  update(record, metrics) {
    if (!record || !metrics) return;
    let entry = this.processes.get(record.id);
    if (!entry) {
      entry = { name: record.name, slot: record.slot, pid: record.pid, latest: null, history: [] };
      this.processes.set(record.id, entry);
    }
    entry.pid = record.pid;
    entry.latest = metrics;
    entry.history.push(metrics);
    if (entry.history.length > this.historyLimit) entry.history.splice(0, entry.history.length - this.historyLimit);
    this.emit('metrics', record, metrics);
  }

  remove(record) {
    if (record) this.processes.delete(record.id);
  }

  snapshot({ includeHistory = false } = {}) {
    return {
      uptimeMs: Date.now() - this.startedAt,
      counters: { ...this.counters },
      processes: Array.from(this.processes.entries()).map(([id, entry]) => ({
        id,
        name: entry.name,
        slot: entry.slot,
        pid: entry.pid,
        latest: entry.latest,
        ...(includeHistory ? { history: entry.history.slice() } : {}),
      })),
    };
  }
}

export default MetricsAggregator;
