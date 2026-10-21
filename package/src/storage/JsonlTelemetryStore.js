'use strict';

import { createReadStream } from 'node:fs';
import { mkdir, appendFile, readdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { deepFreeze, safeGet } from '../support.js';

const DEFAULT_SCAN_LIMIT = 100_000;
const DEFAULT_MAX_LINE_BYTES = 2 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

export class JsonlTelemetryStore {
  constructor(options = {}) {
    this.root = path.resolve(options.path || options.root || 'storage/framework/monitor');
    this.maxFileBytes = Math.max(1_024, Number(options.maxFileBytes) || 128 * 1024 * 1024);
    this.maxReadBytes = Math.max(1_024, Number(options.maxReadBytes) || 64 * 1024 * 1024);
    this.maxLineBytes = Math.max(1_024, Number(options.maxLineBytes) || DEFAULT_MAX_LINE_BYTES);
    this.mode = options.mode ?? 0o600;
    this.directoryMode = options.directoryMode ?? 0o700;
    this.serializer = options.serializer || JSON;
    this.files = new Map();
    this.chains = new Map();
    this.pendingWrites = new Set();
    this.closePromise = null;
    this.ready = false;
    this.closed = false;
    this.stats = {
      written: 0,
      bytes: 0,
      rotations: 0,
      errors: 0,
      queried: 0,
      queryBytes: 0,
      scannedLines: 0,
      parseErrors: 0,
      oversizedLines: 0,
      truncatedQueries: 0,
      pruned: 0,
    };
  }

  async initialize() {
    if (this.ready) return this;
    await mkdir(this.root, { recursive: true, mode: this.directoryMode });
    this.ready = true;
    return this;
  }

  async write(signal) { return await this.writeMany([signal]); }

  async writeMany(signals = []) {
    if (this.closed) return { written: 0, closed: true };
    // Track the whole admitted operation before initialization can yield. A
    // chain alone does not cover initialization or subsequent signal kinds.
    const operation = Promise.resolve().then(() => this._writeMany(signals));
    this.pendingWrites.add(operation);
    try { return await operation; }
    finally { this.pendingWrites.delete(operation); }
  }

  async _writeMany(signals) {
    await this.initialize();
    const groups = new Map();
    for (const signal of signals) {
      const kind = safeKind(signal?.kind || 'unknown');
      const lines = groups.get(kind) || [];
      lines.push(`${this._stringify(signal)}\n`);
      groups.set(kind, lines);
    }
    let written = 0;
    for (const [kind, lines] of groups) {
      const payload = lines.join('');
      const payloadBytes = Buffer.byteLength(payload);
      await this._serialize(kind, async () => {
        const file = await this._file(kind, payloadBytes);
        await appendFile(file.path, payload, { encoding: 'utf8', mode: this.mode });
        file.bytes += payloadBytes;
        this.stats.written += lines.length;
        this.stats.bytes += payloadBytes;
        written += lines.length;
      });
    }
    return { written };
  }

  _stringify(value) {
    return typeof this.serializer?.stringify === 'function'
      ? this.serializer.stringify(value)
      : JSON.stringify(value);
  }

  _parse(value) {
    return typeof this.serializer?.parse === 'function'
      ? this.serializer.parse(value)
      : JSON.parse(value);
  }

  async _file(kind, incomingBytes) {
    let record = this.files.get(kind);
    if (!record) {
      const filePath = path.join(this.root, `${kind}-${dateKey()}.jsonl`);
      let bytes = 0;
      try { bytes = (await stat(filePath)).size; } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      record = { path: filePath, bytes, sequence: 0 };
      this.files.set(kind, record);
    }
    if (record.bytes + incomingBytes <= this.maxFileBytes) return record;
    const rotated = `${record.path.replace(/\.jsonl$/, '')}.${Date.now()}.${++record.sequence}.jsonl`;
    try { await rename(record.path, rotated); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    record.bytes = 0;
    this.stats.rotations++;
    return record;
  }

  _serialize(key, operation) {
    const previous = this.chains.get(key) || Promise.resolve();
    const next = previous.then(operation, operation).catch((error) => { this.stats.errors++; throw error; });
    const tracked = next.finally(() => { if (this.chains.get(key) === tracked) this.chains.delete(key); });
    this.chains.set(key, tracked);
    return tracked;
  }

  async query(options = {}) {
    await this.initialize();
    this.stats.queried++;
    const kind = options.kind ? safeKind(options.kind) : null;
    const entries = (await readdir(this.root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl') && (!kind || entry.name.startsWith(`${kind}-`)))
      .map((entry) => path.join(this.root, entry.name))
      .sort()
      .reverse();

    const maxReadBytes = Math.max(1_024, Math.min(this.maxReadBytes, Number(options.maxReadBytes) || this.maxReadBytes));
    const maxLineBytes = Math.max(1_024, Math.min(this.maxLineBytes, Number(options.maxLineBytes) || this.maxLineBytes));
    const scanLimit = Math.max(1, Number(options.scanLimit) || DEFAULT_SCAN_LIMIT);
    const items = [];
    const scan = {
      readBytes: 0,
      scannedLines: 0,
      parseErrors: 0,
      oversizedLines: 0,
      truncated: false,
    };

    for (const file of entries) {
      if (scan.readBytes >= maxReadBytes || scan.scannedLines >= scanLimit) {
        scan.truncated = true;
        break;
      }
      await this._scanFile(file, options, items, scan, { maxReadBytes, maxLineBytes, scanLimit });
      if (scan.truncated) break;
    }

    const order = options.order === 'asc' ? 1 : -1;
    items.sort((a, b) => order * (Number(a.timestamp || 0) - Number(b.timestamp || 0)));
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Math.max(1, Number(options.limit) || 100);

    this.stats.queryBytes += scan.readBytes;
    this.stats.scannedLines += scan.scannedLines;
    this.stats.parseErrors += scan.parseErrors;
    this.stats.oversizedLines += scan.oversizedLines;
    if (scan.truncated) this.stats.truncatedQueries++;

    return deepFreeze({
      items: items.slice(offset, offset + limit),
      total: items.length,
      offset,
      limit,
      readBytes: scan.readBytes,
      scannedLines: scan.scannedLines,
      parseErrors: scan.parseErrors,
      oversizedLines: scan.oversizedLines,
      truncated: scan.truncated,
    });
  }

  async _scanFile(file, options, items, scan, limits) {
    const remainingBytes = limits.maxReadBytes - scan.readBytes;
    if (remainingBytes <= 0) { scan.truncated = true; return; }

    const stream = createReadStream(file, {
      highWaterMark: Math.max(1_024, Math.min(READ_CHUNK_BYTES, remainingBytes)),
    });
    const decoder = new StringDecoder('utf8');
    let carry = '';
    let discardingOversizedLine = false;

    try {
      for await (const chunk of stream) {
        const available = limits.maxReadBytes - scan.readBytes;
        if (available <= 0) { scan.truncated = true; break; }
        const accepted = chunk.length > available ? chunk.subarray(0, available) : chunk;
        scan.readBytes += accepted.length;
        carry += decoder.write(accepted);

        let newline = carry.indexOf('\n');
        while (newline !== -1) {
          const line = carry.slice(0, newline);
          carry = carry.slice(newline + 1);
          if (discardingOversizedLine) {
            discardingOversizedLine = false;
          } else if (!this._consumeLine(line, options, items, scan, limits)) {
            return;
          }
          newline = carry.indexOf('\n');
        }

        if (discardingOversizedLine) {
          carry = '';
        } else if (Buffer.byteLength(carry) > limits.maxLineBytes) {
          scan.oversizedLines++;
          carry = '';
          discardingOversizedLine = true;
        }
        if (chunk.length > accepted.length || scan.readBytes >= limits.maxReadBytes) {
          scan.truncated = true;
          break;
        }
      }

      carry += decoder.end();
      if (!scan.truncated && !discardingOversizedLine && carry && scan.scannedLines < limits.scanLimit && Buffer.byteLength(carry) <= limits.maxLineBytes) {
        this._consumeLine(carry, options, items, scan, limits);
      } else if (!discardingOversizedLine && carry && Buffer.byteLength(carry) > limits.maxLineBytes) {
        scan.oversizedLines++;
      }
    } finally {
      stream.destroy();
    }
  }

  _consumeLine(line, options, items, scan, limits) {
    if (!line) return true;
    if (scan.scannedLines >= limits.scanLimit) { scan.truncated = true; return false; }
    scan.scannedLines++;
    if (Buffer.byteLength(line) > limits.maxLineBytes) {
      scan.oversizedLines++;
      return true;
    }
    try {
      const row = this._parse(line);
      if (matches(row, options)) items.push(row);
    } catch {
      scan.parseErrors++;
    }
    if (scan.scannedLines >= limits.scanLimit) scan.truncated = true;
    return !scan.truncated;
  }

  async prune(options = {}) {
    await this.initialize();
    const before = Number(options.before || Date.now() - Number(options.retentionMs || 0));
    const entries = await readdir(this.root, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      const file = path.join(this.root, entry.name);
      const info = await stat(file);
      if (info.mtimeMs < before && !Array.from(this.files.values()).some((record) => record.path === file)) {
        await unlink(file).catch(() => {});
        removed++;
      }
    }
    this.stats.pruned += removed;
    return removed;
  }

  async flush() { await Promise.allSettled([...this.pendingWrites]); return this.snapshot(); }
  async close() {
    if (this.closePromise) return await this.closePromise;
    this.closed = true;
    this.closePromise = this.flush();
    return await this.closePromise;
  }
  snapshot() {
    return Object.freeze({
      driver: 'file',
      root: this.root,
      closed: this.closed,
      maxReadBytes: this.maxReadBytes,
      maxLineBytes: this.maxLineBytes,
      files: Object.freeze(Array.from(this.files.entries(), ([kind, record]) => ({ kind, path: record.path, bytes: record.bytes }))),
      stats: Object.freeze({ ...this.stats }),
    });
  }
}

function safeKind(value) { return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 64) || 'unknown'; }
function dateKey(date = new Date()) { return date.toISOString().slice(0, 10); }
function matches(row, options) {
  if (options.traceId && row.traceId !== String(options.traceId) && row.payload?.traceId !== String(options.traceId)) return false;
  if (options.tenantId && row.tenantId !== String(options.tenantId)) return false;
  if (options.since && Number(row.timestamp || 0) < Number(options.since)) return false;
  if (options.until && Number(row.timestamp || 0) > Number(options.until)) return false;
  if (options.where && !Object.entries(options.where).every(([key, value]) => safeGet(row, key) === value)) return false;
  return typeof options.filter !== 'function' || options.filter(row);
}

export default JsonlTelemetryStore;
