'use strict';

import { compileMatcherList, matchesAny } from '../support/glob.js';
import { estimateValueBytes } from '../support/size.js';
import { EventAdmissionError } from '../errors/EventError.js';

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export class EventSecurityPolicy {
  constructor(options = {}) {
    this.strictNames = options.strictNames === true;
    this.maxEventNameBytes = Math.max(0, Number(options.maxEventNameBytes) || 0);
    this.maxSegments = Math.max(0, Number(options.maxSegments) || 0);
    this.maxPatternBytes = Math.max(0, Number(options.maxPatternBytes) || 0);
    this.maxDispatchPayloadBytes = Math.max(0, Number(options.maxDispatchPayloadBytes) || 0);
    this.maxContextBytes = Math.max(0, Number(options.maxContextBytes) || 0);
    this.blockControlChars = options.blockControlChars === true;
    this.allow = compileMatcherList(options.namespaceAllow || options.allow);
    this.deny = compileMatcherList(options.namespaceDeny || options.deny);
    this.nameValidationActive = this.strictNames || this.blockControlChars || this.maxEventNameBytes > 0 || this.maxSegments > 0 || this.allow.length > 0 || this.deny.length > 0;
    this.dispatchValidationActive = this.nameValidationActive || this.maxDispatchPayloadBytes > 0 || this.maxContextBytes > 0;
  }

  validateName(name, options = {}) {
    if (!this.nameValidationActive) return true;
    if (typeof name !== 'string' || !name) {
      throw new EventAdmissionError('Event name must be a non-empty string', { code: 'EVENT_NAME_INVALID' });
    }
    if (this.blockControlChars && CONTROL.test(name)) {
      throw new EventAdmissionError('Event name contains control characters', { code: 'EVENT_NAME_CONTROL_CHARS' });
    }
    const bytes = Buffer.byteLength(name);
    const maximum = options.pattern ? this.maxPatternBytes || this.maxEventNameBytes : this.maxEventNameBytes;
    if (maximum && bytes > maximum) {
      throw new EventAdmissionError(`Event ${options.pattern ? 'pattern' : 'name'} exceeds ${maximum} bytes`, {
        code: options.pattern ? 'EVENT_PATTERN_MAX_BYTES' : 'EVENT_NAME_MAX_BYTES',
        details: { bytes, maximum },
      });
    }
    const segments = name.split(':').length;
    if (this.maxSegments && segments > this.maxSegments) {
      throw new EventAdmissionError(`Event name exceeds ${this.maxSegments} segments`, {
        code: 'EVENT_NAME_MAX_SEGMENTS',
        details: { segments, maximum: this.maxSegments },
      });
    }
    if (this.allow.length && !matchesAny(this.allow, name)) {
      throw new EventAdmissionError(`Event name is outside the allowed namespaces: ${name}`, { code: 'EVENT_NAMESPACE_NOT_ALLOWED' });
    }
    if (this.deny.length && matchesAny(this.deny, name)) {
      throw new EventAdmissionError(`Event namespace is denied: ${name}`, { code: 'EVENT_NAMESPACE_DENIED' });
    }
    return true;
  }

  validatePattern(pattern) {
    return this.validateName(pattern, { pattern: true });
  }

  validateDispatch(eventName, args, context = null, options = {}) {
    if (!this.dispatchValidationActive) return true;
    if (options.skipName !== true) this.validateName(eventName);
    if (this.maxDispatchPayloadBytes) {
      const bytes = estimateValueBytes(args, { maximum: this.maxDispatchPayloadBytes + 1 });
      if (bytes > this.maxDispatchPayloadBytes) {
        throw new EventAdmissionError(`Event payload exceeds ${this.maxDispatchPayloadBytes} bytes`, {
          code: 'EVENT_PAYLOAD_MAX_BYTES',
          details: { eventName, bytes, maximum: this.maxDispatchPayloadBytes },
        });
      }
    }
    if (this.maxContextBytes && context) {
      const bytes = estimateValueBytes(context, { maximum: this.maxContextBytes + 1 });
      if (bytes > this.maxContextBytes) {
        throw new EventAdmissionError(`Event context exceeds ${this.maxContextBytes} bytes`, {
          code: 'EVENT_CONTEXT_MAX_BYTES',
          details: { eventName, bytes, maximum: this.maxContextBytes },
        });
      }
    }
    return true;
  }

  snapshot() {
    return Object.freeze({
      maxEventNameBytes: this.maxEventNameBytes,
      strictNames: this.strictNames,
      maxSegments: this.maxSegments,
      maxPatternBytes: this.maxPatternBytes,
      maxDispatchPayloadBytes: this.maxDispatchPayloadBytes,
      maxContextBytes: this.maxContextBytes,
      blockControlChars: this.blockControlChars,
      allow: Object.freeze(this.allow.map((matcher) => matcher.raw)),
      deny: Object.freeze(this.deny.map((matcher) => matcher.raw)),
    });
  }
}

export default EventSecurityPolicy;
