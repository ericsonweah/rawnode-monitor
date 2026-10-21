'use strict';

const TRANSITIONS = Object.freeze({
  idle: new Set(['disabled', 'starting', 'closed']),
  disabled: new Set(['starting', 'closed']),
  starting: new Set(['ready', 'failed', 'stopping']),
  ready: new Set(['degraded', 'stopping', 'failed']),
  degraded: new Set(['ready', 'stopping', 'failed']),
  failed: new Set(['starting', 'stopping', 'closed']),
  stopping: new Set(['stopped', 'failed']),
  stopped: new Set(['starting', 'closed']),
  closed: new Set(),
});

export class BridgeStateMachine {
  constructor() { this.state = 'idle'; this.changedAt = Date.now(); this.lastError = null; }

  transition(next, error = null) {
    if (next === this.state) return this.state;
    if (!TRANSITIONS[this.state]?.has(next)) throw new Error(`Invalid bridge state transition: ${this.state} -> ${next}`);
    this.state = next;
    this.changedAt = Date.now();
    if (error) this.lastError = error;
    return this.state;
  }

  snapshot() {
    return Object.freeze({
      state: this.state,
      changedAt: this.changedAt,
      lastError: this.lastError ? { name: this.lastError.name, message: this.lastError.message, code: this.lastError.code } : null,
    });
  }
}

export default BridgeStateMachine;
