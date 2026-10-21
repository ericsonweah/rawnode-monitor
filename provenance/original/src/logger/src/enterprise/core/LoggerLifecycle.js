'use strict';

const TRANSITIONS = Object.freeze({
  created: new Set(['initializing', 'ready', 'closing', 'closed']),
  initializing: new Set(['ready', 'degraded', 'closing']),
  ready: new Set(['degraded', 'draining', 'closing']),
  degraded: new Set(['ready', 'draining', 'closing']),
  draining: new Set(['ready', 'degraded', 'closing']),
  closing: new Set(['closed']),
  closed: new Set(),
});

export class LoggerLifecycle {
  constructor(options = {}) {
    this.state = 'created';
    this.changedAt = Date.now();
    this.history = [{ state: this.state, at: this.changedAt }];
    this.onChange = typeof options.onChange === 'function' ? options.onChange : null;
  }

  transition(next, details = null) {
    if (next === this.state) return this.state;
    if (!TRANSITIONS[this.state]?.has(next)) throw new Error(`Invalid logger lifecycle transition: ${this.state} -> ${next}`);
    const previous = this.state;
    this.state = next;
    this.changedAt = Date.now();
    this.history.push({ state: next, previous, at: this.changedAt, details });
    this.onChange?.(next, previous, details);
    return next;
  }

  is(...states) {
    return states.includes(this.state);
  }

  snapshot() {
    return { state: this.state, changedAt: this.changedAt, history: this.history.map((entry) => ({ ...entry })) };
  }
}

export default LoggerLifecycle;
