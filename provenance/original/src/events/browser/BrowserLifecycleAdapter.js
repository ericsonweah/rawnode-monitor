'use strict';

import { safeError } from '../universal/support/safe.js';

export class BrowserLifecycleAdapter {
  constructor(fabric, options = {}) { this.fabric = fabric; this.window = options.window || globalThis.window || null; this.document = options.document || globalThis.document || null; this.captureErrors = options.captureErrors === true; this.listeners = []; this.started = false; }
  start() {
    if (this.started) return this; this.started = true;
    this._listen(this.window, 'online', () => this._emit('browser:online', { online: true }));
    this._listen(this.window, 'offline', () => this._emit('browser:offline', { online: false }));
    this._listen(this.window, 'focus', () => this._emit('browser:focus', {}));
    this._listen(this.window, 'blur', () => this._emit('browser:blur', {}));
    this._listen(this.window, 'pageshow', (event) => this._emit('browser:page:shown', { persisted: event.persisted === true }));
    this._listen(this.window, 'pagehide', (event) => this._emit('browser:page:hidden', { persisted: event.persisted === true }));
    this._listen(this.window, 'popstate', (event) => this._emit('browser:history:popstate', { state: event.state }));
    this._listen(this.window, 'hashchange', (event) => this._emit('browser:history:hashchange', { oldURL: event.oldURL, newURL: event.newURL }));
    this._listen(this.document, 'visibilitychange', () => this._emit(`browser:visibility:${this.document.visibilityState}`, { state: this.document.visibilityState, hidden: this.document.hidden === true }));
    if (this.captureErrors) {
      this._listen(this.window, 'error', (event) => this._emit('browser:error', { message: event.message || null, filename: event.filename || null, line: event.lineno || null, column: event.colno || null, error: safeError(event.error) }));
      this._listen(this.window, 'unhandledrejection', (event) => this._emit('browser:promise:unhandled', { reason: safeError(event.reason) }));
    }
    this._emit('browser:lifecycle:started', { online: globalThis.navigator?.onLine ?? null, visibility: this.document?.visibilityState || null });
    return this;
  }
  _listen(target, name, listener, options = {}) { if (!target?.addEventListener) return; target.addEventListener(name, listener, options); this.listeners.push([target, name, listener, options]); }
  _emit(name, payload) { try { this.fabric.dispatch(name, payload); } catch {} }
  close() { for (const [target, name, listener, options] of this.listeners.splice(0)) target.removeEventListener?.(name, listener, options); this.started = false; }
  snapshot() { return { started: this.started, listeners: this.listeners.length, captureErrors: this.captureErrors, online: globalThis.navigator?.onLine ?? null, visibility: this.document?.visibilityState || null }; }
}
export default BrowserLifecycleAdapter;
