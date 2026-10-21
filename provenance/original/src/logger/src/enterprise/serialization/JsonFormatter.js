'use strict';

export class JsonFormatter {
  constructor(options = {}) {
    this.omit = new Set(options.omit || []);
    this.pick = Array.isArray(options.pick) ? new Set(options.pick) : null;
  }

  format(record, serializer) {
    let value = record;
    if (this.pick || this.omit.size) {
      value = Object.create(null);
      for (const [key, item] of Object.entries(record)) {
        if (this.pick && !this.pick.has(key)) continue;
        if (this.omit.has(key)) continue;
        value[key] = item;
      }
    }
    return serializer.stringify(value);
  }
}

export default JsonFormatter;
