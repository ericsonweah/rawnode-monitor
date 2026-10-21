'use strict';

import { EventEmitter } from 'node:events';
import ProcessMetricsCollector from './ProcessMetricsCollector.js';

export class SystemMetricsCollector extends EventEmitter {
  constructor(options = {}) {
    super();
    this.process = options.processCollector || new ProcessMetricsCollector(options);
    this.process.on?.('error', (error) => this.emit('collectorError', error));
  }
  start() { this.process.start(); return this; }
  collect(options = {}) { return this.process.collect(options); }
  snapshot() { return this.process.snapshot(); }
  close() { return this.process.close(); }
}
export default SystemMetricsCollector;
