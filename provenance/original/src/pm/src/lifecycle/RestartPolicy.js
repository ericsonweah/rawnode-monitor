'use strict';

import { BackoffPolicy } from './BackoffPolicy.js';

export class RestartPolicy {
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled !== false,
      onCleanExit: options.onCleanExit === true,
      maxRestarts: Math.max(0, Number(options.maxRestarts) || 10),
      windowMs: Math.max(1_000, Number(options.windowMs) || 60_000),
      stableMs: Math.max(0, Number(options.stableMs) || 30_000),
    };
    this.backoff = new BackoffPolicy(options);
    this.restartTimes = [];
    this.attempt = 0;
    this.lastStableAt = 0;
  }

  prune(now = Date.now()) {
    const cutoff = now - this.options.windowMs;
    while (this.restartTimes.length && this.restartTimes[0] < cutoff) this.restartTimes.shift();
  }

  markStable(now = Date.now()) {
    this.attempt = 0;
    this.lastStableAt = now;
    this.prune(now);
  }

  noteRuntime(startedAt, now = Date.now()) {
    if (startedAt && now - startedAt >= this.options.stableMs) this.markStable(now);
  }

  decide({ expected = false, exitCode = null, signal = null, startedAt = 0 } = {}) {
    const now = Date.now();
    this.noteRuntime(startedAt, now);
    if (!this.options.enabled || expected) return { restart: false, reason: expected ? 'expected-exit' : 'restart-disabled' };
    if (exitCode === 0 && !signal && !this.options.onCleanExit) return { restart: false, reason: 'clean-exit' };

    this.prune(now);
    if (this.restartTimes.length >= this.options.maxRestarts) {
      return {
        restart: false,
        quarantine: true,
        reason: 'restart-window-exhausted',
        restarts: this.restartTimes.length,
        windowMs: this.options.windowMs,
      };
    }

    this.restartTimes.push(now);
    this.attempt++;
    return {
      restart: true,
      delayMs: this.backoff.delay(this.attempt),
      attempt: this.attempt,
      reason: 'unexpected-exit',
    };
  }

  snapshot() {
    this.prune();
    return {
      options: { ...this.options },
      attempt: this.attempt,
      restartTimes: this.restartTimes.slice(),
      lastStableAt: this.lastStableAt,
    };
  }
}

export default RestartPolicy;
