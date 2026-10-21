'use strict';

import { EventEmitter } from 'node:events';
import { PROCESS_STATES } from '../constants.js';
import { ProcessLifecycleError } from '../errors.js';

const TRANSITIONS = Object.freeze({
  defined: new Set(['starting', 'stopped']),
  starting: new Set(['online', 'ready', 'running', 'boot_failed', 'crashed', 'stopping']),
  online: new Set(['ready', 'running', 'unhealthy', 'draining', 'stopping', 'crashed']),
  ready: new Set(['running', 'unhealthy', 'draining', 'stopping', 'crashed']),
  running: new Set(['unhealthy', 'draining', 'stopping', 'crashed']),
  unhealthy: new Set(['running', 'draining', 'backoff', 'starting', 'stopping', 'crashed', 'quarantined']),
  draining: new Set(['stopping', 'stopped', 'crashed']),
  stopping: new Set(['stopped', 'crashed']),
  stopped: new Set(['starting']),
  crashed: new Set(['backoff', 'starting', 'quarantined', 'stopped']),
  backoff: new Set(['starting', 'quarantined', 'stopped']),
  boot_failed: new Set(['backoff', 'starting', 'quarantined', 'stopped']),
  quarantined: new Set(['starting', 'stopped']),
});

export class ProcessStateMachine extends EventEmitter {
  constructor(initial = 'defined', options = {}) {
    super();
    if (!PROCESS_STATES.includes(initial)) throw new ProcessLifecycleError(`Unknown process state '${initial}'.`);
    this.state = initial;
    this.changedAt = Date.now();
    this.historyLimit = Math.max(10, Number(options.historyLimit) || 100);
    this.history = [{ from: null, to: initial, at: this.changedAt, reason: 'initial' }];
  }

  can(next) {
    return next === this.state || TRANSITIONS[this.state]?.has(next) === true;
  }

  transition(next, meta = {}) {
    if (!PROCESS_STATES.includes(next)) throw new ProcessLifecycleError(`Unknown process state '${next}'.`);
    if (next === this.state) return this.state;
    if (!this.can(next) && meta.force !== true) {
      throw new ProcessLifecycleError(`Invalid process transition ${this.state} -> ${next}.`, {
        code: 'RNPM_INVALID_TRANSITION',
        details: { from: this.state, to: next, meta },
      });
    }
    const previous = this.state;
    this.state = next;
    this.changedAt = Date.now();
    const entry = { from: previous, to: next, at: this.changedAt, reason: meta.reason || null, details: meta.details || null };
    this.history.push(entry);
    if (this.history.length > this.historyLimit) this.history.splice(0, this.history.length - this.historyLimit);
    this.emit('transition', entry);
    this.emit(next, entry);
    return next;
  }

  snapshot() {
    return { state: this.state, changedAt: this.changedAt, history: this.history.slice() };
  }
}

export default ProcessStateMachine;
