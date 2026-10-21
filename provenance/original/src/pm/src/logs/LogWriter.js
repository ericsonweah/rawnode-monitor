'use strict';

import { createWriteStream } from 'node:fs';
import { stat, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir } from '../support/fs.js';
import { AsyncLock } from '../support/async.js';

export class LogWriter {
  constructor(options = {}) {
    this.file = options.file;
    this.maxBytes = Math.max(64 * 1024, Number(options.maxBytes) || 50 * 1024 * 1024);
    this.maxFiles = Math.max(1, Number(options.maxFiles) || 5);
    this.mode = options.mode || 0o600;
    this.bytes = 0;
    this.stream = null;
    this.lock = new AsyncLock();
    this.closed = false;
  }

  async open() {
    if (this.stream) return this.stream;
    if (this.closed) throw new Error(`LogWriter for '${this.file}' is closed.`);
    await ensureDir(path.dirname(this.file), 0o700);
    try { this.bytes = (await stat(this.file)).size; } catch { this.bytes = 0; }
    this.stream = createWriteStream(this.file, { flags: 'a', mode: this.mode });
    return this.stream;
  }

  async write(chunk) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    return this.lock.run(async () => {
      if (this.closed) return false;
      await this.open();
      if (this.bytes > 0 && this.bytes + buffer.length > this.maxBytes) await this.rotate();
      await new Promise((resolve, reject) => {
        const stream = this.stream;
        const onError = (error) => { cleanup(); reject(error); };
        const onDrain = () => { cleanup(); resolve(); };
        const cleanup = () => {
          stream.off('error', onError);
          stream.off('drain', onDrain);
        };
        stream.once('error', onError);
        if (stream.write(buffer)) { cleanup(); resolve(); }
        else stream.once('drain', onDrain);
      });
      this.bytes += buffer.length;
      return true;
    });
  }

  async rotate() {
    const stream = this.stream;
    this.stream = null;
    if (stream) await new Promise((resolve) => stream.end(resolve));
    await rm(`${this.file}.${this.maxFiles}`, { force: true }).catch(() => {});
    for (let index = this.maxFiles - 1; index >= 1; index--) {
      await rename(`${this.file}.${index}`, `${this.file}.${index + 1}`).catch((error) => {
        if (error?.code !== 'ENOENT') throw error;
      });
    }
    await rename(this.file, `${this.file}.1`).catch((error) => {
      if (error?.code !== 'ENOENT') throw error;
    });
    this.bytes = 0;
    await this.open();
  }

  async close() {
    return this.lock.run(async () => {
      this.closed = true;
      const stream = this.stream;
      this.stream = null;
      if (stream) await new Promise((resolve) => stream.end(resolve));
    });
  }
}

export default LogWriter;
