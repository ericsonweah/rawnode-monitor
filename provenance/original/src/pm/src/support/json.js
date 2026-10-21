'use strict';

export function safeStringify(value, space = undefined) {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return `${item}n`;
    if (item instanceof Error) {
      return {
        name: item.name,
        code: item.code || null,
        message: item.message,
        status: item.status || null,
      };
    }
    if (item && typeof item === 'object') {
      if (seen.has(item)) return '[circular]';
      seen.add(item);
    }
    return item;
  }, space);
}

export function safeJsonLine(value) {
  return `${safeStringify(value)}\n`;
}
