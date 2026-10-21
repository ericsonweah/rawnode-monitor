'use strict';

import { UnifiedStateError } from '../errors/UnifiedError.js';

export const UNIFIED_STATE = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  LISTENING: 'listening',
  DRAINING: 'draining',
  CLOSING: 'closing',
  CLOSED: 'closed',
  FAILED: 'failed',
});

const TRANSITIONS = Object.freeze({
  [UNIFIED_STATE.IDLE]: new Set([UNIFIED_STATE.STARTING, UNIFIED_STATE.CLOSING, UNIFIED_STATE.CLOSED]),
  [UNIFIED_STATE.STARTING]: new Set([UNIFIED_STATE.LISTENING, UNIFIED_STATE.FAILED, UNIFIED_STATE.CLOSING]),
  [UNIFIED_STATE.LISTENING]: new Set([UNIFIED_STATE.DRAINING, UNIFIED_STATE.CLOSING, UNIFIED_STATE.FAILED]),
  [UNIFIED_STATE.DRAINING]: new Set([UNIFIED_STATE.CLOSING, UNIFIED_STATE.CLOSED, UNIFIED_STATE.FAILED]),
  [UNIFIED_STATE.CLOSING]: new Set([UNIFIED_STATE.CLOSED, UNIFIED_STATE.FAILED]),
  [UNIFIED_STATE.FAILED]: new Set([UNIFIED_STATE.STARTING, UNIFIED_STATE.CLOSING, UNIFIED_STATE.CLOSED]),
  [UNIFIED_STATE.CLOSED]: new Set(),
});

export class UnifiedStateMachine {
  constructor(initial = UNIFIED_STATE.IDLE, onTransition = null) {
    this.value = initial;
    this.sequence = 0;
    this.changedAt = Date.now();
    this.onTransition = typeof onTransition === 'function' ? onTransition : null;
  }

  can(next) {
    return next === this.value || TRANSITIONS[this.value]?.has(next) === true;
  }

  transition(next, details = null) {
    if (next === this.value) return this.snapshot();
    if (!this.can(next)) {
      throw new UnifiedStateError(`Invalid RawNode Unified lifecycle transition: ${this.value} -> ${next}`, {
        code: 'UNIFIED_INVALID_TRANSITION',
        details: { current: this.value, next },
      });
    }
    const previous = this.value;
    this.value = next;
    this.sequence++;
    this.changedAt = Date.now();
    const event = Object.freeze({ previous, current: next, sequence: this.sequence, changedAt: this.changedAt, details });
    this.onTransition?.(event);
    return event;
  }

  snapshot() {
    return Object.freeze({ state: this.value, sequence: this.sequence, changedAt: this.changedAt });
  }
}

export default UNIFIED_STATE;
