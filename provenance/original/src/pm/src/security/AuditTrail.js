'use strict';

import { LogWriter } from '../logs/LogWriter.js';
import { defaultRedactor } from './SecretRedactor.js';
import { safeJsonLine } from '../support/json.js';

export class AuditTrail {
  constructor(options = {}) {
    this.file = options.file;
    this.redactor = options.redactor || defaultRedactor;
    this.enabled = options.enabled !== false;
    this.maxBytes = Math.max(64 * 1024, Number(options.maxBytes) || 20 * 1024 * 1024);
    this.maxFiles = Math.max(1, Number(options.maxFiles) || 10);
    this._writer = null;
  }

  async open() {
    if (!this.enabled || this._writer) return this;
    if (!this.file) throw new Error('AuditTrail requires file.');
    this._writer = new LogWriter({
      file: this.file,
      maxBytes: this.maxBytes,
      maxFiles: this.maxFiles,
      mode: 0o600,
    });
    await this._writer.open();
    return this;
  }

  async record(action, details = {}) {
    if (!this.enabled) return;
    await this.open();
    const entry = {
      timestamp: new Date().toISOString(),
      pid: process.pid,
      action: String(action || 'unknown'),
      ...this.redactor.redact(details),
    };
    await this._writer.write(safeJsonLine(entry));
  }

  async close() {
    if (!this._writer) return;
    const writer = this._writer;
    this._writer = null;
    await writer.close();
  }
}

export default AuditTrail;
