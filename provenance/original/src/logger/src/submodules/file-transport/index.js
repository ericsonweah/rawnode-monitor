'use strict';

import path from 'node:path';
import AsyncFileTransport from '../../transports/AsyncFileTransport.js';

/**
 * Legacy two-argument file transport backed by the non-blocking file runtime.
 * write(level, formatted) remains unchanged.
 */
class FileTransport {
  constructor(options = {}) {
    this.name = options.name || 'file-legacy';
    this.logDirectory = path.resolve(options.logDirectory || options.directory || path.join(process.cwd(), 'logs'));
    this.fileName = options.fileName || options.filename || 'application.log';
    this.maxSize = options.maxSize || options.maxBytes || 10 * 1024 * 1024;
    this.rotateInterval = options.rotateInterval || options.rotateIntervalMs || 24 * 60 * 60 * 1_000;
    this.delegate = new AsyncFileTransport({
      ...options,
      name: `${this.name}:delegate`,
      directory: this.logDirectory,
      filename: this.fileName,
      maxBytes: this.maxSize,
      rotateIntervalMs: this.rotateInterval,
      formatter: { format: (record) => String(record.formatted ?? record.message ?? '') },
    });
    this.filePath = this.delegate.filePath;
    this.closed = false;
  }

  write(level, logEntry) {
    if (this.closed) return false;
    const timestamp = new Date().toISOString();
    const promise = this.delegate.writeRecord({ timestamp, level, message: String(logEntry), formatted: String(logEntry), data: null });
    promise.catch(() => {});
    return promise;
  }

  _rotateLogs() { return this.delegate.rotate({ force: false }); }
  rotate(options) { return this.delegate.rotate(options); }
  flush(options) { return this.delegate.flush(options); }
  reopen() { return this.delegate.reopen(); }
  health() { return this.delegate.health(); }
  async close() { if (this.closed) return; this.closed = true; await this.delegate.close(); }
}

export default FileTransport;
