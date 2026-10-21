'use strict';

import { EventEmitter } from 'node:events';

function safeText(error) {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  try { return typeof error === 'string' ? error : JSON.stringify(error); }
  catch { return String(error); }
}

export class InternalDiagnostics extends EventEmitter {
  constructor(options = {}) {
    super();
    this.limit = Math.max(1, Number(options.limit) || 256);
    this.stderr = options.stderr !== false;
    this.prefix = options.prefix || '[rawnode-logger]';
    this.history = [];
    this._reporting = false;
  }

  report(code, error, metadata = {}) {
    const entry = Object.freeze({
      timestamp: new Date().toISOString(),
      code: String(code || 'LOGGER_INTERNAL_ERROR'),
      message: error instanceof Error ? error.message : safeText(error),
      stack: error instanceof Error ? error.stack : undefined,
      metadata: { ...(metadata || {}) },
    });
    if (this.history.length >= this.limit) this.history.shift();
    this.history.push(entry);
    try { super.emit('diagnostic', entry); } catch {}

    if (this.stderr && !this._reporting) {
      this._reporting = true;
      try {
        process.stderr.write(`${this.prefix} ${entry.code}: ${entry.message}\n`);
      } catch {}
      this._reporting = false;
    }
    return entry;
  }

  snapshot() {
    return this.history.map((entry) => ({ ...entry, metadata: { ...entry.metadata } }));
  }

  clear() {
    this.history.length = 0;
  }
}

export default InternalDiagnostics;
