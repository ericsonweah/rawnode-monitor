'use strict';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

export class NodeEventCrypto {
  constructor(options = {}) {
    this.keys = new Map();
    this.primaryKeyId = options.primaryKeyId || null;
    for (const key of options.keys || []) this.addKey(key);
    if (options.secret) this.addKey({ id: options.keyId || 'events-primary', secret: options.secret, primary: true });
  }
  addKey(input = {}) {
    const id = String(input.id || input.keyId || input.kid || 'events-key');
    const secret = input.secret ?? input.key;
    if (secret == null) throw new TypeError(`Event crypto key '${id}' requires secret.`);
    const value = Buffer.isBuffer(secret) ? Buffer.from(secret) : Buffer.from(String(secret));
    if (value.length < Math.max(1, Number(input.minimumBytes) || 16)) throw Object.assign(new Error(`Event crypto key '${id}' is too short.`), { code: 'EVENT_CRYPTO_KEY_TOO_SHORT' });
    this.keys.set(id, { id, secret: value, algorithm: input.algorithm || 'hmac-sha256', createdAt: input.createdAt || null, expiresAt: input.expiresAt || null });
    if (input.primary === true || !this.primaryKeyId) this.primaryKeyId = id;
    return this;
  }
  sign(bytes, options = {}) {
    const key = this._key(options.keyId);
    return { keyId: key.id, algorithm: 'hmac-sha256', signature: createHmac('sha256', key.secret).update(bytes).digest('base64url') };
  }
  verify(bytes, signature, options = {}) {
    try {
      const expected = Buffer.from(this.sign(bytes, options).signature, 'base64url');
      const supplied = Buffer.from(String(signature), 'base64url');
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    } catch { return false; }
  }
  rotate(input) { return this.addKey({ ...input, primary: true }); }
  _key(id = null) {
    const key = this.keys.get(String(id || this.primaryKeyId));
    if (!key) throw Object.assign(new Error(`Unknown event crypto key '${id || this.primaryKeyId}'.`), { code: 'EVENT_CRYPTO_KEY_UNKNOWN' });
    if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) throw Object.assign(new Error(`Event crypto key '${key.id}' has expired.`), { code: 'EVENT_CRYPTO_KEY_EXPIRED' });
    return key;
  }
  snapshot() { return Object.freeze({ primaryKeyId: this.primaryKeyId, keys: [...this.keys.values()].map(({ secret, ...value }) => ({ ...value, bytes: secret.length })) }); }
  close() { for (const key of this.keys.values()) key.secret.fill(0); this.keys.clear(); }
}
export default NodeEventCrypto;
