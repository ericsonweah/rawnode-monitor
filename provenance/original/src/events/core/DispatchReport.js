'use strict';

export class DispatchReport {
  constructor(eventName, options = {}) {
    this.eventName = eventName;
    this.mode = options.mode || 'sequential';
    this.startedAt = options.startedAt || Date.now();
    this.completedAt = null;
    this.durationMs = 0;
    this.matched = 0;
    this.invoked = 0;
    this.skipped = 0;
    this.results = [];
    this.errors = [];
    this.aborted = false;
    this.timedOut = false;
    this.stopped = false;
    this.stopValue = undefined;
    this.context = options.context || null;
  }

  complete(durationMs) {
    this.durationMs = Number(durationMs) || 0;
    this.completedAt = Date.now();
    return this;
  }

  finish(durationMs) { return this.complete(durationMs); }

  get ok() { return this.errors.length === 0 && !this.aborted && !this.timedOut; }
  get errorCount() { return this.errors.length; }

  toJSON() {
    return {
      eventName: this.eventName,
      mode: this.mode,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      durationMs: this.durationMs,
      matched: this.matched,
      invoked: this.invoked,
      skipped: this.skipped,
      results: this.results,
      errors: this.errors,
      aborted: this.aborted,
      timedOut: this.timedOut,
      stopped: this.stopped,
      stopValue: this.stopValue,
      context: this.context,
      ok: this.ok,
    };
  }
}

export default DispatchReport;
