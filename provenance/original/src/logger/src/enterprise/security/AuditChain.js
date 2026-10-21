'use strict';

import { createHmac, timingSafeEqual } from 'node:crypto';

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export class AuditChain {
  constructor(options = {}) {
    const key = options.key ?? options.secret;
    if (!key && !options.keyResolver) throw new TypeError('AuditChain requires a key, secret, or keyResolver.');
    this.key = key;
    this.keyResolver = options.keyResolver;
    this.keyId = options.keyId || 'default';
    this.algorithm = options.algorithm || 'sha256';
    this.previousHash = options.previousHash || 'GENESIS';
    this.sequence = Number(options.sequence) || 0;
  }

  async resolveKey(keyId = this.keyId) {
    if (this.keyResolver) return await this.keyResolver(keyId);
    return this.key;
  }

  async sign(record) {
    const sequence = ++this.sequence;
    const payload = {
      sequence,
      previousHash: this.previousHash,
      record,
    };
    const key = await this.resolveKey(this.keyId);
    const hash = createHmac(this.algorithm, key).update(stableStringify(payload)).digest('hex');
    this.previousHash = hash;
    return {
      ...record,
      audit: {
        version: 1,
        algorithm: `hmac-${this.algorithm}`,
        keyId: this.keyId,
        sequence,
        previousHash: payload.previousHash,
        hash,
      },
    };
  }

  static async verify(records, options = {}) {
    let previousHash = options.previousHash || 'GENESIS';
    let expectedSequence = Number(options.sequence) || 0;
    const keyResolver = options.keyResolver || (async () => options.key);
    const failures = [];

    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      const audit = record?.audit;
      if (!audit) {
        failures.push({ index, reason: 'missing-audit' });
        continue;
      }
      expectedSequence++;
      const unsigned = { ...record };
      delete unsigned.audit;
      const payload = { sequence: audit.sequence, previousHash: audit.previousHash, record: unsigned };
      const key = await keyResolver(audit.keyId);
      const expectedHash = createHmac(String(audit.algorithm || 'hmac-sha256').replace(/^hmac-/, ''), key)
        .update(stableStringify(payload))
        .digest('hex');
      if (audit.sequence !== expectedSequence) failures.push({ index, reason: 'sequence', expected: expectedSequence, actual: audit.sequence });
      if (audit.previousHash !== previousHash) failures.push({ index, reason: 'previous-hash', expected: previousHash, actual: audit.previousHash });
      if (!safeEqual(audit.hash, expectedHash)) failures.push({ index, reason: 'hash', expected: expectedHash, actual: audit.hash });
      previousHash = audit.hash;
    }

    return {
      ok: failures.length === 0,
      valid: failures.length === 0,
      count: records.length,
      lines: records.length,
      failures,
      lastHash: previousHash,
      finalHash: previousHash,
    };
  }
}

export { stableStringify };
export default AuditChain;
