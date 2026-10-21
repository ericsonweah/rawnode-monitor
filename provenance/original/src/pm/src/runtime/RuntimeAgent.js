'use strict';

import { EventEmitter } from 'node:events';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { RUNTIME_MESSAGE, SUPERVISOR_MESSAGE } from '../constants.js';
import { serializeError } from '../errors.js';
import { runtimePacket, isRuntimePacket } from './RuntimeProtocol.js';
import { RawNodeRuntimeAdapter } from './RawNodeRuntimeAdapter.js';

function activeResources() {
  try {
    const list = process.getActiveResourcesInfo?.() || [];
    const counts = Object.create(null);
    for (const item of list) counts[item] = (counts[item] || 0) + 1;
    return counts;
  } catch { return {}; }
}

export class RuntimeAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    this.adapter = options.adapter || new RawNodeRuntimeAdapter(options);
    this.intervalMs = Math.max(250, Number(options.intervalMs || process.env.RAWNODE_PM_TELEMETRY_INTERVAL) || 2_000);
    this.managed = options.managed ?? process.env.RAWNODE_PM_MANAGED === '1';
    this.autoExit = options.autoExit !== false;
    this.captureSignals = options.captureSignals !== false;
    this.started = false;
    this.readyState = false;
    this.draining = false;
    this.stopping = false;
    this._timer = null;
    this._messageHandler = (message) => this._onMessage(message);
    this._sigtermHandler = () => this._onSignal('SIGTERM');
    this._sigintHandler = () => this._onSignal('SIGINT');
    this._exceptionMonitor = (error, origin) => {
      this.send(RUNTIME_MESSAGE.ERROR, { fatal: true, origin, error: serializeError(error, { stack: true }) });
    };
    this._cpu = process.cpuUsage();
    this._cpuAt = performance.now();
    this._elu = performance.eventLoopUtilization();
    this._delay = monitorEventLoopDelay({ resolution: Math.max(10, Number(options.eventLoopResolution) || 20) });
    this._delay.enable();
  }

  start(meta = {}) {
    if (this.started) return this;
    this.started = true;
    process.on('message', this._messageHandler);
    process.on('uncaughtExceptionMonitor', this._exceptionMonitor);
    if (this.managed && this.captureSignals) {
      process.on('SIGTERM', this._sigtermHandler);
      process.on('SIGINT', this._sigintHandler);
    }
    this._timer = setInterval(() => this._tick().catch((error) => {
      this.send(RUNTIME_MESSAGE.ERROR, { fatal: false, origin: 'telemetry', error: serializeError(error) });
    }), this.intervalMs);
    this._timer.unref?.();
    this.send(RUNTIME_MESSAGE.ONLINE, {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      managed: this.managed,
      capabilities: ['ready', 'drain', 'shutdown', 'health', 'metrics', 'diagnostics', 'reload-config'],
      ...meta,
    });
    return this;
  }

  ready(meta = {}) {
    if (!this.started) this.start();
    this.readyState = true;
    this.send(RUNTIME_MESSAGE.READY, { ...meta });
    return this;
  }

  trackServer(server, options = {}) {
    this.adapter.trackServer?.(server, options);
    return this;
  }

  registerResource(name, resource) {
    this.adapter.registerResource?.(name, resource);
    return this;
  }

  send(type, payload = {}, meta = {}) {
    const packet = runtimePacket(type, payload, meta);
    if (typeof process.send === 'function' && process.connected !== false) {
      try { process.send(packet); } catch {}
    }
    this.emit('packet', packet);
    return packet;
  }

  async _tick() {
    const metrics = await this.metrics();
    this.send(RUNTIME_MESSAGE.HEARTBEAT, {
      ready: this.readyState,
      draining: this.draining,
      rss: metrics.memory.rss,
      cpuPercent: metrics.cpu.percent,
      eventLoopP99Ms: metrics.eventLoop.delayP99Ms,
    });
    this.send(RUNTIME_MESSAGE.METRICS, metrics);
  }

  async metrics() {
    const now = performance.now();
    const cpu = process.cpuUsage(this._cpu);
    const elapsedUs = Math.max(1, (now - this._cpuAt) * 1_000);
    this._cpu = process.cpuUsage();
    this._cpuAt = now;
    const elu = performance.eventLoopUtilization(this._elu);
    this._elu = performance.eventLoopUtilization();
    const memory = process.memoryUsage();
    const resource = process.resourceUsage?.() || {};
    const adapter = await this.adapter.metrics();
    const out = {
      at: Date.now(),
      uptimeMs: Math.round(process.uptime() * 1_000),
      memory,
      cpu: {
        userMicros: cpu.user,
        systemMicros: cpu.system,
        percent: ((cpu.user + cpu.system) / elapsedUs) * 100,
      },
      eventLoop: {
        utilization: elu.utilization,
        activeMs: elu.active,
        idleMs: elu.idle,
        delayMinMs: Number.isFinite(this._delay.min) ? this._delay.min / 1e6 : 0,
        delayMeanMs: Number.isFinite(this._delay.mean) ? this._delay.mean / 1e6 : 0,
        delayMaxMs: Number.isFinite(this._delay.max) ? this._delay.max / 1e6 : 0,
        delayP95Ms: this._delay.percentile(95) / 1e6,
        delayP99Ms: this._delay.percentile(99) / 1e6,
      },
      resourceUsage: resource,
      activeResources: activeResources(),
      adapter,
    };
    this._delay.reset();
    return out;
  }

  async health() {
    return this.adapter.health({ deep: true });
  }

  async _onMessage(message) {
    if (!isRuntimePacket(message) || !String(message.type).startsWith('supervisor:')) return;
    const requestId = message.requestId || null;
    try {
      switch (message.type) {
        case SUPERVISOR_MESSAGE.DRAIN: {
          const result = await this.drain(message.payload || {});
          this.send(RUNTIME_MESSAGE.DRAINED, result, { replyTo: requestId });
          break;
        }
        case SUPERVISOR_MESSAGE.SHUTDOWN: {
          const result = await this.shutdown(message.payload || {});
          this.send(RUNTIME_MESSAGE.SHUTDOWN_COMPLETE, result, { replyTo: requestId });
          if (this.autoExit) setImmediate(() => process.exit(0));
          break;
        }
        case SUPERVISOR_MESSAGE.HEALTH:
          this.send(RUNTIME_MESSAGE.HEALTH, await this.health(), { replyTo: requestId });
          break;
        case SUPERVISOR_MESSAGE.METRICS:
          this.send(RUNTIME_MESSAGE.METRICS, await this.metrics(), { replyTo: requestId });
          break;
        case SUPERVISOR_MESSAGE.DIAGNOSTICS:
          this.send(RUNTIME_MESSAGE.DIAGNOSTIC_READY, await this.adapter.diagnostics(message.payload || {}), { replyTo: requestId });
          break;
        case SUPERVISOR_MESSAGE.RELOAD_CONFIG:
          this.send('runtime:config-reloaded', await this.adapter.reloadConfig(), { replyTo: requestId });
          break;
        default:
          break;
      }
    } catch (error) {
      this.send(RUNTIME_MESSAGE.ERROR, { fatal: false, origin: message.type, error: serializeError(error, { stack: true }) }, { replyTo: requestId });
    }
  }

  async drain(options = {}) {
    if (this.draining) return { ok: true, alreadyDraining: true };
    this.draining = true;
    this.readyState = false;
    this.send(RUNTIME_MESSAGE.DRAINING, { deadlineMs: options.deadlineMs || null });
    return this.adapter.drain(options);
  }

  async shutdown(options = {}) {
    if (this.stopping) return { ok: true, alreadyStopping: true };
    this.stopping = true;
    if (!this.draining) await this.drain(options);
    const result = await this.adapter.shutdown(options);
    await this.close();
    return result;
  }

  async _onSignal(signal) {
    if (this.stopping) return;
    try { await this.shutdown({ signal, deadlineMs: 15_000 }); }
    catch (error) { this.send(RUNTIME_MESSAGE.ERROR, { fatal: false, origin: signal, error: serializeError(error) }); }
    if (this.autoExit) process.exitCode = 0;
  }

  async close() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    try { this._delay.disable(); } catch {}
    process.off('message', this._messageHandler);
    process.off('uncaughtExceptionMonitor', this._exceptionMonitor);
    process.off('SIGTERM', this._sigtermHandler);
    process.off('SIGINT', this._sigintHandler);
    this.started = false;
  }
}

export function createRuntimeAgent(options = {}) {
  return new RuntimeAgent(options);
}

export default RuntimeAgent;
