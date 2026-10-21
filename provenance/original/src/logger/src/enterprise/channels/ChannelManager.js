'use strict';

import createLogger from '../public/createLogger.js';
import ConsoleTransport from '../transports/ConsoleTransport.js';
import FileTransport from '../transports/FileTransport.js';
import AuditFileTransport from '../transports/AuditFileTransport.js';
import MemoryTransport from '../transports/MemoryTransport.js';
import NullTransport from '../transports/NullTransport.js';
import RedisStreamTransport from '../transports/RedisStreamTransport.js';
import TcpTransport from '../transports/TcpTransport.js';
import UdpTransport from '../transports/UdpTransport.js';
import HttpBatchTransport from '../transports/HttpBatchTransport.js';

function normalizeFileOptions(definition = {}) {
  return {
    ...definition,
    logDirectory: definition.logDirectory || definition.directory,
    fileName: definition.fileName || definition.filename,
    maxSize: definition.maxSize ?? definition.maxBytes,
    rotateInterval: definition.rotateInterval ?? definition.rotateIntervalMs,
    compressOnRotate: definition.compressOnRotate ?? definition.compress,
    retention: definition.retention ? {
      ...definition.retention,
      maxTotalBytes: definition.retention.maxTotalBytes ?? definition.retention.maxBytes,
    } : undefined,
  };
}

function channelError(code, message, details = null) {
  const error = new Error(message);
  error.name = 'LoggerChannelError';
  error.code = code;
  error.details = details;
  return error;
}

/** Configuration-driven, Laravel-style logger channel manager. */
export class ChannelManager {
  constructor(options = {}) {
    this.loggerFactory = options.loggerFactory || createLogger;
    this.base = { ...(options.base || {}) };
    this.definitions = new Map(Object.entries(options.channels || {}));
    this.instances = new Map();
    this.defaultChannel = options.default || 'app';
    this.bindingResolver = typeof options.bindingResolver === 'function' ? options.bindingResolver : null;
    this.drivers = new Map();
    this.closed = false;

    const customDrivers = options.drivers instanceof Map
      ? options.drivers
      : new Map(Object.entries(options.drivers || {}));
    for (const [name, factory] of customDrivers) this.extend(name, factory, { replace: true });
  }

  setBindingResolver(resolver) {
    if (resolver != null && typeof resolver !== 'function') throw new TypeError('Channel binding resolver must be a function.');
    this.bindingResolver = resolver || null;
    return this;
  }

  resolveBinding(key, fallback = null) {
    if (!key || !this.bindingResolver) return fallback;
    try { return this.bindingResolver(key) ?? fallback; } catch { return fallback; }
  }

  default(name) {
    if (name === undefined) return this.defaultChannel;
    this.defaultChannel = String(name);
    return this;
  }

  extend(driver, factory, options = {}) {
    const name = String(driver || '').trim().toLowerCase();
    if (!name || typeof factory !== 'function') throw new TypeError('ChannelManager.extend requires a driver name and factory.');
    if (this.drivers.has(name) && options.replace !== true) throw new Error(`Logger channel driver [${name}] is already registered.`);
    this.drivers.set(name, factory);
    return this;
  }

  define(name, definition, options = {}) {
    if (this.closed) throw new Error('Cannot define a channel on a closed ChannelManager.');
    const key = String(name || '').trim();
    if (!key) throw new TypeError('Channel name is required.');
    if (this.definitions.has(key) && options.replace !== true) throw new Error(`Logger channel [${key}] is already defined.`);
    if (options.replace === true) this.instances.delete(key);
    this.definitions.set(key, definition);
    return this;
  }

  forget(name, options = {}) {
    const key = String(name);
    const logger = this.instances.get(key);
    this.instances.delete(key);
    if (options.close === true) Promise.resolve(logger?.close?.()).catch(() => {});
    return this.definitions.delete(key) || Boolean(logger);
  }

  has(name) {
    const key = String(name);
    return this.definitions.has(key) || this.instances.has(key);
  }

  _assertAcyclic(name, ancestry = []) {
    const key = String(name);
    const cycleAt = ancestry.indexOf(key);
    if (cycleAt !== -1) {
      const cycle = [...ancestry.slice(cycleAt), key];
      throw channelError(
        'LOGGER_CHANNEL_CYCLE',
        `Logger channel cycle detected: ${cycle.join(' -> ')}.`,
        { cycle },
      );
    }

    const definition = this.definitions.get(key);
    if (!definition || typeof definition === 'function' || typeof definition?.log === 'function') return;
    if (String(definition.driver || '').toLowerCase() !== 'stack') return;

    const children = Array.isArray(definition.channels)
      ? definition.channels.map(String).filter(Boolean)
      : String(definition.channels || '').split(',').map((item) => item.trim()).filter(Boolean);
    const next = [...ancestry, key];
    for (const child of children) {
      if (!this.definitions.has(child) && !this.instances.has(child)) {
        throw channelError(
          'LOGGER_CHANNEL_NOT_FOUND',
          `Logger stack channel [${key}] references undefined channel [${child}].`,
          { channel: key, missing: child },
        );
      }
      this._assertAcyclic(child, next);
    }
  }

  _assertNoStackCycle(start) {
    const visiting = new Set();
    const visited = new Set();
    const path = [];

    const visit = (name) => {
      const key = String(name);
      if (visiting.has(key)) {
        const from = path.indexOf(key);
        const cycle = [...path.slice(from), key];
        const error = new Error(`Circular logger channel stack detected: ${cycle.join(' -> ')}`);
        error.code = 'LOGGER_CHANNEL_CYCLE';
        error.details = { cycle };
        throw error;
      }
      if (visited.has(key)) return;

      const definition = this.definitions.get(key);
      if (!definition || String(definition?.driver || '').toLowerCase() !== 'stack') {
        visited.add(key);
        return;
      }

      visiting.add(key);
      path.push(key);
      const children = Array.isArray(definition.channels)
        ? definition.channels
        : String(definition.channels || '').split(',').map((item) => item.trim()).filter(Boolean);
      for (const child of children) visit(child);
      path.pop();
      visiting.delete(key);
      visited.add(key);
    };

    visit(start);
  }

  channel(name = this.defaultChannel) {
    if (this.closed) throw new Error('ChannelManager is closed.');
    const key = String(name || this.defaultChannel);
    if (this.instances.has(key)) return this.instances.get(key);
    const definition = this.definitions.get(key);
    if (!definition) throw channelError('LOGGER_CHANNEL_NOT_FOUND', `Logger channel [${key}] is not defined.`, { channel: key });
    if (definition?.enabled === false) throw channelError('LOGGER_CHANNEL_DISABLED', `Logger channel [${key}] is disabled.`, { channel: key });
    this._assertAcyclic(key);

    let logger;
    if (typeof definition === 'function') logger = definition({ name: key, manager: this, base: { ...this.base } });
    else if (definition && typeof definition.log === 'function') logger = definition;
    else if (String(definition?.driver || '').toLowerCase() === 'stack') {
      this._assertNoStackCycle(key);
      logger = this.stack(definition.channels || [], { ...definition, name: key, channel: definition.channel || key });
    }
    else logger = this._buildDriverLogger(key, definition || {});

    if (!logger || typeof logger.log !== 'function') throw new TypeError(`Logger channel [${key}] did not resolve to a logger.`);
    this.instances.set(key, logger);
    return logger;
  }

  _buildDriverLogger(name, definition) {
    const driver = String(definition.driver || 'console').toLowerCase();
    const custom = this.drivers.get(driver);
    if (custom) {
      const value = custom({ name, definition, manager: this, base: { ...this.base }, resolve: this.resolveBinding.bind(this) });
      if (value && typeof value.log === 'function') return value;
      if (value) return this.loggerFactory({ ...this.base, ...definition, channel: definition.channel || name, transports: [value] });
      throw new Error(`Custom logger driver [${driver}] returned no logger or transport.`);
    }

    if (Array.isArray(definition.transports)) {
      return this.loggerFactory({ ...this.base, ...definition, channel: definition.channel || name, transports: definition.transports });
    }

    const transport = this._createTransport(name, driver, definition);
    return this.loggerFactory({
      ...this.base,
      ...definition,
      channel: definition.channel || name,
      transports: [{ transport, options: definition.transportOptions || definition.queue || {} }],
    });
  }

  _createTransport(name, driver, definition) {
    if (definition.transport) return definition.transport;
    if (typeof definition.factory === 'function') return definition.factory({ name, definition, manager: this });
    if (driver === 'console' || driver === 'stdout' || driver === 'stderr') return new ConsoleTransport({ ...definition, name });
    if (driver === 'file' || driver === 'daily') return new FileTransport({ ...normalizeFileOptions(definition), name });
    if (driver === 'audit') return new AuditFileTransport({ ...normalizeFileOptions(definition), name });
    if (driver === 'memory') return new MemoryTransport({ ...definition, name });
    if (driver === 'null' || driver === 'silent') return new NullTransport({ ...definition, name });
    if (driver === 'redis' || driver === 'redis-stream') {
      const client = definition.client || this.resolveBinding(definition.binding || 'redis') || this.resolveBinding('redis.client');
      if (!client) throw new Error(`Logger channel [${name}] requires a Redis client binding.`);
      return new RedisStreamTransport(client, { ...definition, name });
    }
    if (driver === 'tcp' || driver === 'tls') return new TcpTransport({ ...definition, name, tls: driver === 'tls' || definition.tls });
    if (driver === 'udp') return new UdpTransport({ ...definition, name });
    if (driver === 'http' || driver === 'http-batch') return new HttpBatchTransport({ ...definition, name });
    throw new Error(`Unsupported logger channel driver [${driver}] for channel [${name}].`);
  }

  stack(names, options = {}) {
    const list = Array.isArray(names)
      ? names.map(String).filter(Boolean)
      : String(names || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (!list.length) throw new TypeError('A stack channel requires at least one channel.');

    const transports = list.map((name) => {
      const manager = this;
      return {
        name: `channel:${name}`,
        rawnodeEnterpriseTransport: true,
        owned: false,
        async writeRecord(record) {
          await manager.channel(name).logAsync(record.level, record.message, record.data, {
            channel: record.channel,
            context: record.context,
            error: record.error,
            tags: record.tags,
            awaitDelivery: true,
          });
        },
        async flush(flushOptions) { await manager.channel(name).flush?.(flushOptions); },
        async reopen(reopenOptions) { return await manager.channel(name).reopen?.(reopenOptions); },
        health() { return manager.channel(name).health?.() || { status: 'unknown' }; },
      };
    });

    return this.loggerFactory({
      ...this.base,
      ...options,
      channel: options.channel || options.name || `stack:${list.join(',')}`,
      transports,
    });
  }

  async ready() { await Promise.allSettled([...this.instances.values()].map((logger) => logger.ready?.())); return this; }
  async flush(options = {}) { return await Promise.allSettled([...this.instances.values()].map((logger) => logger.flush?.(options))); }
  async reopen(options = {}) { return await Promise.allSettled([...this.instances.values()].map((logger) => logger.reopen?.(options))); }

  health() {
    return {
      status: this.closed ? 'closed' : 'healthy',
      default: this.defaultChannel,
      channels: Object.fromEntries([...this.instances].map(([name, logger]) => [name, logger.health?.() || { status: 'unknown' }])),
    };
  }
  stats() { return Object.fromEntries([...this.instances].map(([name, logger]) => [name, logger.stats?.() || null])); }

  async close(options = {}) {
    if (this.closed) return;
    this.closed = true;
    const unique = [...new Set(this.instances.values())];
    await Promise.allSettled(unique.map((logger) => logger.close?.(options)));
    this.instances.clear();
  }

  snapshot() {
    return {
      closed: this.closed,
      default: this.defaultChannel,
      definitions: [...this.definitions.keys()],
      active: [...this.instances.keys()],
      drivers: [...this.drivers.keys()],
    };
  }
}

export default ChannelManager;
