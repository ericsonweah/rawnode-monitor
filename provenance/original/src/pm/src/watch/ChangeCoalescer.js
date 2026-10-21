'use strict';

export class ChangeCoalescer {
  constructor(callback, options = {}) {
    this.callback = callback;
    this.debounceMs = Math.max(10, Number(options.debounceMs) || 250);
    this.maxChanges = Math.max(10, Number(options.maxChanges) || 10_000);
    this.changes = new Map();
    this.timer = null;
  }

  add(file, event = 'change') {
    if (this.changes.size < this.maxChanges || this.changes.has(file)) {
      this.changes.set(file, { file, event, at: Date.now() });
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.changes.size) return;
    const values = Array.from(this.changes.values());
    this.changes.clear();
    await this.callback(values);
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.changes.clear();
  }
}

export default ChangeCoalescer;
