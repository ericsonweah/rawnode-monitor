'use strict';

import { createWriteStream } from 'node:fs';
import { stat, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir } from '../support/fs.js';
import { AsyncLock } from '../support/async.js';
import { safeJsonLine } from '../support/json.js';

export class AtomicJournal {
  constructor(options = {}) {
    this.file = options.file;
    this.maxBytes = Math.max(1024 * 1024, Number(options.maxBytes) || 20 * 1024 * 1024);
    this.maxFiles = Math.max(1, Number(options.maxFiles) || 3);
    this._stream = null;
    this._bytes = 0;
    this._lock = new AsyncLock();
  }

  async open() {
    if (this._stream) return this;
    if (!this.file) throw new Error('AtomicJournal requires file.');
    await ensureDir(path.dirname(this.file), 0o700);
    try { this._bytes = (await stat(this.file)).size; } catch { this._bytes = 0; }
    this._stream = createWriteStream(this.file, { flags: 'a', mode: 0o600 });
    this._stream.on('error', () => {});
    return this;
  }

  async append(type, payload = {}) {
    return this._lock.run(async () => {
      await this.open();
      const line = safeJsonLine({ at: Date.now(), type, payload });
      const bytes = Buffer.byteLength(line);
      if (this._bytes + bytes > this.maxBytes) await this._rotate();
      await new Promise((resolve, reject) => {
        if (this._stream.write(line)) return resolve();
        const onDrain = () => { cleanup(); resolve(); };
        const onError = (error) => { cleanup(); reject(error); };
        const cleanup = () => {
          this._stream.off('drain', onDrain);
          this._stream.off('error', onError);
        };
        this._stream.once('drain', onDrain);
        this._stream.once('error', onError);
      });
      this._bytes += bytes;
    });
  }

  async _rotate() {
    const stream = this._stream;
    this._stream = null;
    if (stream) await new Promise((resolve) => stream.end(resolve));
    await rm(`${this.file}.${this.maxFiles}`, { force: true }).catch(() => {});
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      await rename(`${this.file}.${i}`, `${this.file}.${i + 1}`).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
    await rename(this.file, `${this.file}.1`).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    this._bytes = 0;
    await this.open();
  }

  async close() {
    if (!this._stream) return;
    const stream = this._stream;
    this._stream = null;
    await new Promise((resolve) => stream.end(resolve));
  }
}

export default AtomicJournal;
