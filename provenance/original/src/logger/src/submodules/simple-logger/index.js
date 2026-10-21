'use strict';

import EventEmitter from '../EventEmitter/index.js';
import LoggerRuntime from '../../enterprise/core/LoggerRuntime.js';
import LoggerBuilder from '../builder/LoggerBuilder.js';

function simpleView(record) {
  return {
    timestamp: record.timestamp,
    level: record.level,
    message: record.message,
    formatted: `[${record.timestamp}] [${String(record.level).toUpperCase()}] ${record.message}`,
    data: record.data,
  };
}

class SimpleLogger extends EventEmitter {
  constructor({ level = 'info', transports = [], ...options } = {}, ...args) {
    super({ level: 'info', transports: [] }, ...args);
    Object.assign(this, ...args);
    this.transports = Array.isArray(transports) ? transports : [];
    this.runtime = new LoggerRuntime({
      ...options,
      profile: options.profile || 'v1',
      level,
      transports: this.transports,
      transportPayload: 'object',
      compatibilityViewFactory: simpleView,
    });
    this._level = this.runtime.level;
    this.runtime.on('record', (record) => {
      try { this.emit('record', record); } catch {}
      try { this.emit('log', record.level, record.message, record); } catch {}
    });
  }

  static create() { return new LoggerBuilder(); }

  get level() { return this.runtime?.level || this._level || 'info'; }
  set level(value) { this._level = String(value || 'info'); if (this.runtime) this.runtime.setLevel(this._level); }

  log(level, message, data = null, options = {}) { return this.runtime.log(level, message, data, options); }
  logAsync(level, message, data = null, options = {}) { return this.runtime.logAsync(level, message, data, options); }
  emergency(message, data, options) { return this.log('emergency', message, data, options); }
  alert(message, data, options) { return this.log('alert', message, data, options); }
  critical(message, data, options) { return this.log('critical', message, data, options); }
  error(message, data, options) { return this.log('error', message, data, options); }
  urgent(message, data, options) { return this.log('urgent', message, data, options); }
  priority(message, data, options) { return this.log('priority', message, data, options); }
  warn(message, data, options) { return this.log('warn', message, data, options); }
  notice(message, data, options) { return this.log('notice', message, data, options); }
  success(message, data, options) { return this.log('success', message, data, options); }
  info(message, data, options) { return this.log('info', message, data, options); }
  debug(message, data, options) { return this.log('debug', message, data, options); }
  metric(message, data, options) { return this.log('metric', message, data, options); }
  metrics(message, data, options) { return this.log('metrics', message, data, options); }
  important(message, data, options) { return this.log('important', message, data, options); }

  addTransport(transport, options = {}) { this.transports.push(transport); this.runtime.addTransport(transport, options); return this; }
  removeTransport(value) { return this.runtime.removeTransport(value); }
  setLevel(level) { this.level = level; return this; }
  isLevelEnabled(level) { return this.runtime.isLevelEnabled(level); }
  use(processor, options) { this.runtime.use(processor, options); return this; }
  processor(processor, options) { return this.use(processor, options); }
  plugin(plugin) { this.runtime.plugin(plugin); return this; }
  child(context, options) { return this.runtime.child(context, options); }
  with(context) { return this.runtime.with(context); }
  channel(name) { return this.runtime.channel(name); }
  withError(error, context) { return this.runtime.withError(error, context); }
  when(condition) { return this.runtime.when(condition); }
  sample(rate) { return this.runtime.sample(rate); }
  once(key) { return this.runtime.once(key); }
  rateLimit(key, options) { return this.runtime.rateLimit(key, options); }
  at(level) { return this.runtime.at(level); }
  forRequest(req, extra) { return this.runtime.forRequest(req, extra); }
  forJob(job, extra) { return this.runtime.forJob(job, extra); }
  runWithContext(context, callback, ...args) { return this.runtime.runWithContext(context, callback, ...args); }
  time(label, context) { return this.runtime.time(label, context); }
  measure(label, operation, context, options) { return this.runtime.measure(label, operation, context, options); }
  health() { return this.runtime.health(); }
  stats() { return this.runtime.stats(); }
  metricsSnapshot() { return this.runtime.metricsSnapshot(); }
  diagnosticsSnapshot() { return this.runtime.diagnosticsSnapshot(); }
  levels() { return this.runtime.levels(); }
  prometheus(labels) { return this.runtime.prometheus(labels); }
  toPrometheus(labels) { return this.runtime.toPrometheus(labels); }
  flush() { return this.runtime.flush(); }
  close() { return this.runtime.close(); }
}

export default SimpleLogger;
