'use strict';

import { base64Decode, base64Encode, toUint8Array } from '../../universal/support/safe.js';

export class WebEventCrypto {
  constructor(options = {}) { this.keys = new Map(); this.primaryKeyId = options.primaryKeyId || null; for (const key of options.keys || []) this.addKey(key); if (options.secret) this.addKey({ id: options.keyId || 'events-primary', secret: options.secret, primary: true }); }
  addKey(input) { const id = String(input.id || input.keyId || input.kid || 'events-key'); const secret = input.secret ?? input.key; if (secret == null) throw new TypeError(`Event crypto key '${id}' requires secret.`); this.keys.set(id, { id, secret, algorithm: input.algorithm || 'hmac-sha256' }); if (input.primary === true || !this.primaryKeyId) this.primaryKeyId = id; return this; }
  async sign(bytes, options = {}) { const key = this._key(options.keyId); const cryptoKey = await importHmacKey(key.secret, ['sign']); const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, toUint8Array(bytes))); return { keyId: key.id, algorithm: 'hmac-sha256', signature: base64Encode(signature) }; }
  async verify(bytes, signature, options = {}) { try { const key = this._key(options.keyId); const cryptoKey = await importHmacKey(key.secret, ['verify']); return await crypto.subtle.verify('HMAC', cryptoKey, base64Decode(signature), toUint8Array(bytes)); } catch { return false; } }
  _key(id = null) { const key = this.keys.get(String(id || this.primaryKeyId)); if (!key) throw Object.assign(new Error(`Unknown event crypto key '${id || this.primaryKeyId}'.`), { code: 'EVENT_CRYPTO_KEY_UNKNOWN' }); return key; }
  snapshot() { return Object.freeze({ primaryKeyId: this.primaryKeyId, keys: [...this.keys.values()].map(({ secret, ...value }) => value) }); }
}
async function importHmacKey(secret, usages) { if (!globalThis.crypto?.subtle) throw Object.assign(new Error('Web Crypto is unavailable.'), { code: 'EVENT_WEB_CRYPTO_UNAVAILABLE' }); return crypto.subtle.importKey('raw', toUint8Array(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages); }
export default WebEventCrypto;
