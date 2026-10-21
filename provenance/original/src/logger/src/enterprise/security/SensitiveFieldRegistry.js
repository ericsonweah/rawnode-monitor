'use strict';

const DEFAULT_PATTERNS = Object.freeze([
  /pass(?:word|wd)?/i,
  /secret/i,
  /private[_-]?key/i,
  /api[_-]?key/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /auth(?:orization)?/i,
  /cookie/i,
  /session(?:id|_id|-id|key|secret)?/i,
  /credential/i,
  /client[_-]?secret/i,
  /signature/i,
  /pepper/i,
  /encryption[_-]?key/i,
  /jwt/i,
  /bearer/i,
  /card(?:number|_number|-number)?/i,
  /cvv|cvc/i,
]);

export class SensitiveFieldRegistry {
  constructor(options = {}) {
    this.patterns = [...DEFAULT_PATTERNS, ...(options.patterns || [])];
    this.keys = new Set((options.keys || []).map((key) => String(key).toLowerCase()));
  }

  add(patternOrKey) {
    if (patternOrKey instanceof RegExp) this.patterns.push(patternOrKey);
    else this.keys.add(String(patternOrKey).toLowerCase());
    return this;
  }

  has(key) {
    const value = String(key || '');
    if (this.keys.has(value.toLowerCase())) return true;
    return this.patterns.some((pattern) => pattern.test(value));
  }

  snapshot() {
    return { keys: [...this.keys], patterns: this.patterns.map(String) };
  }
}

export { DEFAULT_PATTERNS };
export default SensitiveFieldRegistry;
