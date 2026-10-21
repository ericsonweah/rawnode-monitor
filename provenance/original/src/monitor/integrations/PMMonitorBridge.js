'use strict';

/** Registers Monitor as a PM-observable resource without making either module depend on the other. */
export class PMMonitorBridge {
  constructor(pm, monitor, options = {}) { this.pm = pm; this.monitor = monitor; this.name = options.name || 'monitor'; this.started = false; this.unregister = null; }
  start() {
    if (this.started || !this.pm) return this;
    const resource = { health: () => this.monitor.health(), metrics: () => this.monitor.metricsSnapshot(), diagnostics: () => this.monitor.diagnostics() };
    if (typeof this.pm.registerResource === 'function') {
      const result = this.pm.registerResource(this.name, resource);
      this.unregister = typeof result === 'function' ? result : () => this.pm.unregisterResource?.(this.name);
      this.started = true;
    } else if (typeof this.pm.runtime?.registerResource === 'function') {
      this.pm.runtime.registerResource(this.name, resource); this.unregister = () => this.pm.runtime.unregisterResource?.(this.name); this.started = true;
    } else if (typeof this.pm.adapter?.registerResource === 'function') {
      this.pm.adapter.registerResource(this.name, resource); this.unregister = () => this.pm.adapter.unregisterResource?.(this.name); this.started = true;
    }
    return this;
  }
  async close() { try { await this.unregister?.(); } catch {} this.unregister = null; this.started = false; }
  snapshot() { return Object.freeze({ name: this.name, started: this.started }); }
}
export default PMMonitorBridge;
