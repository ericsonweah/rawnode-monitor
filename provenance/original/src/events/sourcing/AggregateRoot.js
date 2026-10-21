'use strict';

/**
 * Minimal event-sourced aggregate base. Subclasses implement `apply<EventName>`
 * methods or override applyEvent(event, replaying).
 */
export class AggregateRoot {
  constructor(id = null) {
    this.id = id;
    this.version = 0;
    this._uncommittedEvents = [];
  }

  record(event) {
    if (!event || typeof event !== 'object') throw new TypeError('AggregateRoot.record expects an event object');
    this.applyEvent(event, false);
    this._uncommittedEvents.push(event);
    return this;
  }

  applyEvent(event, replaying = false) {
    const eventName = event.eventName || event.constructor?.eventName || event.constructor?.name || 'Event';
    const method = `apply${String(eventName).split(/[:.\-_/]+/).filter(Boolean).map(capitalize).join('')}`;
    if (typeof this[method] === 'function') this[method](event.payload ?? event, event);
    else if (typeof this.apply === 'function' && this.apply !== AggregateRoot.prototype.apply) this.apply(event, replaying);
    this.version++;
    return this;
  }

  loadFromHistory(events = []) {
    this._uncommittedEvents.length = 0;
    this.version = 0;
    for (const record of events) {
      const event = record?.eventObject || record?.event || record;
      this.applyEvent(event, true);
      if (record?.streamVersion != null) this.version = Number(record.streamVersion);
    }
    return this;
  }

  uncommittedEvents() { return this._uncommittedEvents.slice(); }
  hasUncommittedEvents() { return this._uncommittedEvents.length > 0; }
  markCommitted() { this._uncommittedEvents.length = 0; return this; }

  toSnapshot() {
    const state = {};
    for (const [key, value] of Object.entries(this)) {
      if (key === '_uncommittedEvents') continue;
      state[key] = clone(value);
    }
    return Object.freeze({ id: this.id, version: this.version, state });
  }

  restoreSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') throw new TypeError('Aggregate snapshot is required');
    Object.assign(this, clone(snapshot.state || {}));
    this.id = snapshot.id ?? this.id;
    this.version = Math.max(0, Number(snapshot.version) || 0);
    this._uncommittedEvents = [];
    return this;
  }
}

function capitalize(value) { return value ? value[0].toUpperCase() + value.slice(1) : ''; }
function clone(value) {
  try { return structuredClone(value); } catch {}
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value);
  const output = {};
  for (const [key, child] of Object.entries(value)) output[key] = clone(child);
  return output;
}

export default AggregateRoot;
