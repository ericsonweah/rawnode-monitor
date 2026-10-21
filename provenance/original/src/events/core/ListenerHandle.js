'use strict';

export class ListenerHandle {
  constructor(target, id) {
    this.target = target;
    this.dispatcher = target;
    this.id = Number(id);
  }

  _entry() {
    return this.target?.getEntry?.(this.id)
      || this.target?._registry?.getEntry?.(this.id)
      || null;
  }

  get active() { return this._entry()?.active === true; }
  get paused() { return this._entry()?.paused === true; }
  get metadata() {
    const entry = this._entry();
    if (!entry) return null;
    if (typeof this.target?.describeEntry === 'function') return this.target.describeEntry(entry);
    if (typeof this.target?._listenerMetadata === 'function') return this.target._listenerMetadata(this.id);
    return this.target?._registry?.describeEntry?.(entry) || null;
  }

  describe() { return this.metadata; }

  pause() {
    if (typeof this.target?.pause === 'function') this.target.pause(this.id);
    else if (typeof this.target?._setListenerPaused === 'function') this.target._setListenerPaused(this.id, true);
    else this.target?._registry?.pause?.(this.id);
    return this;
  }

  resume() {
    if (typeof this.target?.resume === 'function') this.target.resume(this.id);
    else if (typeof this.target?._setListenerPaused === 'function') this.target._setListenerPaused(this.id, false);
    else this.target?._registry?.resume?.(this.id);
    return this;
  }

  dispose() {
    if (typeof this.target?.removeById === 'function') return this.target.removeById(this.id) === true;
    if (typeof this.target?._disposeListenerById === 'function') return this.target._disposeListenerById(this.id) === true;
    return this.target?._registry?.removeById?.(this.id) === true;
  }

  unsubscribe() { return this.dispose(); }
  off() { return this.dispose(); }

  toJSON() {
    return Object.freeze({ id: this.id, active: this.active, paused: this.paused, ...(this.metadata || {}) });
  }

  [Symbol.dispose]() { this.dispose(); }
  async [Symbol.asyncDispose]() { this.dispose(); }
}

export default ListenerHandle;
