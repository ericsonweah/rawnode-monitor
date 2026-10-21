'use strict';

// src/events/EventDispatcher.js

import { EventEmitter } from 'node:events';

export class EventDispatcher {
  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0);
  }

  // Historical return values are intentionally preserved (undefined).
  on(event, listener) { this.emitter.on(event, listener); }
  once(event, listener) { this.emitter.once(event, listener); }
  off(event, listener) { this.emitter.off(event, listener); }
  dispatch(event, ...args) { this.emitter.emit(event, ...args); }
  emit(event, ...args) { return this.dispatch(event, ...args); }

  subscribe(event, listener, options = {}) {
    if (options.once) this.emitter.once(event, listener);
    else this.emitter.on(event, listener);
    let active = true;
    const emitter = this.emitter;
    const dispose = () => {
      if (!active) return false;
      active = false;
      emitter.off(event, listener);
      return true;
    };
    return Object.freeze({ dispose, off: dispose, unsubscribe: dispose, [Symbol.dispose]: dispose });
  }

  listeners(event) { return this.emitter.listeners(event); }
  listenerCount(event) { return this.emitter.listenerCount(event); }
  eventNames() { return this.emitter.eventNames(); }
  removeAllListeners(event) { this.emitter.removeAllListeners(event); }
}

export default EventDispatcher;
