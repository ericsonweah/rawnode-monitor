'use strict';

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, writePrivateFile } from '../support/fs.js';

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export class ControlAuthenticator {
  constructor(options = {}) {
    this.tokenPath = options.tokenPath;
    this.token = options.token || null;
  }

  async initialize() {
    if (this.token) return this.token;
    if (!this.tokenPath) throw new Error('ControlAuthenticator requires tokenPath or token.');
    await ensureDir(path.dirname(this.tokenPath), 0o700);
    try {
      const existing = (await readFile(this.tokenPath, 'utf8')).trim();
      if (existing.length >= 32) {
        this.token = existing;
        return existing;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const token = randomBytes(32).toString('hex');
    await writePrivateFile(this.tokenPath, `${token}\n`);
    this.token = token;
    return token;
  }

  verify(candidate) {
    return safeEqual(this.token, candidate);
  }

  keyBytes() {
    const token = String(this.token || '');
    if (/^[a-f0-9]{64}$/i.test(token)) return Buffer.from(token, 'hex');
    return Buffer.from(token.padEnd(32, '0').slice(0, 32), 'utf8');
  }
}

export default ControlAuthenticator;
