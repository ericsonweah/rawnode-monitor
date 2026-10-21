'use strict';

import MemoryTransport from '../transports/MemoryTransport.js';
import { createLogger } from '../core/LoggerRuntime.js';
import SafeSerializer from '../serialization/SafeSerializer.js';

export class LoggerRecorder {
  constructor(options = {}) {
    this.serializer = options.serializer || new SafeSerializer({ deterministic: true });
    this.transport = options.transport || new MemoryTransport({ serializer: this.serializer, maxItems: options.maxItems || 10_000 });
    this.logger = options.logger || createLogger({
      profile: 'test',
      level: options.level || 'important',
      serializer: this.serializer,
      transports: [this.transport],
      clock: options.clock,
      idFactory: options.idFactory,
    });
  }

  records() { return this.transport.all(); }
  latest(count = 1) { return this.transport.latest(count); }
  clear() { return this.transport.clear(); }
  async flush() { await this.logger.flush(); return this.records(); }
  async close() { await this.logger.close(); }

  assertCount(expected) {
    const actual = this.records().length;
    if (actual !== expected) throw new Error(`Expected ${expected} log records, received ${actual}.`);
    return this;
  }

  assertLogged(level, matcher = null) {
    const records = this.transport.atLevel(level);
    const found = matcher == null ? records.length > 0 : records.some((record) => {
      if (matcher instanceof RegExp) return matcher.test(record.message);
      if (typeof matcher === 'function') return matcher(record);
      return record.message.includes(String(matcher));
    });
    if (!found) throw new Error(`Expected a [${level}] log record matching ${String(matcher)}.`);
    return this;
  }

  assertNotLogged(level, matcher = null) {
    try { this.assertLogged(level, matcher); }
    catch { return this; }
    throw new Error(`Did not expect a [${level}] log record matching ${String(matcher)}.`);
  }
}

export function createLoggerHarness(options = {}) {
  return new LoggerRecorder(options);
}

export default LoggerRecorder;
