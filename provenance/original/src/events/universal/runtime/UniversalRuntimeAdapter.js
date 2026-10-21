'use strict';

import { byteLength, randomId, toUint8Array } from '../support/safe.js';

export class UniversalRuntimeAdapter {
  constructor(options = {}) {
    this.name = options.name || detectRuntimeName();
    this.id = options.id || randomId(this.name);
    this.clock = options.clock || null;
  }

  now() { return typeof this.clock?.now === 'function' ? Number(this.clock.now()) : Date.now(); }
  monotonicNow() { return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : this.now(); }
  randomId(prefix = 'evt') { return randomId(prefix); }
  byteLength(value) { return byteLength(value); }
  encode(value) { return toUint8Array(value); }
  decode(bytes) { return new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); }
  microtask(callback) { queueMicrotask(callback); }
  schedule(callback, options = {}) {
    const mode = options.mode || 'task';
    if (mode === 'animation' && typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(() => callback());
    if (mode === 'idle' && typeof globalThis.requestIdleCallback === 'function') return globalThis.requestIdleCallback(() => callback(), { timeout: options.timeoutMs || 100 });
    if (mode === 'microtask') { queueMicrotask(callback); return 0; }
    if (typeof globalThis.MessageChannel === 'function') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); callback(); };
      channel.port2.postMessage(0);
      return channel;
    }
    return setTimeout(callback, 0);
  }
  capabilities() {
    return Object.freeze({
      runtime: this.name,
      crypto: !!globalThis.crypto,
      webCrypto: !!globalThis.crypto?.subtle,
      eventTarget: typeof globalThis.EventTarget === 'function',
      broadcastChannel: typeof globalThis.BroadcastChannel === 'function',
      messageChannel: typeof globalThis.MessageChannel === 'function',
      serviceWorker: !!globalThis.navigator?.serviceWorker,
      dom: typeof globalThis.document !== 'undefined',
    });
  }
  snapshot() { return Object.freeze({ name: this.name, id: this.id, capabilities: this.capabilities() }); }
}

function detectRuntimeName() {
  if (typeof globalThis.window !== 'undefined' && globalThis.window === globalThis) return 'browser';
  if (typeof globalThis.WorkerGlobalScope !== 'undefined' && globalThis instanceof globalThis.WorkerGlobalScope) return 'worker';
  if (typeof globalThis.process !== 'undefined' && globalThis.process?.versions?.node) return 'node';
  return 'universal';
}

export default UniversalRuntimeAdapter;
