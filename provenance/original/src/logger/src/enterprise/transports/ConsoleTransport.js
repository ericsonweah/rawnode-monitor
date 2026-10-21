'use strict';

import { once } from 'node:events';
import BaseTransport from './BaseTransport.js';
import TextFormatter from '../serialization/TextFormatter.js';
import JsonFormatter from '../serialization/JsonFormatter.js';

const ANSI = Object.freeze({
  emergency: '\x1b[1;31m',
  alert: '\x1b[1;31m',
  critical: '\x1b[1;31m',
  error: '\x1b[31m',
  urgent: '\x1b[31m',
  priority: '\x1b[33m',
  warn: '\x1b[33m',
  notice: '\x1b[37m',
  success: '\x1b[32m',
  important: '\x1b[1;32m',
  info: '\x1b[34m',
  debug: '\x1b[36m',
  metric: '\x1b[35m',
  metrics: '\x1b[35m',
});
const RESET = '\x1b[0m';

export class ConsoleTransport extends BaseTransport {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'console' });
    if (options.serializer) this.serializer = options.serializer;
    this.stdout = options.stdout || process.stdout;
    this.stderr = options.stderr || process.stderr;
    this.format = options.format || (options.json ? 'json' : 'text');
    this.colors = options.colors ?? (this.stdout.isTTY === true && !process.env.NO_COLOR);
    this.formatter = options.formatter || (this.format === 'json' ? new JsonFormatter(options.jsonOptions) : new TextFormatter(options.textOptions));
  }

  async writeRecord(record) {
    if (this.closed || this.silent) return;
    const definition = record.levelDefinition || null;
    const method = definition?.consoleMethod || (['emergency', 'alert', 'critical', 'error', 'urgent'].includes(record.level) ? 'error' : (record.level === 'warn' ? 'warn' : 'log'));
    const destination = method === 'error' || method === 'warn' ? this.stderr : this.stdout;
    let output = typeof this.formatter === 'function'
      ? await this.formatter(record, this.serializer)
      : await this.formatter.format(record, this.serializer);
    output = String(output);
    if (this.colors && this.format !== 'json') output = `${ANSI[record.level] || ''}${output}${ANSI[record.level] ? RESET : ''}`;
    if (!output.endsWith('\n')) output += '\n';
    const writable = destination.write(output);
    if (!writable) await once(destination, 'drain');
    this._written(Buffer.byteLength(output));
    this.emit('written', record);
  }
}

export default ConsoleTransport;
