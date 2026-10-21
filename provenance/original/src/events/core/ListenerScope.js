'use strict';

export class ListenerScope {
  constructor(dispatcher, owner) {
    this.dispatcher = dispatcher;
    this.owner = String(owner || `scope:${Date.now()}`);
    this.handles = new Set();
    this.closed = false;
  }

  _track(handle) {
    if (handle) this.handles.add(handle);
    return handle;
  }

  subscribe(eventName, listener, options = {}) { return this._track(this.dispatcher.subscribe(eventName, listener, { ...options, owner: options.owner || this.owner })); }
  on(eventName, listener, options = {}) { this.subscribe(eventName, listener, options); return this; }
  once(eventName, listener, options = {}) { this.subscribe(eventName, listener, { ...options, once: true }); return this; }
  pattern(pattern, listener, options = {}) { return this._track(this.dispatcher.subscribePattern(pattern, listener, { ...options, owner: options.owner || this.owner })); }
  onPattern(pattern, listener, options = {}) { this.pattern(pattern, listener, options); return this; }
  any(listener, options = {}) { return this._track(this.dispatcher.subscribeAny(listener, { ...options, owner: options.owner || this.owner })); }
  onAny(listener, options = {}) { this.any(listener, options); return this; }

  pause() { for (const handle of this.handles) handle.pause(); return this; }
  resume() { for (const handle of this.handles) handle.resume(); return this; }

  dispose() {
    if (this.closed) return 0;
    this.closed = true;
    let removed = 0;
    for (const handle of this.handles) if (handle.dispose()) removed++;
    this.handles.clear();
    return removed;
  }

  [Symbol.dispose]() { this.dispose(); }
  async [Symbol.asyncDispose]() { this.dispose(); }
}

export default ListenerScope;
