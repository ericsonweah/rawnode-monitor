'use strict';

import { EventEmitter } from 'node:events';
import { MonitorState } from '../constants.js';

const ALLOWED = Object.freeze({
  [MonitorState.IDLE]: new Set([MonitorState.STARTING, MonitorState.STOPPED]),
  [MonitorState.STARTING]: new Set([MonitorState.RUNNING, MonitorState.FAILED, MonitorState.STOPPING]),
  [MonitorState.RUNNING]: new Set([MonitorState.DRAINING, MonitorState.STOPPING, MonitorState.FAILED]),
  [MonitorState.DRAINING]: new Set([MonitorState.RUNNING, MonitorState.STOPPING, MonitorState.FAILED]),
  [MonitorState.STOPPING]: new Set([MonitorState.STOPPED, MonitorState.FAILED]),
  [MonitorState.STOPPED]: new Set([MonitorState.STARTING]),
  [MonitorState.FAILED]: new Set([MonitorState.STARTING, MonitorState.STOPPING, MonitorState.STOPPED]),
});

export class MonitorLifecycle extends EventEmitter {
  constructor() {
    super();
    this.state = MonitorState.IDLE;
    this.startedAt = 0;
    this.stoppedAt = 0;
    this.failure = null;
    this.transitions = [];
  }

  transition(next, meta = null) {
    if (next === this.state) return this.snapshot();
    if (!ALLOWED[this.state]?.has(next)) throw new Error(`Invalid Monitor lifecycle transition ${this.state} -> ${next}.`);
    const previous = this.state;
    this.state = next;
    const at = Date.now();
    if (next === MonitorState.RUNNING && !this.startedAt) this.startedAt = at;
    if (next === MonitorState.STOPPED) this.stoppedAt = at;
    if (next === MonitorState.FAILED) this.failure = meta?.error || meta || null;
    this.transitions.push(Object.freeze({ previous, next, at, meta }));
    if (this.transitions.length > 128) this.transitions.shift();
    this.emit('transition', { previous, next, at, meta });
    this.emit(next, { previous, at, meta });
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      state: this.state,
      startedAt: this.startedAt || null,
      stoppedAt: this.stoppedAt || null,
      uptimeMs: this.startedAt ? Math.max(0, Date.now() - this.startedAt) : 0,
      failure: this.failure ? { name: this.failure.name, code: this.failure.code, message: this.failure.message || String(this.failure) } : null,
      transitions: Object.freeze(this.transitions.slice()),
    });
  }
}

export default MonitorLifecycle;
