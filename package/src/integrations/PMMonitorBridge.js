'use strict';

/** Registers Monitor as a PM-observable resource without making either module depend on the other. */
export class PMMonitorBridge {
  constructor(pm, monitor, options = {}) { this.pm = pm; this.monitor = monitor; this.name = options.name || 'monitor'; this.started = false; this.unregister = null; }
  start() {
    if (this.started || !this.pm) return this;
    const resource = { health: (options) => this.monitor.health(options), metrics: () => this.monitor.metricsSnapshot(), diagnostics: (options) => this.monitor.diagnostics(options) };
    const owner = [this.pm, this.pm.runtime, this.pm.adapter].find((value) => typeof value?.registerResource === 'function');
    if (owner) {
      const result = owner.registerResource(this.name, resource);
      this.unregister = typeof result === 'function' ? result : () => owner.unregisterResource?.(this.name);
      this.started = true;
    }
    return this;
  }
  async close() { try { await this.unregister?.(); } catch {} this.unregister = null; this.started = false; }
  snapshot() { return Object.freeze({ name: this.name, started: this.started }); }
}
export default PMMonitorBridge;
