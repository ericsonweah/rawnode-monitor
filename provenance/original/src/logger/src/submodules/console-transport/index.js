'use strict';

/** Legacy two-argument console transport. */
class ConsoleTransport {
  constructor(options = {}) {
    this.name = options.name || 'console-legacy';
    this.stdout = options.stdout || console;
    this.closed = false;
  }

  write(level, logEntry) {
    if (this.closed) return false;
    if (level === 'error' || level === 'critical' || level === 'alert' || level === 'emergency' || level === 'urgent') this.stdout.error(logEntry);
    else if (level === 'warn' || level === 'priority') this.stdout.warn(logEntry);
    else this.stdout.log(logEntry);
    return true;
  }

  async flush() {}
  async close() { this.closed = true; }
  health() { return { name: this.name, status: this.closed ? 'closed' : 'healthy' }; }
}

export default ConsoleTransport;
