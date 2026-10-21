'use strict';

// src/events/EventRegistry.js
// Lightweight provider-facing registry. Ascending priority remains the default
// because that is the historical EventRegistry contract; use priorityOrder:'desc'
// to align it with AdvancedEventDispatcher execution.

export class EventRegistry {
  constructor(options = {}) {
    this.map = new Map();
    this.priorityOrder = options.priorityOrder === 'desc' ? 'desc' : 'asc';
    this._sequence = 0;
    this._owners = new Map();
  }

  listen(eventName, handler, priority = 10, options = {}) {
    const name = String(eventName);
    const entry = {
      id: ++this._sequence,
      handler,
      priority: Number(priority) || 0,
      owner: options.owner == null ? null : String(options.owner),
      tags: Array.isArray(options.tags) ? options.tags.map(String) : [],
    };
    const entries = this.map.get(name) || [];
    entries.push(entry);
    entries.sort((left, right) => {
      const priorityOrder = this.priorityOrder === 'desc'
        ? right.priority - left.priority
        : left.priority - right.priority;
      return priorityOrder || left.id - right.id;
    });
    this.map.set(name, entries);
    if (entry.owner) {
      let ids = this._owners.get(entry.owner);
      if (!ids) this._owners.set(entry.owner, ids = new Set());
      ids.add(entry.id);
    }
    // Historical EventRegistry.listen() returned undefined. Keep that exact
    // contract; use add()/subscribe() for fluent or disposable registration.
    return undefined;
  }

  add(eventName, handler, priority = 10, options = {}) {
    this.listen(eventName, handler, priority, options);
    return this;
  }

  subscribe(eventName, handler, priority = 10, options = {}) {
    this.listen(eventName, handler, priority, options);
    const id = this._sequence;
    return Object.freeze({
      id,
      dispose: () => this.removeById(id),
      off: () => this.removeById(id),
      [Symbol.dispose]: () => this.removeById(id),
    });
  }

  getListeners(eventName) { return this.map.get(String(eventName)) || []; }
  has(eventName) { return this.getListeners(eventName).length > 0; }
  eventNames() { return Array.from(this.map.keys()); }

  removeById(id) {
    for (const [eventName, entries] of this.map) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index === -1) continue;
      const [entry] = entries.splice(index, 1);
      if (!entries.length) this.map.delete(eventName);
      if (entry.owner) {
        const ids = this._owners.get(entry.owner);
        ids?.delete(entry.id);
        if (ids?.size === 0) this._owners.delete(entry.owner);
      }
      return true;
    }
    return false;
  }

  removeOwner(owner) {
    const ids = Array.from(this._owners.get(String(owner)) || []);
    let removed = 0;
    for (const id of ids) if (this.removeById(id)) removed++;
    return removed;
  }

  clear(eventName = null) {
    if (eventName == null) {
      const count = Array.from(this.map.values()).reduce((sum, entries) => sum + entries.length, 0);
      this.map.clear();
      this._owners.clear();
      return count;
    }
    const entries = this.map.get(String(eventName)) || [];
    for (const entry of entries) {
      const ids = entry.owner ? this._owners.get(entry.owner) : null;
      ids?.delete(entry.id);
      if (ids?.size === 0) this._owners.delete(entry.owner);
    }
    this.map.delete(String(eventName));
    return entries.length;
  }

  registerSubscriber(SubscriberClass, options = {}) {
    const subscribed = SubscriberClass?.getSubscribedEvents?.();
    if (!subscribed) return undefined;
    const defaultPriority = Number(SubscriberClass.priority ?? options.priority ?? 10) || 0;

    for (const [eventName, definition] of Object.entries(subscribed)) {
      if (typeof definition === 'string') {
        this.listen(eventName, { subscriber: SubscriberClass, method: definition }, defaultPriority, options);
        continue;
      }
      if (Array.isArray(definition)) {
        const [method, priority = defaultPriority] = definition;
        this.listen(eventName, { subscriber: SubscriberClass, method }, priority, options);
        continue;
      }
      if (definition && typeof definition === 'object') {
        this.listen(
          eventName,
          { subscriber: SubscriberClass, method: definition.method || definition.handle },
          definition.priority ?? defaultPriority,
          { ...options, owner: definition.owner ?? options.owner, tags: definition.tags ?? options.tags },
        );
      }
    }
    return undefined;
  }

  subscriber(SubscriberClass, options = {}) {
    this.registerSubscriber(SubscriberClass, options);
    return this;
  }

  manifest() {
    const output = [];
    for (const [eventName, entries] of this.map) {
      for (const entry of entries) output.push({ eventName, ...entry });
    }
    return output;
  }
}

export default EventRegistry;
