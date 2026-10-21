'use strict';

export function createDeduplicationProcessor(options = {}) {
  const windowMs = Math.max(0, Number(options.windowMs) || 1000);
  const maxEntries = Math.max(1, Number(options.maxEntries) || 10_000);
  const key = options.key || ((record) => `${record.level}:${record.channel}:${record.message}`);
  const seen = new Map();
  return function deduplicationProcessor(record) {
    const now = record.timeUnixMs || Date.now();
    const id = String(key(record));
    const previous = seen.get(id);
    seen.set(id, now);
    if (seen.size > maxEntries) {
      const oldest = seen.keys().next().value;
      seen.delete(oldest);
    }
    if (previous != null && now - previous < windowMs) return null;
    return record;
  };
}

export default createDeduplicationProcessor;
