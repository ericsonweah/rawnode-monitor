'use strict';

import defaultConfig from '../../../config/logger.js';
import { COMPATIBILITY_PROFILES } from '../compatibility/CompatibilityProfile.js';

const BLOCKED = new Set(['__proto__', 'prototype', 'constructor']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone(value, seen = new WeakMap()) {
  if (value == null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const output = [];
    seen.set(value, output);
    for (const item of value) output.push(clone(item, seen));
    return output;
  }
  const output = Object.create(null);
  seen.set(value, output);
  for (const [key, item] of Object.entries(value)) {
    if (!BLOCKED.has(key)) output[key] = clone(item, seen);
  }
  return output;
}

function merge(base, override) {
  if (!isObject(base)) return clone(override);
  const output = clone(base);
  if (!isObject(override)) return output;
  for (const [key, value] of Object.entries(override)) {
    if (BLOCKED.has(key)) continue;
    output[key] = isObject(value) && isObject(output[key]) ? merge(output[key], value) : clone(value);
  }
  return output;
}

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) freezeDeep(item, seen);
  return Object.freeze(value);
}

function atPath(value, path, fallback) {
  const parts = Array.isArray(path) ? path : String(path || '').split('.').filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (current == null || !Object.prototype.hasOwnProperty.call(current, part)) return fallback;
    current = current[part];
  }
  return current === undefined ? fallback : current;
}

export class LoggerConfigurationError extends Error {
  constructor(message, diagnostics = []) {
    super(message);
    this.name = 'LoggerConfigurationError';
    this.code = 'LOGGER_CONFIGURATION_ERROR';
    this.diagnostics = diagnostics;
  }
}

/** Immutable, validated logger configuration snapshot. */
export class LoggerConfiguration {
  constructor(configuration = {}, options = {}) {
    const defaults = options.defaults === false ? {} : (options.defaults || defaultConfig);
    this.value = merge(defaults, configuration || {});
    this.diagnostics = this.validate();
    if (options.strict !== false && this.diagnostics.some((item) => item.severity === 'error')) {
      throw new LoggerConfigurationError('RawNode Logger configuration is invalid.', this.diagnostics);
    }
    freezeDeep(this.value);
    Object.freeze(this.diagnostics);
  }

  get(path, fallback = undefined) { return atPath(this.value, path, fallback); }
  has(path) { return atPath(this.value, path, Symbol.for('missing')) !== Symbol.for('missing'); }
  snapshot() { return clone(this.value); }
  toJSON() { return this.snapshot(); }
  with(overrides = {}, options = {}) {
    return new LoggerConfiguration(merge(this.value, overrides), { defaults: false, ...options });
  }

  validate() {
    const diagnostics = [];
    const push = (severity, code, path, message) => diagnostics.push(Object.freeze({ severity, code, path, message }));
    const profile = String(this.value.profile || 'v1');
    if (!COMPATIBILITY_PROFILES[profile]) push('error', 'LOGGER_PROFILE_UNKNOWN', 'profile', `Unknown compatibility profile [${profile}].`);
    if (!this.value.level || typeof this.value.level !== 'string') push('error', 'LOGGER_LEVEL_INVALID', 'level', 'Logger level must be a string.');

    const queue = this.value.queue || {};
    for (const field of ['maxItems', 'maxBytes', 'budgetMs', 'maxPerSlice']) {
      if (queue[field] != null && (!Number.isFinite(Number(queue[field])) || Number(queue[field]) < 0)) {
        push('error', 'LOGGER_QUEUE_LIMIT_INVALID', `queue.${field}`, `${field} must be a non-negative finite number.`);
      }
    }

    const channels = this.value.channels;
    if (!isObject(channels) || !Object.keys(channels).length) {
      push('error', 'LOGGER_CHANNELS_MISSING', 'channels', 'At least one logger channel is required.');
      return diagnostics;
    }
    const selected = String(this.value.channel || this.value.default || '');
    if (selected && !Object.prototype.hasOwnProperty.call(channels, selected)) {
      push('error', 'LOGGER_DEFAULT_CHANNEL_MISSING', 'channel', `Default channel [${selected}] is not defined.`);
    }

    for (const [name, definition] of Object.entries(channels)) {
      if (!isObject(definition) && typeof definition !== 'function') {
        push('error', 'LOGGER_CHANNEL_INVALID', `channels.${name}`, 'Channel definition must be an object or factory function.');
        continue;
      }
      if (!isObject(definition)) continue;
      const driver = String(definition.driver || 'console');
      if (driver === 'stack') {
        const members = definition.channels;
        if (!Array.isArray(members) || !members.length) {
          push('error', 'LOGGER_STACK_EMPTY', `channels.${name}.channels`, 'Stack channels require a non-empty channels array.');
        } else {
          for (const member of members) {
            if (!Object.prototype.hasOwnProperty.call(channels, String(member))) {
              push('error', 'LOGGER_STACK_MEMBER_MISSING', `channels.${name}.channels`, `Stack member [${member}] is not defined.`);
            }
          }
        }
      }
      if (driver === 'audit' && !definition.secret && !definition.key && !definition.keyResolver) {
        push('warning', 'LOGGER_AUDIT_KEY_MISSING', `channels.${name}`, 'Audit channel has no explicit key; APP_KEY/LOG_AUDIT_SECRET must be available at runtime.');
      }
    }
    return diagnostics;
  }
}

export { clone as cloneLoggerConfiguration, merge as mergeLoggerConfiguration };
export default LoggerConfiguration;
