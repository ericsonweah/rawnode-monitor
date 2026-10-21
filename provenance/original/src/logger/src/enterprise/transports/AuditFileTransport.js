'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import readline from 'node:readline';
import FileTransport from './FileTransport.js';
import AuditChain from '../security/AuditChain.js';

async function readLastAuditState(filePath) {
  let handle;
  try {
    handle = await fsp.open(filePath, 'r');
    const stats = await handle.stat();
    if (!stats.size) return { previousHash: 'GENESIS', sequence: 0 };
    const length = Math.min(stats.size, 1024 * 1024);
    const buffer = Buffer.allocUnsafe(length);
    await handle.read(buffer, 0, length, stats.size - length);
    const lines = buffer.toString('utf8').trim().split('\n');
    for (let index = lines.length - 1; index >= 0; index--) {
      try {
        const parsed = JSON.parse(lines[index]);
        if (parsed?.audit?.hash) {
          return {
            previousHash: String(parsed.audit.hash),
            sequence: Number(parsed.audit.sequence) || 0,
          };
        }
      } catch {}
    }
    return { previousHash: 'GENESIS', sequence: 0 };
  } catch (error) {
    if (error?.code === 'ENOENT') return { previousHash: 'GENESIS', sequence: 0 };
    throw error;
  } finally {
    await handle?.close?.().catch(() => {});
  }
}

/**
 * Append-only, tamper-evident NDJSON transport.
 * Each row contains an HMAC chained to the previous row, and the chain resumes
 * from an existing file after process restart.
 */
export class AuditFileTransport extends FileTransport {
  constructor(options = {}) {
    const key = options.key ?? options.secret ?? process.env.LOG_AUDIT_SECRET ?? process.env.APP_KEY;
    if (!key && !options.keyResolver) throw new TypeError('AuditFileTransport requires a key, secret, or keyResolver.');
    super({
      ...options,
      name: options.name || 'audit-file',
      format: 'json',
      json: true,
      durability: options.durability || (options.fsync === false ? 'none' : 'fsync'),
    });
    this.auditChain = options.auditChain || new AuditChain({
      ...(options.audit || {}),
      ...options,
      key,
    });
    this._auditReady = readLastAuditState(this.filePath).then((state) => {
      this.auditChain.previousHash = state.previousHash;
      this.auditChain.sequence = state.sequence;
      return state;
    });
  }

  async ready() {
    await this._auditReady;
    return await super.ready();
  }

  async writeRecord(record) {
    await this._auditReady;
    const signed = await this.auditChain.sign(record);
    return await super.writeRecord(signed);
  }

  health() {
    return {
      ...super.health(),
      audit: {
        keyId: this.auditChain.keyId,
        algorithm: `hmac-${this.auditChain.algorithm}`,
        sequence: this.auditChain.sequence,
        previousHash: this.auditChain.previousHash,
      },
    };
  }

  static async verifyFile(filePath, options = {}) {
    const key = options.key ?? options.secret ?? process.env.LOG_AUDIT_SECRET ?? process.env.APP_KEY;
    if (!key && !options.keyResolver) throw new TypeError('Audit verification requires a key, secret, or keyResolver.');

    const input = fs.createReadStream(filePath, { encoding: 'utf8' });
    const reader = readline.createInterface({ input, crlfDelay: Infinity });
    let previousHash = options.previousHash || 'GENESIS';
    let sequence = Number(options.sequence) || 0;
    let lines = 0;
    const failures = [];

    try {
      for await (const text of reader) {
        if (!text.trim()) continue;
        lines++;
        try {
          const record = JSON.parse(text);
          const result = await AuditChain.verify([record], {
            key,
            keyResolver: options.keyResolver,
            previousHash,
            sequence,
          });
          for (const failure of result.failures) failures.push({ line: lines, ...failure });
          previousHash = result.lastHash;
          sequence = Number(record?.audit?.sequence) || sequence + 1;
        } catch (error) {
          failures.push({ line: lines, reason: 'parse', message: error?.message || String(error) });
        }
      }
    } finally {
      reader.close();
      input.destroy();
    }

    return {
      valid: failures.length === 0,
      ok: failures.length === 0,
      lines,
      count: lines,
      failures,
      finalHash: previousHash,
      lastHash: previousHash,
      sequence,
    };
  }
}

export default AuditFileTransport;
