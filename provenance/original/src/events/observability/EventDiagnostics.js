'use strict';

import { EventEmitter } from 'node:events';
import { channel as diagnosticsChannel } from 'node:diagnostics_channel';
import { RingBuffer } from '../history/RingBuffer.js';
import { EventRedactor } from './EventRedactor.js';
import { estimateValueBytes } from '../support/size.js';

/**
 * Isolated diagnostics surface. It never re-enters the application event bus,
 * keeps bounded redacted history, and can publish to node:diagnostics_channel.
 */
export class EventDiagnostics extends EventEmitter {
  constructor(options = {}) {
    super({ captureRejections: true });
    this.setMaxListeners(Math.max(0, Number(options.maxListeners) || 0));
    this.enabled = options.enabled === true;
    this.historyLimit = Math.max(0, Number(options.historyLimit) || 0);
    this.maxHistoryBytes = Math.max(0, Number(options.maxHistoryBytes) || 0);
    this.historyBuffer = this.historyLimit ? new RingBuffer(this.historyLimit) : null;
    this.historyBytes = 0;
    this.redactor = options.redactor instanceof EventRedactor
      ? options.redactor
      : new EventRedactor(options.redaction || {});
    this.channelName = options.channel || 'rawnode.events.diagnostics';
    this.channel = diagnosticsChannel(this.channelName);
    this.publishChannel = options.publishChannel !== false;
    this.stats = { emitted: 0, listenerErrors: 0, channelPublishes: 0, historyEvictions: 0 };
  }

  active(name = null) {
    if (this.enabled || this.channel.hasSubscribers) return true;
    if (name != null && this.listenerCount(String(name)) > 0) return true;
    // EventEmitter maintains this count in O(1). Avoid allocating eventNames()
    // on every dispatcher hot-path probe.
    return this.listenerCount('*') > 0 || this._eventsCount > 0;
  }

  emit(name, payload) {
    const eventName = String(name);
    const active = this.active(eventName);
    if (!active) return false;

    const safePayload = this.redactor.redact(payload);
    const record = Object.freeze({ name: eventName, timestamp: Date.now(), payload: safePayload });
    this.stats.emitted++;
    this._record(record);

    if (this.publishChannel && this.channel.hasSubscribers) {
      try { this.channel.publish(record); this.stats.channelPublishes++; }
      catch { this.stats.listenerErrors++; }
    }

    let emitted = false;
    try {
      // Diagnostic event names may legitimately be "error"; unlike a regular
      // EventEmitter error channel, an absent listener must not throw.
      if (eventName !== 'error' || this.listenerCount('error') > 0) emitted = super.emit(eventName, safePayload) || emitted;
      if (eventName !== '*') emitted = super.emit('*', eventName, safePayload) || emitted;
    } catch {
      this.stats.listenerErrors++;
    }
    return emitted;
  }

  _record(record) {
    if (!this.historyBuffer) return;
    const bytes = estimateValueBytes(record, { maximum: this.maxHistoryBytes ? this.maxHistoryBytes + 1 : Infinity });
    if (this.maxHistoryBytes && bytes > this.maxHistoryBytes) return;
    const evicted = this.historyBuffer.push({ ...record, bytes });
    this.historyBytes += bytes;
    if (evicted) { this.historyBytes = Math.max(0, this.historyBytes - (evicted.bytes || 0)); this.stats.historyEvictions++; }
    while (this.maxHistoryBytes && this.historyBytes > this.maxHistoryBytes && this.historyBuffer.length) {
      const removed = this.historyBuffer.shift();
      this.historyBytes = Math.max(0, this.historyBytes - (removed?.bytes || 0));
      this.stats.historyEvictions++;
    }
  }

  history(options = {}) {
    let records = this.historyBuffer?.toArray() || [];
    if (options.name) records = records.filter((record) => record.name === String(options.name));
    const limit = Math.max(0, Number(options.limit) || 0);
    if (limit) records = records.slice(-limit);
    return records.map(({ bytes, ...record }) => record);
  }

  clearHistory() { this.historyBuffer?.clear(); this.historyBytes = 0; return this; }

  snapshot() {
    return Object.freeze({
      enabled: this.enabled,
      channel: this.channelName,
      historyEntries: this.historyBuffer?.length || 0,
      historyBytes: this.historyBytes,
      listenerCount: this.eventNames().reduce((total, name) => total + this.listenerCount(name), 0),
      stats: Object.freeze({ ...this.stats }),
    });
  }

  close() {
    this.removeAllListeners();
    this.clearHistory();
  }
}

export default EventDiagnostics;
