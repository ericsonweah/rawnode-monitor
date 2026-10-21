'use strict';

export class FakeClock {
  constructor(start = Date.parse('2026-01-01T00:00:00.000Z')) { this.now = Number(start); }
  tick(ms = 1) { this.now += Number(ms) || 0; return this.now; }
  set(value) { this.now = Number(value); return this.now; }
  callback() { return () => this.now; }
}

export default FakeClock;
