'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import BaseTransport from './BaseTransport.js';
import TextFormatter from '../serialization/TextFormatter.js';
import JsonFormatter from '../serialization/JsonFormatter.js';

function safeInteger(value, fallback, minimum = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : fallback;
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function pathExists(file) {
  try { await fsp.access(file); return true; }
  catch { return false; }
}

/** Fully asynchronous rotating file transport with retention and durability. */
export class FileTransport extends BaseTransport {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'file' });
    if (options.serializer) this.serializer = options.serializer;
    this.logDirectory = path.resolve(options.logDirectory || options.directory || path.join(process.cwd(), 'logs'));
    this.fileName = options.fileName || options.filename || 'application.log';
    this.filePath = path.join(this.logDirectory, this.fileName);
    this.maxSize = safeInteger(options.maxSize ?? options.maxBytes, 10 * 1024 * 1024, 1);
    this.rotateInterval = safeInteger(options.rotateInterval ?? options.rotateIntervalMs, 24 * 60 * 60 * 1000, 0);
    this.compressOnRotate = options.compressOnRotate === true || options.compress === true;
    this.removeUncompressed = options.removeUncompressed !== false;
    this.mode = options.mode == null ? 0o640 : Number(options.mode);
    this.directoryMode = options.directoryMode == null ? 0o750 : Number(options.directoryMode);
    this.durability = options.durability || (options.fsync === true ? 'fsync' : 'none');
    this.format = options.format || (options.json === false ? 'text' : 'json');
    this.formatter = options.formatter || (this.format === 'text'
      ? new TextFormatter(options.textOptions)
      : new JsonFormatter(options.jsonOptions));
    this.retention = {
      maxFiles: safeInteger(options.retention?.maxFiles ?? options.maxFiles, 14, 0),
      maxAgeMs: safeInteger(options.retention?.maxAgeMs ?? options.maxAgeMs, 0, 0),
      maxTotalBytes: safeInteger(options.retention?.maxTotalBytes ?? options.maxTotalBytes, 0, 0),
    };
    this.followSymlinks = options.followSymlinks === true;
    this.fileNamePattern = typeof options.fileNamePattern === 'function' ? options.fileNamePattern : null;
    this.stream = null;
    this.currentBytes = 0;
    this.rotationSequence = 0;
    this.nextRotationAt = this.rotateInterval > 0 ? Date.now() + this.rotateInterval : Infinity;
    this._opening = null;
    this._writeTail = Promise.resolve();
    this._compressionJobs = new Set();
    this._timer = null;
    this.autoUnref = options.autoUnref !== false;
    this.lazy = options.lazy !== false;
    this.awaitCompression = options.awaitCompression === true;
    this.compressionConcurrency = safeInteger(options.compressionConcurrency, 1, 1);
    this.externalRotationCheckMs = safeInteger(options.externalRotationCheckMs, 5_000, 0);
    this._lastExternalCheckAt = 0;
    this._openedIdentity = null;
    this._compressionQueue = [];
    this._compressionActive = 0;

    if (!this.lazy) this._opening = this._open();
    if (this.rotateInterval > 0) {
      this._timer = setInterval(() => {
        this.rotate({ reason: 'interval', force: false }).catch((error) => this._failed(error));
      }, this.rotateInterval);
      if (this.autoUnref) this._timer.unref?.();
    }
  }

  async ready() {
    if (this.closed) throw Object.assign(new Error(`File transport [${this.name}] is closed.`), { code: 'LOGGER_FILE_CLOSED' });
    if (!this._opening) {
      this._opening = this._open().catch((error) => {
        this._opening = null;
        throw error;
      });
    }
    await this._opening;
    return this;
  }

  async _open() {
    await fsp.mkdir(this.logDirectory, { recursive: true, mode: this.directoryMode });
    try { await fsp.chmod(this.logDirectory, this.directoryMode); } catch {}

    let stats = null;
    try {
      const linkStats = await fsp.lstat(this.filePath);
      if (linkStats.isSymbolicLink() && !this.followSymlinks) {
        const error = new Error(`Refusing to open symbolic-link log file [${this.filePath}].`);
        error.code = 'LOGGER_FILE_SYMLINK_DENIED';
        throw error;
      }
      stats = await fsp.stat(this.filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    this.currentBytes = stats?.size || 0;
    this.stream = fs.createWriteStream(this.filePath, {
      flags: 'a',
      mode: this.mode,
      autoClose: true,
      highWaterMark: 64 * 1024,
    });
    const openedStream = this.stream;
    this.stream.on('error', (error) => this._failed(error));
    this.stream.on('close', () => {
      if (this.stream === openedStream && !this.closed) {
        this.stream = null;
        this._opening = null;
      }
    });
    await new Promise((resolve, reject) => {
      if (this.stream.pending === false) return resolve();
      this.stream.once('open', resolve);
      this.stream.once('error', reject);
    });
    try {
      const opened = await fsp.stat(this.filePath);
      this._openedIdentity = { dev: opened.dev, ino: opened.ino };
    } catch { this._openedIdentity = null; }
    this.emit('open', { file: this.filePath, bytes: this.currentBytes });
  }

  async writeRecord(record) {
    if (this.closed || this.silent) return;
    const task = async () => {
      await this.ready();
      await this._ensureCurrentFile();
      let output = typeof this.formatter === 'function'
        ? await this.formatter(record, this.serializer)
        : await this.formatter.format(record, this.serializer);
      if (!Buffer.isBuffer(output)) output = String(output);
      if (typeof output === 'string' && !output.endsWith('\n')) output += '\n';
      const bytes = Buffer.isBuffer(output) ? output.length : Buffer.byteLength(output);

      const dueBySize = this.currentBytes > 0 && this.currentBytes + bytes > this.maxSize;
      const dueByTime = this.currentBytes > 0 && Date.now() >= this.nextRotationAt;
      if (dueBySize || dueByTime) await this._rotateInternal({ reason: dueBySize ? 'size' : 'interval', force: true });

      await this._write(output);
      this.currentBytes += bytes;
      this._written(bytes);
      this.emit('written', record);
    };
    const next = this._writeTail.then(task, task);
    this._writeTail = next.catch((error) => {
      this._failed(error);
      throw error;
    });
    return await next;
  }

  async _write(output) {
    await new Promise((resolve, reject) => {
      let callbackDone = false;
      let drainDone = true;
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        if (error) {
          settled = true;
          reject(error);
        } else if (callbackDone && drainDone) {
          settled = true;
          resolve();
        }
      };
      try {
        const accepted = this.stream.write(output, (error) => {
          callbackDone = true;
          finish(error);
        });
        if (accepted === false) {
          drainDone = false;
          this.stream.once('drain', () => {
            drainDone = true;
            finish();
          });
        }
      } catch (error) { finish(error); }
    });
  }

  async rotate(options = {}) {
    if (this.closed) return null;
    const normalized = { reason: 'manual', force: true, ...(options || {}) };
    const task = () => this._rotateInternal(normalized);
    const next = this._writeTail.then(task, task);
    this._writeTail = next.catch((error) => {
      this._failed(error);
      throw error;
    });
    return await next;
  }

  async _rotateInternal(options = {}) {
    await this.ready();
    const reason = options.reason || 'manual';
    const due = this.currentBytes > 0 && (reason === 'interval' ? Date.now() >= this.nextRotationAt : this.currentBytes >= this.maxSize);
    if (!options.force && !due) return null;
    if (this.currentBytes <= 0) {
      this.nextRotationAt = this.rotateInterval > 0 ? Date.now() + this.rotateInterval : Infinity;
      return null;
    }

    this.emit('rotateStart', { file: this.filePath, reason, bytes: this.currentBytes });
    await this._sync();
    await this._endStream();

    const extension = path.extname(this.fileName);
    const base = path.basename(this.fileName, extension);
    const metadata = {
      timestamp: timestampForFile(),
      pid: process.pid,
      sequence: ++this.rotationSequence,
      reason,
      bytes: this.currentBytes,
    };
    const defaultName = `${base}-${metadata.timestamp}-${metadata.pid}-${metadata.sequence}${extension || '.log'}`;
    const archiveName = this.fileNamePattern ? this.fileNamePattern(this.fileName, metadata) : defaultName;
    let archivePath = path.resolve(this.logDirectory, archiveName);
    if (!archivePath.startsWith(`${this.logDirectory}${path.sep}`)) {
      const error = new Error('fileNamePattern attempted to escape the log directory.');
      error.code = 'LOGGER_FILE_ARCHIVE_PATH_DENIED';
      throw error;
    }

    let collision = 0;
    while (await pathExists(archivePath)) {
      collision++;
      const archiveExtension = path.extname(archivePath);
      const archiveBase = path.basename(archivePath, archiveExtension);
      archivePath = path.join(this.logDirectory, `${archiveBase}-${collision}${archiveExtension}`);
    }

    let renameError = null;
    try { await fsp.rename(this.filePath, archivePath); }
    catch (error) { if (error.code !== 'ENOENT') renameError = error; }
    finally {
      this.stream = null;
      this._opening = null;
      this._openedIdentity = null;
      this.currentBytes = 0;
      this.nextRotationAt = this.rotateInterval > 0 ? Date.now() + this.rotateInterval : Infinity;
      await this.ready();
    }
    if (renameError) throw renameError;

    let outputPath = archivePath;
    let compressionPending = false;
    if (this.compressOnRotate && await pathExists(archivePath)) {
      const job = this._scheduleCompression(archivePath);
      this._compressionJobs.add(job);
      job.finally(() => this._compressionJobs.delete(job)).catch(() => {});
      const shouldAwaitCompression = options.awaitCompression ?? (reason === 'manual' ? true : this.awaitCompression);
      if (shouldAwaitCompression) {
        outputPath = await job;
        await this._applyRetention();
      } else {
        outputPath = `${archivePath}.gz`;
        compressionPending = true;
        job.then(() => this._applyRetention()).catch((error) => this._failed(error));
      }
    } else {
      await this._applyRetention();
    }
    this.stats.rotations = (this.stats.rotations || 0) + 1;
    const result = { archive: outputPath, source: archivePath, reason, compressionPending };
    this.emit('rotate', result);
    return result;
  }

  async _ensureCurrentFile() {
    if (!this.externalRotationCheckMs || !this.stream) return;
    const now = Date.now();
    if (now - this._lastExternalCheckAt < this.externalRotationCheckMs) return;
    this._lastExternalCheckAt = now;
    let stats = null;
    try { stats = await fsp.stat(this.filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const changed = !stats
      || (this._openedIdentity && (stats.dev !== this._openedIdentity.dev || stats.ino !== this._openedIdentity.ino));
    if (!changed) {
      if (stats && Number.isFinite(stats.size)) this.currentBytes = stats.size;
      return;
    }
    await this._sync();
    await this._endStream();
    this._opening = null;
    this._openedIdentity = null;
    await this.ready();
    this.emit('externalRotate', { file: this.filePath });
  }

  _scheduleCompression(file) {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    this._compressionQueue.push({ file, resolve, reject });
    this._pumpCompression();
    return promise;
  }

  _pumpCompression() {
    while (this._compressionActive < this.compressionConcurrency && this._compressionQueue.length) {
      const job = this._compressionQueue.shift();
      this._compressionActive++;
      Promise.resolve()
        .then(() => this._compress(job.file))
        .then(job.resolve, job.reject)
        .finally(() => {
          this._compressionActive--;
          this._pumpCompression();
        });
    }
  }

  async _compress(file) {
    const destination = `${file}.gz`;
    await pipeline(
      fs.createReadStream(file),
      createGzip(),
      fs.createWriteStream(destination, { mode: this.mode }),
    );
    // Resolve rotation only after the archive is visible and stat-able. This
    // gives callers a durable postcondition across filesystems and CI runners.
    await fsp.stat(destination);
    if (this.removeUncompressed) await fsp.unlink(file).catch(() => {});
    this.stats.compressed = (this.stats.compressed || 0) + 1;
    this.emit('compress', { source: file, archive: destination });
    return destination;
  }

  async _applyRetention() {
    const { maxFiles, maxAgeMs, maxTotalBytes } = this.retention;
    if (!maxFiles && !maxAgeMs && !maxTotalBytes) return;
    const extension = path.extname(this.fileName);
    const base = path.basename(this.fileName, extension);
    const entries = await fsp.readdir(this.logDirectory, { withFileTypes: true });
    const archives = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(`${base}-`) || entry.name === this.fileName) continue;
      const absolute = path.join(this.logDirectory, entry.name);
      try {
        const stats = await fsp.stat(absolute);
        archives.push({ path: absolute, name: entry.name, size: stats.size, mtimeMs: stats.mtimeMs });
      } catch {}
    }
    archives.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const now = Date.now();
    let total = 0;
    for (let index = 0; index < archives.length; index++) {
      const archive = archives[index];
      total += archive.size;
      const removeByCount = maxFiles > 0 && index >= maxFiles;
      const removeByAge = maxAgeMs > 0 && now - archive.mtimeMs > maxAgeMs;
      const removeByBytes = maxTotalBytes > 0 && total > maxTotalBytes;
      if (removeByCount || removeByAge || removeByBytes) {
        await fsp.unlink(archive.path).catch(() => {});
        this.stats.retentionDeletes = (this.stats.retentionDeletes || 0) + 1;
        this.emit('retentionDelete', archive);
      }
    }
  }

  async _endStream() {
    const stream = this.stream;
    this.stream = null;
    if (!stream || stream.destroyed || stream.writableEnded) return;
    await new Promise((resolve, reject) => {
      const onError = (error) => { cleanup(); reject(error); };
      const onFinish = () => { cleanup(); resolve(); };
      const cleanup = () => {
        stream.off('error', onError);
        stream.off('finish', onFinish);
      };
      stream.once('error', onError);
      stream.once('finish', onFinish);
      stream.end();
    });
  }

  async _sync() {
    if (this.durability === 'none' || !this.stream || !Number.isInteger(this.stream.fd)) return;
    const method = this.durability === 'fdatasync' && typeof fs.fdatasync === 'function' ? fs.fdatasync : fs.fsync;
    await new Promise((resolve, reject) => method(this.stream.fd, (error) => error ? reject(error) : resolve()));
  }

  async flush() {
    await this._writeTail;
    await Promise.allSettled([...this._compressionJobs]);
    await this._sync();
    await super.flush();
  }

  async reopen() {
    if (this.closed) return false;
    const task = async () => {
      await this._sync();
      await this._endStream();
      this._opening = null;
      await this.ready();
      this.emit('reopen', { file: this.filePath });
      return true;
    };
    const next = this._writeTail.then(task, task);
    this._writeTail = next.catch((error) => { this._failed(error); throw error; });
    return await next;
  }

  async close() {
    if (this.closed) return;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    await this.flush();
    await this._endStream();
    this._opening = null;
    await super.close();
  }

  health() {
    return {
      ...super.health(),
      file: this.filePath,
      currentBytes: this.currentBytes,
      maxSize: this.maxSize,
      nextRotationAt: Number.isFinite(this.nextRotationAt) ? this.nextRotationAt : null,
      compressionJobs: this._compressionJobs.size,
      compressionQueued: this._compressionQueue.length,
      compressionActive: this._compressionActive,
      durability: this.durability,
    };
  }
}

export default FileTransport;
