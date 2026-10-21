'use strict';

import { Transform } from 'node:stream';

/**
 * Compatibility transport base. Existing Transform semantics are retained,
 * while flush/close/writeRecord make it usable by the enterprise dispatcher.
 */
class BaseTransport extends Transform {
  constructor(options = {}) {
    super({ objectMode: true, autoDestroy: true, highWaterMark: options.highWaterMark || 16 });
    this.name = options.name || this.constructor.name;
    this.rawnodeTransportMode = 'legacy';
    this.rawnodeCompatibilityTransport = true;
    this.payloadMode = 'legacy';
    this.silent = options.silent === true;
    this._rnClosed = false;
    this.stats = { written: 0, errors: 0, lastError: null };
    // Prevent an unhandled EventEmitter "error" event from terminating an app.
    this.on('error', () => {});
  }

  _normalize(entry) {
    if (entry && typeof entry === 'object') return entry;
    if (typeof entry === 'string') {
      try { return JSON.parse(entry); }
      catch { return { timestamp: '', level: '', message: entry, formatted: entry, data: null }; }
    }
    const text = String(entry ?? '');
    return { timestamp: '', level: '', message: text, formatted: text, data: null };
  }

  _safeEmit(event, ...args) {
    try { this.emit(event, ...args); }
    catch (error) {
      this.stats.errors++;
      this.stats.lastError = { message: error?.message || String(error), at: Date.now() };
      try { process.stderr.write(`[RawNodeLogger:TRANSPORT] ${event}: ${error?.message || error}\n`); } catch {}
    }
  }

  writeRecord(record) {
    if (this._rnClosed) return Promise.reject(Object.assign(new Error(`Transport [${this.name}] is closed.`), { code: 'LOGGER_TRANSPORT_CLOSED' }));
    return new Promise((resolve, reject) => {
      try {
        const accepted = this.write(record, (error) => error ? reject(error) : resolve(true));
        if (accepted === false) this.once('drain', () => resolve(true));
      } catch (error) { reject(error); }
    });
  }

  async flush() {
    if (this.writableNeedDrain) await new Promise((resolve) => this.once('drain', resolve));
  }

  async close() {
    if (this._rnClosed) return;
    await this.flush();
    this._rnClosed = true;
    if (!this.writableEnded && !this.destroyed) await new Promise((resolve, reject) => this.end((error) => error ? reject(error) : resolve()));
  }

  health() {
    return { name: this.name, status: this._rnClosed ? 'closed' : this.stats.lastError ? 'degraded' : 'healthy', stats: { ...this.stats } };
  }
}

export default BaseTransport;
