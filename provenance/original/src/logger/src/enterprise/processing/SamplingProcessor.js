'use strict';

export function createSamplingProcessor(options = {}) {
  const rate = Math.max(0, Math.min(1, Number(options.rate ?? 1)));
  const levels = options.levels ? new Set(options.levels.map(String)) : null;
  const random = options.random || Math.random;
  return function samplingProcessor(record) {
    if (levels && !levels.has(record.level)) return record;
    if (rate >= 1 || random() < rate) return record;
    return null;
  };
}

export default createSamplingProcessor;
