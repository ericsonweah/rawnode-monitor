'use strict';

import { cloneSafe, deepFreeze } from '../universal/support/safe.js';

export class DomEventTargetAdapter {
  constructor(fabric, target = null, options = {}) { this.fabric = fabric; this.defaultTarget = target || globalThis.document || null; this.maxSnapshotBytes = Math.max(1, Number(options.maxSnapshotBytes) || 64 * 1024); this.listeners = new Set(); }
  target(target = this.defaultTarget) { return new BoundDomEventTarget(this, target); }
  listen(type, options, listener = null) { if (typeof options === 'function') { listener = options; options = {}; } return this._listen(this.defaultTarget, type, options || {}, listener); }
  _listen(target, type, options, listener) {
    if (!target?.addEventListener) throw new TypeError('DOM EventTarget is unavailable.');
    if (typeof listener !== 'function') throw new TypeError('DOM event listener must be a function.');
    const name = String(type);
    const controller = new AbortController();
    const signal = linkSignal(options.signal, controller);
    const record = { target, name, controller, options, listener: null };
    const handler = (nativeEvent) => {
      const matched = options.selector ? delegatedTarget(nativeEvent, target, options.selector) : nativeEvent.target || target;
      if (!matched) return;
      if (options.prevent === true || options.preventDefault === true) nativeEvent.preventDefault?.();
      if (options.stop === true || options.stopPropagation === true) nativeEvent.stopPropagation?.();
      if (options.stopImmediate === true) nativeEvent.stopImmediatePropagation?.();
      const snapshot = snapshotDomEvent(nativeEvent, matched, options);
      const context = Object.freeze({ nativeEvent, target: matched, currentTarget: target, snapshot, signal: controller.signal, fabric: this.fabric });
      const value = listener(context);
      if (options.eventName) {
        const semantic = typeof options.map === 'function' ? options.map(context) : options.payload !== undefined ? options.payload : snapshot;
        if (options.publish === true) void this.fabric.event(options.eventName).payload(semantic).meta({ source: 'dom', domType: name }).publish({ ...(options.publishOptions || {}), localEcho: options.localEcho === true });
        else this.fabric.dispatch(options.eventName, semantic);
      }
      return value;
    };
    record.listener = handler;
    target.addEventListener(name, handler, { capture: options.capture === true, passive: options.passive === true, once: options.once === true, signal: controller.signal });
    const dispose = () => { if (!this.listeners.delete(record)) return false; controller.abort('dom-listener-disposed'); try { target.removeEventListener(name, handler, { capture: options.capture === true }); } catch {} return true; };
    record.dispose = dispose; this.listeners.add(record);
    return Object.freeze({ dispose, unsubscribe: dispose, target, type: name, signal: controller.signal, [Symbol.dispose]: dispose });
  }
  close() { for (const record of [...this.listeners]) record.dispose(); this.listeners.clear(); }
  snapshot() { return deepFreeze({ listeners: this.listeners.size, entries: [...this.listeners].map((entry) => ({ type: entry.name, selector: entry.options.selector || null, capture: entry.options.capture === true, passive: entry.options.passive === true, semanticEvent: entry.options.eventName || null })) }); }
}

export class BoundDomEventTarget {
  constructor(adapter, target) { this.adapter = adapter; this.value = target; }
  listen(type, options, listener = null) { if (typeof options === 'function') return this.adapter._listen(this.value, type, {}, options); return this.adapter._listen(this.value, type, options || {}, listener); }
  on(type, listener, options = {}) { return this.adapter._listen(this.value, type, options, listener); }
  once(type, listener, options = {}) { return this.adapter._listen(this.value, type, { ...options, once: true }, listener); }
}

export function snapshotDomEvent(event, target = event?.target, options = {}) {
  const allowedData = Array.isArray(options.dataAttributes) ? options.dataAttributes : [];
  const detail = event?.detail == null ? null : cloneSafe(event.detail, { maxDepth: 6, maxKeys: 256, maxArrayItems: 64, maxStringBytes: 4_096 });
  const output = {
    type: String(event?.type || ''),
    timeStamp: Number(event?.timeStamp) || Date.now(),
    bubbles: event?.bubbles === true,
    cancelable: event?.cancelable === true,
    composed: event?.composed === true,
    defaultPrevented: event?.defaultPrevented === true,
    key: event?.key || null,
    code: event?.code || null,
    repeat: event?.repeat === true,
    button: Number.isFinite(event?.button) ? event.button : null,
    buttons: Number.isFinite(event?.buttons) ? event.buttons : null,
    clientX: Number.isFinite(event?.clientX) ? event.clientX : null,
    clientY: Number.isFinite(event?.clientY) ? event.clientY : null,
    pointerType: event?.pointerType || null,
    modifiers: { alt: event?.altKey === true, ctrl: event?.ctrlKey === true, meta: event?.metaKey === true, shift: event?.shiftKey === true },
    target: target ? { id: target.id || null, name: target.getAttribute?.('name') || null, tag: target.tagName?.toLowerCase?.() || null, role: target.getAttribute?.('role') || null, type: target.getAttribute?.('type') || null, value: options.includeValue === true ? safeValue(target.value) : undefined, checked: typeof target.checked === 'boolean' ? target.checked : undefined, data: Object.fromEntries(allowedData.map((key) => [key, target.dataset?.[key]]).filter(([, value]) => value !== undefined)) } : null,
    detail,
  };
  return deepFreeze(output);
}
function delegatedTarget(event, root, selector) { for (const node of event.composedPath?.() || []) if (node?.matches?.(selector) && (node === root || root?.contains?.(node) || root === globalThis.document || root === globalThis.window)) return node; return event.target?.closest?.(selector) || null; }
function linkSignal(signal, controller) { if (!signal) return controller.signal; if (signal.aborted) controller.abort(signal.reason); else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true }); return controller.signal; }
function safeValue(value) { if (value == null) return value; const text = String(value); return text.length > 4_096 ? `${text.slice(0, 4_093)}...` : text; }
export default DomEventTargetAdapter;
