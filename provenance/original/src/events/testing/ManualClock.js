'use strict';

export class ManualClock {
  constructor(now = 0) { this.current = Number(now) || 0; }
  now = () => this.current;
  set(value) { this.current = Number(value) || 0; return this.current; }
  tick(ms = 1) { this.current += Number(ms) || 0; return this.current; }
  date() { return new Date(this.current); }
}

export default ManualClock;
