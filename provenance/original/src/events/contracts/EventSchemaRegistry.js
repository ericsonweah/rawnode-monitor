'use strict';

import { EventConfigurationError, EventAdmissionError } from '../errors/EventError.js';

function positiveVersion(value) {
  const version = Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('Event schema version must be a positive safe integer');
  return version;
}

function normalizeDefinition(definition = {}) {
  if (typeof definition === 'function') return { validate: definition };
  if (!definition || typeof definition !== 'object') throw new TypeError('Event schema definition must be an object or validator function');
  return { ...definition };
}

/** Versioned contracts, validators, and sequential upcasters for persisted events. */
export class EventSchemaRegistry {
  constructor(options = {}) {
    this.events = new Map();
    this.maxEvents = Math.max(1, Number(options.maxEvents) || 10_000);
    this.maxVersionsPerEvent = Math.max(1, Number(options.maxVersionsPerEvent) || 100);
    this.frozen = false;
  }

  register(eventName, version, definition = {}, options = {}) {
    if (this.frozen) throw new EventConfigurationError('Event schema registry is frozen', { code: 'EVENT_SCHEMA_REGISTRY_FROZEN' });
    const name = String(eventName || '').trim();
    if (!name) throw new TypeError('Event schema name is required');
    const normalizedVersion = positiveVersion(version);
    if (!this.events.has(name) && this.events.size >= this.maxEvents) {
      throw new EventConfigurationError('Event schema registry event limit exceeded', { code: 'EVENT_SCHEMA_EVENT_LIMIT' });
    }
    let versions = this.events.get(name);
    if (!versions) this.events.set(name, versions = new Map());
    if (!versions.has(normalizedVersion) && versions.size >= this.maxVersionsPerEvent) {
      throw new EventConfigurationError(`Version limit exceeded for ${name}`, { code: 'EVENT_SCHEMA_VERSION_LIMIT' });
    }
    if (versions.has(normalizedVersion) && options.replace !== true) {
      throw new EventConfigurationError(`Event schema already registered: ${name}@${normalizedVersion}`, { code: 'EVENT_SCHEMA_DUPLICATE' });
    }
    const record = normalizeDefinition(definition);
    versions.set(normalizedVersion, Object.freeze({
      eventName: name,
      version: normalizedVersion,
      validate: typeof record.validate === 'function' ? record.validate : null,
      upcast: typeof record.upcast === 'function' ? record.upcast : null,
      downcast: typeof record.downcast === 'function' ? record.downcast : null,
      schema: record.schema ?? null,
      deprecated: record.deprecated === true,
      description: record.description ? String(record.description) : '',
      meta: record.meta && typeof record.meta === 'object' ? Object.freeze({ ...record.meta }) : null,
    }));
    return this;
  }

  define(eventName, version = 1) {
    const definition = { validate: null, upcast: null, downcast: null, schema: null, deprecated: false, description: '', meta: null };
    const builder = {
      validate: (fn) => { definition.validate = fn; return builder; },
      upcast: (fn) => { definition.upcast = fn; return builder; },
      downcast: (fn) => { definition.downcast = fn; return builder; },
      schema: (value) => { definition.schema = value; return builder; },
      deprecated: (value = true) => { definition.deprecated = value !== false; return builder; },
      describe: (value) => { definition.description = String(value); return builder; },
      meta: (value) => { definition.meta = value; return builder; },
      register: (options) => { this.register(eventName, version, definition, options); return this; },
    };
    return builder;
  }

  has(eventName, version = null) {
    const versions = this.events.get(String(eventName));
    return version == null ? !!versions?.size : versions?.has(Number(version)) === true;
  }

  get(eventName, version = null) {
    const name = String(eventName);
    const versions = this.events.get(name);
    if (!versions?.size) return null;
    const selected = version == null ? this.latestVersion(name) : positiveVersion(version);
    return versions.get(selected) || null;
  }

  latestVersion(eventName) {
    const versions = this.events.get(String(eventName));
    if (!versions?.size) return null;
    let latest = 0;
    for (const version of versions.keys()) latest = Math.max(latest, version);
    return latest;
  }

  validate(eventName, version, payload, context = {}) {
    const contract = this.get(eventName, version);
    if (!contract) throw new EventAdmissionError(`Unknown event contract: ${eventName}@${version}`, { code: 'EVENT_SCHEMA_UNKNOWN', eventName });
    if (!contract.validate) return { ok: true, payload };
    let result;
    try { result = contract.validate(payload, { eventName: String(eventName), version: contract.version, ...context }); }
    catch (cause) {
      throw new EventAdmissionError(`Event contract validation failed: ${eventName}@${version}`, {
        code: 'EVENT_SCHEMA_VALIDATION', eventName, cause,
      });
    }
    if (result && typeof result.then === 'function') {
      throw new EventConfigurationError('Async event validator used through validate(); call validateAsync()', { code: 'EVENT_SCHEMA_ASYNC_VALIDATOR' });
    }
    if (result === false || result?.ok === false) {
      throw new EventAdmissionError(result?.message || `Event payload rejected by ${eventName}@${version}`, {
        code: result?.code || 'EVENT_SCHEMA_VALIDATION', eventName, details: result?.details,
      });
    }
    return { ok: true, payload: result?.payload ?? payload, contract };
  }

  async validateAsync(eventName, version, payload, context = {}) {
    const contract = this.get(eventName, version);
    if (!contract) throw new EventAdmissionError(`Unknown event contract: ${eventName}@${version}`, { code: 'EVENT_SCHEMA_UNKNOWN', eventName });
    if (!contract.validate) return { ok: true, payload, contract };
    let result;
    try { result = await contract.validate(payload, { eventName: String(eventName), version: contract.version, ...context }); }
    catch (cause) {
      throw new EventAdmissionError(`Event contract validation failed: ${eventName}@${version}`, { code: 'EVENT_SCHEMA_VALIDATION', eventName, cause });
    }
    if (result === false || result?.ok === false) {
      throw new EventAdmissionError(result?.message || `Event payload rejected by ${eventName}@${version}`, {
        code: result?.code || 'EVENT_SCHEMA_VALIDATION', eventName, details: result?.details,
      });
    }
    return { ok: true, payload: result?.payload ?? payload, contract };
  }

  upcast(eventName, fromVersion, payload, targetVersion = null, context = {}) {
    const name = String(eventName);
    let version = positiveVersion(fromVersion);
    const target = targetVersion == null ? this.latestVersion(name) : positiveVersion(targetVersion);
    if (!target) throw new EventAdmissionError(`Unknown event contract: ${name}`, { code: 'EVENT_SCHEMA_UNKNOWN', eventName: name });
    if (target < version) return this.downcast(name, version, payload, target, context);
    let value = payload;
    while (version < target) {
      const contract = this.get(name, version);
      if (!contract?.upcast) {
        throw new EventAdmissionError(`Missing upcaster for ${name}@${version} -> ${version + 1}`, {
          code: 'EVENT_SCHEMA_UPCASTER_MISSING', eventName: name,
        });
      }
      value = contract.upcast(value, { eventName: name, fromVersion: version, toVersion: version + 1, ...context });
      if (value && typeof value.then === 'function') {
        throw new EventConfigurationError('Async upcaster used through upcast(); call upcastAsync()', { code: 'EVENT_SCHEMA_ASYNC_UPCASTER' });
      }
      version++;
    }
    return { eventName: name, version, payload: value };
  }

  async upcastAsync(eventName, fromVersion, payload, targetVersion = null, context = {}) {
    const name = String(eventName);
    let version = positiveVersion(fromVersion);
    const target = targetVersion == null ? this.latestVersion(name) : positiveVersion(targetVersion);
    if (!target) throw new EventAdmissionError(`Unknown event contract: ${name}`, { code: 'EVENT_SCHEMA_UNKNOWN', eventName: name });
    let value = payload;
    while (version < target) {
      const contract = this.get(name, version);
      if (!contract?.upcast) throw new EventAdmissionError(`Missing upcaster for ${name}@${version}`, { code: 'EVENT_SCHEMA_UPCASTER_MISSING', eventName: name });
      value = await contract.upcast(value, { eventName: name, fromVersion: version, toVersion: version + 1, ...context });
      version++;
    }
    return { eventName: name, version, payload: value };
  }

  downcast(eventName, fromVersion, payload, targetVersion, context = {}) {
    const name = String(eventName);
    let version = positiveVersion(fromVersion);
    const target = positiveVersion(targetVersion);
    let value = payload;
    while (version > target) {
      const contract = this.get(name, version);
      if (!contract?.downcast) throw new EventAdmissionError(`Missing downcaster for ${name}@${version}`, { code: 'EVENT_SCHEMA_DOWNCASTER_MISSING', eventName: name });
      value = contract.downcast(value, { eventName: name, fromVersion: version, toVersion: version - 1, ...context });
      version--;
    }
    return { eventName: name, version, payload: value };
  }

  freeze() { this.frozen = true; return this; }
  unfreeze() { this.frozen = false; return this; }
  eventNames() { return Array.from(this.events.keys()).sort(); }
  manifest() {
    return this.eventNames().flatMap((eventName) => Array.from(this.events.get(eventName).values())
      .sort((a, b) => a.version - b.version)
      .map((record) => ({ ...record, validate: !!record.validate, upcast: !!record.upcast, downcast: !!record.downcast })));
  }
  snapshot() { return Object.freeze({ frozen: this.frozen, events: this.events.size, contracts: this.manifest().length }); }
}

export default EventSchemaRegistry;
