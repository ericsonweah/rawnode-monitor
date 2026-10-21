'use strict';

import { EventConfigurationError, EventTransportError } from '../errors/EventError.js';
import { SafeJsonCodec } from './SafeJsonCodec.js';

export class EventCodecRegistry {
  constructor(options = {}) {
    this.codecs = new Map();
    this.defaultName = String(options.default || 'json');
    this.maxCodecs = Math.max(1, Number(options.maxCodecs) || 1000);
    this.frozen = false;
    this.register('json', options.jsonCodec || new SafeJsonCodec(options.json || {}));
    for (const [name, codec] of Object.entries(options.codecs || {})) this.register(name, codec, { replace: true });
  }

  register(name, codec, options = {}) {
    if (this.frozen) throw new EventConfigurationError('Event codec registry is frozen', { code: 'EVENT_CODEC_REGISTRY_FROZEN' });
    const key = String(name || '').trim().toLowerCase();
    if (!key) throw new TypeError('Codec name is required');
    if (!codec || typeof codec.encode !== 'function' || typeof codec.parse !== 'function') {
      throw new TypeError('Event codec must expose encode() and parse()');
    }
    if (this.codecs.has(key) && options.replace !== true) {
      throw new EventConfigurationError(`Event codec already exists: ${key}`, { code: 'EVENT_CODEC_DUPLICATE' });
    }
    if (!this.codecs.has(key) && this.codecs.size >= this.maxCodecs) {
      throw new EventConfigurationError('Event codec registry limit exceeded', { code: 'EVENT_CODEC_LIMIT' });
    }
    this.codecs.set(key, codec);
    return this;
  }

  unregister(name) {
    if (this.frozen) throw new EventConfigurationError('Event codec registry is frozen', { code: 'EVENT_CODEC_REGISTRY_FROZEN' });
    const key = String(name).toLowerCase();
    if (key === this.defaultName) throw new EventConfigurationError('Cannot remove the active default event codec');
    return this.codecs.delete(key);
  }

  has(name) { return this.codecs.has(String(name).toLowerCase()); }

  get(name = this.defaultName) {
    const key = String(name || this.defaultName).toLowerCase();
    const codec = this.codecs.get(key);
    if (!codec) throw new EventTransportError(`Unknown event codec: ${key}`, { code: 'EVENT_CODEC_UNKNOWN' });
    return codec;
  }

  use(name) { this.get(name); this.defaultName = String(name).toLowerCase(); return this; }
  encode(value, options = {}, name = this.defaultName) { return this.get(name).encode(value, options); }
  parse(value, options = {}, name = this.defaultName) { return this.get(name).parse(value, options); }
  freeze() { this.frozen = true; return this; }
  unfreeze() { this.frozen = false; return this; }
  names() { return Array.from(this.codecs.keys()); }
  snapshot() { return Object.freeze({ default: this.defaultName, frozen: this.frozen, codecs: Object.freeze(this.names()), limits: Object.freeze({ maxCodecs: this.maxCodecs }) }); }
}

export default EventCodecRegistry;
