'use strict';

import { webcrypto, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { atomicWriteFile } from '../support/fs.js';
import { STATE_SCHEMA_VERSION } from '../constants.js';

const subtle = globalThis.crypto?.subtle || webcrypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function importAesKey(keyBytes) {
  return subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export class JsonStateStore {
  constructor(options = {}) {
    this.file = options.file;
    this.keyProvider = options.keyProvider || null;
    this.encrypted = options.encrypted !== false;
  }

  async save(state) {
    if (!this.file) throw new Error('JsonStateStore requires file.');
    const payload = {
      schemaVersion: STATE_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      ...state,
    };

    let envelope;
    if (this.encrypted && this.keyProvider) {
      const keyBytes = await this.keyProvider();
      const key = await importAesKey(keyBytes);
      const iv = randomBytes(12);
      const plaintext = encoder.encode(JSON.stringify(payload));
      const encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
      envelope = {
        format: 'rawnode-pm-state',
        version: 1,
        encrypted: true,
        iv: Buffer.from(iv).toString('base64'),
        data: Buffer.from(encrypted).toString('base64'),
      };
    } else {
      envelope = { format: 'rawnode-pm-state', version: 1, encrypted: false, data: payload };
    }

    await atomicWriteFile(this.file, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, dirMode: 0o700 });
    return payload;
  }

  async load(fallback = null) {
    let envelope;
    try { envelope = JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) {
      if (error?.code === 'ENOENT') return fallback;
      throw error;
    }

    if (envelope?.format !== 'rawnode-pm-state') throw new Error('Invalid RawNode PM state file.');
    if (!envelope.encrypted) return envelope.data;
    if (!this.keyProvider) throw new Error('State is encrypted but no key provider is configured.');
    const keyBytes = await this.keyProvider();
    const key = await importAesKey(keyBytes);
    const iv = Buffer.from(envelope.iv, 'base64');
    const ciphertext = Buffer.from(envelope.data, 'base64');
    const plaintext = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(decoder.decode(plaintext));
  }
}

export default JsonStateStore;
