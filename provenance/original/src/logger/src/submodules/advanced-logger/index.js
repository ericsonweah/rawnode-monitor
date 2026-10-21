'use strict';

import Transformer from '../Transformer/index.js';
import formatLog from '../formatter/formatLog.js';
import buildLogEntry from '../formatter/buildLogEntry.js';
import colors from '../colors/index.js';
import LoggerRuntime from '../../enterprise/core/LoggerRuntime.js';
import { COMPATIBILITY_VIEW } from '../../enterprise/core/TransportAdapter.js';

const { rgb, green } = colors;
const endTimestamp = rgb(184, 197, 209);

const MUTATING_ARRAY_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'copyWithin', 'fill']);

function createTransportCollection(owner, initial = []) {
  const target = [...initial];
  return new Proxy(target, {
    get(array, property, receiver) {
      if (MUTATING_ARRAY_METHODS.has(property)) {
        return (...args) => {
          const result = Array.prototype[property].apply(array, args);
          owner._syncTransports?.();
          return result;
        };
      }
      return Reflect.get(array, property, receiver);
    },
    set(array, property, value, receiver) {
      const result = Reflect.set(array, property, value, receiver);
      owner._syncTransports?.();
      return result;
    },
    deleteProperty(array, property) {
      const result = Reflect.deleteProperty(array, property);
      owner._syncTransports?.();
      return result;
    },
  });
}

function safeDataText(value, serializer) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  return serializer.stringify(value);
}

/**
 * Backward-compatible AdvancedLogger facade powered by the enterprise runtime.
 * It remains a Transform stream and preserves the existing v1 methods, output
 * mode, middleware semantics, event name, level order, and transport list.
 */
class AdvancedLogger extends Transformer {
  constructor(options = {}) {
    super({ objectMode: true, autoDestroy: true });
    this.level = options.level || 'info';
    this._transportOptions = new Map();
    const initialTransports = [];
    for (const entry of Array.isArray(options.transports) ? options.transports : []) {
      const transport = entry?.transport || entry;
      if (!transport) continue;
      initialTransports.push(transport);
      if (entry?.transport) this._transportOptions.set(transport, { ...(entry.options || {}) });
    }
    this.transports = createTransportCollection(this, initialTransports);
    this.serialize = options.serialize || false;
    const profileName = typeof options.profile === 'string' ? options.profile : options.profile?.name || 'v1';
    this.mode = options.mode || (profileName === 'v1' ? 'json' : 'object');
    this.colors = options.colors ?? (profileName === 'v1');
    this._closing = false;

    const compatibilityViewFactory = async (record) => this._buildCompatibilityView(record);
    compatibilityViewFactory.shouldBuild = () => this._needsCompatibilityView();

    this.runtime = new LoggerRuntime({
      ...options,
      profile: options.profile || 'v1',
      level: this._level,
      transports: this.transports.map((transport) => ({ transport, options: this._transportOptions.get(transport) || {} })),
      transportPayload: this.mode === 'object' ? 'object' : 'json',
      compatibilityViewFactory,
    });

    this.runtime.on('record', (record) => {
      const compatibility = record[COMPATIBILITY_VIEW] || record;
      try { this.emit('record', record); } catch {}
      try { this.emit('log', compatibility); } catch {}
      if (this.readableFlowing || this.listenerCount('data') > 0 || this.listenerCount('readable') > 0) {
        const payload = this.mode === 'object' ? compatibility : this.runtime.serializer.stringify(compatibility);
        this.push(payload);
      }
    });
  }

  get level() { return this.runtime?.level || this._level || 'info'; }
  set level(value) {
    this._level = String(value || 'info');
    if (this.runtime) this.runtime.setLevel(this._level);
  }

  _syncTransports() {
    if (!this.runtime?.dispatcher) return;
    const desired = new Set(this.transports);
    for (const adapter of [...this.runtime.dispatcher.adapters]) {
      if (!desired.has(adapter.transport)) this.runtime.dispatcher.remove(adapter.transport);
    }
    for (const transport of desired) {
      if (!this.runtime.dispatcher.adapters.some((adapter) => adapter.transport === transport)) {
        this.runtime.addTransport(transport, this._transportOptions.get(transport) || {});
      }
    }
  }

  _needsCompatibilityView() {
    if (this.runtime?.profile?.name === 'v1') return true;
    if (this.colors || this.serialize || this.middlewareStack?.length) return true;
    if (this.listenerCount('log') > 0 || this.listenerCount('data') > 0 || this.listenerCount('readable') > 0 || this.readableFlowing) return true;
    return this.transports.some((transport) => !(
      transport?.rawnodeEnterpriseTransport === true
      && (typeof transport.writeRecord === 'function' || typeof transport.writeBatch === 'function')
    ));
  }

  async _buildCompatibilityView(record) {
    const plainFormatted = `[${record.timestamp}] [${String(record.level).toUpperCase()}] ${record.message}${record.data == null ? '' : ` => ${safeDataText(record.data, this.runtime.serializer)}`}`;
    const legacyFormatted = this.colors
      ? formatLog({ timestamp: record.timestamp, level: record.level, message: record.message, data: record.data })
      : plainFormatted;
    const formatted = this.serialize ? this.runtime.serializer.stringify(legacyFormatted) : legacyFormatted;
    const base = this.colors
      ? buildLogEntry({
          timestamp: endTimestamp(record.timestamp),
          level: record.level,
          message: record.message,
          formatted,
          data: green(safeDataText(record.data, this.runtime.serializer)),
        })
      : {
          timestamp: record.timestamp,
          level: record.level,
          message: record.message,
          formatted,
          data: record.data,
          color: (value) => String(value),
        };
    const entry = await this.applyMiddleware(base);
    return entry ?? base;
  }

  _shouldLog(level) {
    return this.runtime.isLevelEnabled(level);
  }

  log(level, message, data = null, options = {}) {
    return this.runtime.log(level, message, data, options);
  }

  async logAsync(level, message, data = null, options = {}) {
    return await this.runtime.logAsync(level, message, data, options);
  }

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

  use(middlewareFn, options = {}) {
    if (typeof middlewareFn !== 'function') throw new TypeError('Logger middleware must be a function.');
    // V1 keeps the exact historic compatibility-entry middleware contract.
    // Modern profiles use the canonical structured-record processor pipeline.
    if (this.runtime.profile.name === 'v1' || options.legacy === true) super.use(middlewareFn);
    else this.runtime.use(middlewareFn, options);
    return this;
  }

  middleware(middlewareFn) {
    if (typeof middlewareFn !== 'function') throw new TypeError('Logger middleware must be a function.');
    super.use(middlewareFn);
    return this;
  }

  processor(processor, options = {}) { this.runtime.use(processor, options); return this; }
  plugin(plugin) { this.runtime.plugin(plugin); return this; }

  addTransport(transport, options = {}) {
    if (!transport) throw new TypeError('AdvancedLogger.addTransport requires a transport.');
    this._transportOptions.set(transport, { ...(options || {}) });
    if (!this.transports.includes(transport)) this.transports.push(transport);
    else if (!this.runtime.dispatcher.adapters.some((item) => item.transport === transport)) this._syncTransports();
    return this;
  }

  transport(transport, options = {}) { return this.addTransport(transport, options); }

  removeTransport(nameOrTransport, options = {}) {
    const index = this.transports.findIndex((transport) => transport === nameOrTransport || transport?.name === nameOrTransport);
    if (index === -1) return null;
    const [transport] = this.transports.splice(index, 1);
    this._transportOptions.delete(transport);
    const adapter = this.runtime.dispatcher.remove(transport);
    if (options.close === true) adapter?.close?.(options).catch?.(() => {});
    return transport;
  }

  setLevel(level) { this.level = level; return this; }
  isLevelEnabled(level) { return this.runtime.isLevelEnabled(level); }
  registerLevel(definition, options) { this.runtime.registerLevel(definition, options); return this; }
  child(context, options) { return this.runtime.child(context, options); }
  with(context) { return this.runtime.with(context); }
  withTags(...tags) { return this.runtime.withTags(...tags); }
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
  getContext() { return this.runtime.getContext(); }
  time(label, context) { return this.runtime.time(label, context); }
  measure(label, operation, context, options) { return this.runtime.measure(label, operation, context, options); }
  health() { return this.runtime.health(); }
  stats() { return this.runtime.stats(); }
  metricsSnapshot() { return this.runtime.metricsSnapshot(); }
  diagnosticsSnapshot() { return this.runtime.diagnosticsSnapshot(); }
  levels() { return this.runtime.levels(); }
  prometheus(labels) { return this.runtime.prometheus(labels); }
  toPrometheus(labels) { return this.runtime.toPrometheus(labels); }

  async ready() { await this.runtime.ready(); return this; }
  async flush(options) { await this.runtime.flush(options); }
  async reopen() { return await this.runtime.reopen(); }

  async close(options) {
    if (this._closing) return;
    this._closing = true;
    await this.runtime.close(options);
    if (!this.readableEnded) this.push(null);
  }

  _transform(chunk, encoding, callback) {
    let entry = chunk;
    if (Buffer.isBuffer(entry)) entry = entry.toString(encoding || 'utf8');
    if (typeof entry === 'string') {
      try { entry = JSON.parse(entry); }
      catch { entry = { level: 'info', message: entry, formatted: entry }; }
    }
    const level = entry?.level && this.runtime.levelRegistry.has(entry.level) ? entry.level : 'info';
    this.runtime.logAsync(level, entry?.message ?? entry?.formatted ?? '', entry?.data ?? null, {
      context: entry?.context,
      error: entry?.error instanceof Error ? entry.error : undefined,
    }).then(() => callback(null, chunk), callback);
  }

  _flush(callback) { this.flush().then(() => callback(), callback); }
  _final(callback) { this.flush().then(() => callback(), callback); }
  _destroy(error, callback) { this.runtime.close().then(() => callback(error), () => callback(error)); }
}

export default AdvancedLogger;
