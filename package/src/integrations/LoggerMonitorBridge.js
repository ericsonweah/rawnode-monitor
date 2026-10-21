'use strict';

import MonitorLogTransport from './MonitorLogTransport.js';

export class LoggerMonitorBridge {
  constructor(logger, monitor, options = {}) { this.logger = logger; this.monitor = monitor; this.options = options; this.transport = options.transport || new MonitorLogTransport(monitor, options); this.detach = null; this.started = false; }
  start() {
    if (this.started || !this.logger) return this;
    if (typeof this.logger.addTransport === 'function') { this.logger.addTransport(this.transport); this.detach = () => this.logger.removeTransport?.(this.transport); }
    else if (typeof this.logger.use === 'function') { const result = this.logger.use(this.transport); this.detach = typeof result === 'function' ? result : null; }
    else if (typeof this.logger.on === 'function') { const handler = (record) => this.transport.write(record); this.logger.on('record', handler); this.detach = () => this.logger.off?.('record', handler); }
    this.started = true; return this;
  }
  async close() { try { await this.detach?.(); } catch {} await this.transport.close(); this.started = false; }
  snapshot() { return Object.freeze({ started: this.started, attached: !!this.detach, transport: this.transport.snapshot() }); }
}
export default LoggerMonitorBridge;
