'use strict';

export class MetricHistory {
  constructor(options = {}) {
    this.limit = Math.max(1, Number(options.limit) || 720);
    this.items = new Array(this.limit);
    this.cursor = 0;
    this.length = 0;
  }

  push(snapshot) {
    this.items[this.cursor] = snapshot;
    this.cursor = (this.cursor + 1) % this.limit;
    this.length = Math.min(this.limit, this.length + 1);
    return snapshot;
  }

  all(options = {}) {
    const output = [];
    const start = (this.cursor - this.length + this.limit) % this.limit;
    for (let index = 0; index < this.length; index++) output.push(this.items[(start + index) % this.limit]);
    const since = Number(options.since || 0);
    const until = Number(options.until || Infinity);
    const filtered = output.filter((item) => Number(item?.timestamp || 0) >= since && Number(item?.timestamp || 0) <= until);
    return options.limit ? filtered.slice(-Math.max(1, Number(options.limit))) : filtered;
  }

  latest() { return this.length ? this.items[(this.cursor - 1 + this.limit) % this.limit] : null; }
  clear() { this.items.fill(undefined); this.cursor = 0; this.length = 0; }
  snapshot() { return Object.freeze({ limit: this.limit, length: this.length, oldest: this.all({ limit: this.length })[0]?.timestamp || null, latest: this.latest()?.timestamp || null }); }
}

export default MetricHistory;
