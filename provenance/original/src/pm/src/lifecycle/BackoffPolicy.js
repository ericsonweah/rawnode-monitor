'use strict';

export class BackoffPolicy {
  constructor(options = {}) {
    this.minDelayMs = Math.max(0, Number(options.minDelayMs) || 100);
    this.maxDelayMs = Math.max(this.minDelayMs, Number(options.maxDelayMs) || 30_000);
    this.factor = Math.max(1, Number(options.factor) || 2);
    this.jitter = Math.max(0, Math.min(1, Number(options.jitter) || 0.2));
  }

  delay(attempt) {
    const power = Math.max(0, Number(attempt) - 1);
    const raw = Math.min(this.maxDelayMs, this.minDelayMs * (this.factor ** power));
    if (this.jitter <= 0) return Math.round(raw);
    const spread = raw * this.jitter;
    return Math.max(0, Math.round(raw - spread + Math.random() * spread * 2));
  }
}

export default BackoffPolicy;
