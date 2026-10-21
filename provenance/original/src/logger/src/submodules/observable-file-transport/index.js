'use strict';

import BaseTransport from '../base/BaseTransport.js';
import AsyncFileTransport from '../../transports/AsyncFileTransport.js';

class ObservableFileTransport extends BaseTransport {
  constructor(options = {}) {
    super(options);
    this.delegate = new AsyncFileTransport({
      ...options,
      directory: options.directory || options.logDirectory,
      filename: options.filename || options.fileName,
      maxBytes: options.maxBytes || options.maxSize,
      rotateIntervalMs: options.rotateIntervalMs || options.rotateInterval,
      formatter: options.formatter || { format: (record) => String(record.formatted ?? record.message ?? '') },
    });
    this.logDirectory = this.delegate.logDirectory;
    this.fileName = this.delegate.fileName;
    this.filePath = this.delegate.filePath;
    for (const event of ['open','written','rotateStart','rotate','compress','retentionDelete','reopen','error']) {
      this.delegate.on(event, (...args) => this._safeEmit(event, ...args));
    }
  }

  _transform(chunk, _encoding, callback) {
    const entry = this._normalize(chunk);
    this._safeEmit('beforeWrite', entry);
    this.delegate.writeRecord(entry).then(() => {
      this.stats.written++;
      this._safeEmit('written', entry);
      this._safeEmit('afterWrite', entry);
      callback(null, chunk);
    }, (error) => {
      this.stats.errors++;
      this._safeEmit('transportError', error);
      callback(error);
    });
  }

  rotate(options) { return this.delegate.rotate(options); }
  flush(options) { return this.delegate.flush(options); }
  reopen() { return this.delegate.reopen(); }
  health() { return this.delegate.health(); }
  async close() { await this.delegate.close(); await super.close(); }
}

export default ObservableFileTransport;
