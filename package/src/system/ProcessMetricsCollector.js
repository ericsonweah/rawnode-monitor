'use strict';

import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PerformanceObserver, constants as perfConstants, monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { SignalKind } from '../constants.js';
import { deepFreeze, errorRecord } from '../support.js';

const GC_KINDS = Object.freeze({
  [perfConstants.NODE_PERFORMANCE_GC_MAJOR]: 'major',
  [perfConstants.NODE_PERFORMANCE_GC_MINOR]: 'minor',
  [perfConstants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental',
  [perfConstants.NODE_PERFORMANCE_GC_WEAKCB]: 'weakcb',
});

/**
 * Collects process, host, event-loop, active-resource, and GC telemetry using
 * Node.js primitives only. Collection is delta-based and does no synchronous I/O.
 */
export class ProcessMetricsCollector extends EventEmitter {
  constructor(options = {}) {
    super();
    this.registry = options.registry || null;
    this.signal = options.signal || null;
    this.intervalMs = Math.max(250, Number(options.intervalMs) || 10_000);
    this.eventLoopResolutionMs = Math.max(10, Number(options.eventLoopResolutionMs) || 20);
    this.captureGc = options.gc !== false;
    this.captureActiveResources = options.activeResources !== false;
    this.captureResourceUsage = options.resourceUsage !== false;
    this.captureHost = options.host !== false;
    this.unref = options.unref !== false;
    this.running = false;
    this.closed = false;
    this.timer = null;
    this.loop = null;
    this.gcObserver = null;
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = process.hrtime.bigint();
    this.lastElu = performance.eventLoopUtilization();
    this.gc = new Map();
    this.last = null;
    this.stats = { collections: 0, errors: 0, gcEvents: 0, signalsRejected: 0 };
    this.instruments = this.registry ? registerInstruments(this.registry) : null;
  }

  start() {
    if (this.running || this.closed) return this;
    this.running = true;
    this.loop = monitorEventLoopDelay({ resolution: this.eventLoopResolutionMs });
    this.loop.enable();
    if (this.captureGc) this._startGcObserver();
    this.timer = setInterval(() => { void this.collect().catch((error) => this._error(error)); }, this.intervalMs);
    if (this.unref) this.timer.unref?.();
    return this;
  }

  _startGcObserver() {
    try {
      this.gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const kind = GC_KINDS[entry.detail?.kind ?? entry.kind] || 'unknown';
          const current = this.gc.get(kind) || { count: 0, durationMs: 0, maxDurationMs: 0 };
          current.count++;
          current.durationMs += Number(entry.duration || 0);
          current.maxDurationMs = Math.max(current.maxDurationMs, Number(entry.duration || 0));
          this.gc.set(kind, current);
          this.stats.gcEvents++;
        }
      });
      this.gcObserver.observe({ entryTypes: ['gc'], buffered: false });
    } catch (error) { this._error(error); }
  }

  async collect(options = {}) {
    if (this.closed) return this.last;
    const timestamp = Date.now();
    const nowNs = process.hrtime.bigint();
    const elapsedMicros = Math.max(1, Number(nowNs - this.lastCpuAt) / 1_000);
    const cpuDelta = process.cpuUsage(this.lastCpu);
    this.lastCpu = process.cpuUsage();
    this.lastCpuAt = nowNs;
    const elu = performance.eventLoopUtilization(this.lastElu);
    this.lastElu = performance.eventLoopUtilization();
    const memory = process.memoryUsage();
    const resourceUsage = this.captureResourceUsage && typeof process.resourceUsage === 'function'
      ? process.resourceUsage()
      : null;
    const loop = this.loop ? {
      minMs: finite(this.loop.min / 1e6),
      meanMs: finite(this.loop.mean / 1e6),
      maxMs: finite(this.loop.max / 1e6),
      stddevMs: finite(this.loop.stddev / 1e6),
      p50Ms: finite(this.loop.percentile(50) / 1e6),
      p95Ms: finite(this.loop.percentile(95) / 1e6),
      p99Ms: finite(this.loop.percentile(99) / 1e6),
      utilization: finite(elu.utilization),
      activeMs: finite(elu.active),
      idleMs: finite(elu.idle),
    } : null;
    this.loop?.reset?.();

    const activeResources = this.captureActiveResources && typeof process.getActiveResourcesInfo === 'function'
      ? count(process.getActiveResourcesInfo())
      : null;
    const host = this.captureHost ? hostSnapshot() : null;
    const snapshot = deepFreeze({
      timestamp,
      pid: process.pid,
      ppid: process.ppid,
      uptimeSeconds: process.uptime(),
      title: process.title,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      memory: { ...memory },
      cpu: {
        userMicros: cpuDelta.user,
        systemMicros: cpuDelta.system,
        totalMicros: cpuDelta.user + cpuDelta.system,
        percent: finite(((cpuDelta.user + cpuDelta.system) / elapsedMicros) * 100),
      },
      eventLoop: loop,
      resourceUsage,
      activeResources,
      gc: Object.fromEntries(Array.from(this.gc, ([kind, value]) => [kind, { ...value }])),
      host,
    });
    this.last = snapshot;
    this.stats.collections++;
    this._record(snapshot);
    const admission = this.signal?.(SignalKind.METRICS, { source: 'system', snapshot }, { timestamp, priority: 1 });
    if (admission?.accepted === false) this.stats.signalsRejected++;
    if (options.resetGc !== false) this.gc.clear();
    return snapshot;
  }

  _record(snapshot) {
    const i = this.instruments;
    if (!i) return;
    const labels = { pid: String(process.pid) };
    i.processUptime.set(snapshot.uptimeSeconds, labels);
    i.cpuPercent.set(snapshot.cpu.percent, labels);
    i.cpuUser.add(snapshot.cpu.userMicros / 1e6, labels);
    i.cpuSystem.add(snapshot.cpu.systemMicros / 1e6, labels);
    for (const [name, value] of Object.entries(snapshot.memory)) i.memory.set(value, { ...labels, kind: name });
    if (snapshot.eventLoop) {
      i.loopUtilization.set(snapshot.eventLoop.utilization, labels);
      i.loopDelay.set(snapshot.eventLoop.p99Ms / 1_000, { ...labels, quantile: 'p99' });
      i.loopDelay.set(snapshot.eventLoop.p95Ms / 1_000, { ...labels, quantile: 'p95' });
      i.loopDelay.set(snapshot.eventLoop.meanMs / 1_000, { ...labels, quantile: 'mean' });
    }
    for (const [kind, value] of Object.entries(snapshot.gc)) {
      i.gcCount.add(value.count, { kind });
      i.gcDuration.add(value.durationMs / 1_000, { kind });
    }
    for (const [kind, value] of Object.entries(snapshot.activeResources || {})) i.activeResources.set(value, { kind });
    if (snapshot.resourceUsage) {
      i.fsReads.set(snapshot.resourceUsage.fsRead || 0, labels);
      i.fsWrites.set(snapshot.resourceUsage.fsWrite || 0, labels);
      i.contextSwitches.set((snapshot.resourceUsage.voluntaryContextSwitches || 0) + (snapshot.resourceUsage.involuntaryContextSwitches || 0), labels);
      i.pageFaults.set((snapshot.resourceUsage.minorPageFault || 0) + (snapshot.resourceUsage.majorPageFault || 0), labels);
    }
    if (snapshot.host) {
      i.hostLoad.set(snapshot.host.loadAverage[0], { window: '1m' });
      i.hostLoad.set(snapshot.host.loadAverage[1], { window: '5m' });
      i.hostLoad.set(snapshot.host.loadAverage[2], { window: '15m' });
      i.hostMemory.set(snapshot.host.totalMemoryBytes, { kind: 'total' });
      i.hostMemory.set(snapshot.host.freeMemoryBytes, { kind: 'free' });
    }
  }

  _error(error) { this.stats.errors++; if (this.listenerCount('error') > 0) this.emit('error', error); else this.emit('collectorError', errorRecord(error)); }

  snapshot() { return deepFreeze({ running: this.running, closed: this.closed, intervalMs: this.intervalMs, current: this.last, stats: { ...this.stats } }); }

  async close() {
    if (this.closed) return this.snapshot();
    clearInterval(this.timer); this.timer = null;
    this.gcObserver?.disconnect?.(); this.gcObserver = null;
    this.loop?.disable?.(); this.loop = null;
    this.running = false; this.closed = true;
    return this.snapshot();
  }
}

function registerInstruments(registry) {
  return {
    processUptime: registry.gauge('monitor_process_uptime_seconds', { unit: 'seconds', description: 'Process uptime.' }),
    cpuPercent: registry.gauge('monitor_process_cpu_percent', { unit: 'percent', description: 'Process CPU use over the collection interval.' }),
    cpuUser: registry.counter('monitor_process_cpu_user_seconds_total', { unit: 'seconds' }),
    cpuSystem: registry.counter('monitor_process_cpu_system_seconds_total', { unit: 'seconds' }),
    memory: registry.gauge('monitor_process_memory_bytes', { unit: 'bytes' }),
    loopUtilization: registry.gauge('monitor_event_loop_utilization_ratio', { unit: 'ratio' }),
    loopDelay: registry.gauge('monitor_event_loop_delay_seconds', { unit: 'seconds' }),
    gcCount: registry.counter('monitor_gc_collections_total'),
    gcDuration: registry.counter('monitor_gc_duration_seconds_total', { unit: 'seconds' }),
    activeResources: registry.gauge('monitor_active_resources', { unit: 'resources' }),
    fsReads: registry.gauge('monitor_resource_fs_reads_total'),
    fsWrites: registry.gauge('monitor_resource_fs_writes_total'),
    contextSwitches: registry.gauge('monitor_resource_context_switches_total'),
    pageFaults: registry.gauge('monitor_resource_page_faults_total'),
    hostLoad: registry.gauge('monitor_host_load_average'),
    hostMemory: registry.gauge('monitor_host_memory_bytes', { unit: 'bytes' }),
  };
}

function count(values = []) { const output = Object.create(null); for (const value of values) output[value] = (output[value] || 0) + 1; return output; }
function finite(value) { return Number.isFinite(value) ? value : 0; }
function hostSnapshot() {
  return {
    hostname: os.hostname(),
    uptimeSeconds: os.uptime(),
    loadAverage: os.loadavg(),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    cpuCount: os.cpus()?.length || 0,
    machine: typeof os.machine === 'function' ? os.machine() : process.arch,
    release: os.release(),
  };
}

export default ProcessMetricsCollector;
