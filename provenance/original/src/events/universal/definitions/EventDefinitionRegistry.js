'use strict';

import { EventDefinition, defineEvent } from './EventDefinition.js';
import { deepFreeze } from '../support/safe.js';

export class EventDefinitionRegistry {
  constructor(options = {}) {
    this.maxDefinitions = Math.max(1, Number(options.maxDefinitions || options.maxEvents) || 10_000);
    this.maxVersionsPerEvent = Math.max(1, Number(options.maxVersionsPerEvent) || 100);
    this.definitions = new Map();
    this.latest = new Map();
    this.frozen = false;
    for (const definition of normalizeDefinitions(options.definitions || options.events || [])) this.register(definition);
  }

  register(input, options = {}) {
    if (this.frozen) throw error('Event definitions are frozen.', 'EVENT_DEFINITIONS_FROZEN');
    const definition = defineEvent(input);
    const versions = this.definitions.get(definition.name) || new Map();
    if (!versions.has(definition.version) && this.size >= this.maxDefinitions) throw error('Event definition limit exceeded.', 'EVENT_DEFINITION_LIMIT');
    if (!versions.has(definition.version) && versions.size >= this.maxVersionsPerEvent) throw error(`Event '${definition.name}' version limit exceeded.`, 'EVENT_DEFINITION_VERSION_LIMIT');
    if (versions.has(definition.version) && options.replace !== true) throw error(`Event definition already exists: ${definition.id}`, 'EVENT_DEFINITION_DUPLICATE');
    versions.set(definition.version, definition);
    this.definitions.set(definition.name, versions);
    const latest = this.latest.get(definition.name);
    if (!latest || definition.version >= latest.version) this.latest.set(definition.name, definition);
    return definition;
  }

  define(input, options) { return this.register(input, options); }
  has(name, version = null) { return version == null ? this.latest.has(String(name)) : this.definitions.get(String(name))?.has(Number(version)) === true; }
  get(name, version = null) { return version == null ? this.latest.get(String(name)) || null : this.definitions.get(String(name))?.get(Number(version)) || null; }
  require(name, version = null) { const value = this.get(name, version); if (!value) throw error(`Unknown event definition: ${name}${version == null ? '' : `@${version}`}`, 'EVENT_DEFINITION_UNKNOWN'); return value; }
  versions(name) { return [...(this.definitions.get(String(name))?.values() || [])].sort((a, b) => a.version - b.version); }
  all() { return [...this.definitions.values()].flatMap((versions) => [...versions.values()]).sort((a, b) => a.id.localeCompare(b.id)); }
  get size() { let total = 0; for (const versions of this.definitions.values()) total += versions.size; return total; }
  freeze() { this.frozen = true; return this; }
  unfreeze() { this.frozen = false; return this; }

  async validate(name, version, payload, context = {}) {
    const definition = this.get(name, version);
    if (!definition) return { ok: false, unknown: true, errors: [{ path: '$', code: 'EVENT_DEFINITION_UNKNOWN', message: `Unknown event ${name}@${version || 1}` }] };
    const errors = [];
    if (definition.validator) {
      const result = await definition.validator(payload, { ...context, definition });
      if (result === false) errors.push({ path: '$', code: 'EVENT_VALIDATION_FAILED', message: 'Event validator returned false.' });
      else if (result?.ok === false) errors.push(...normalizeErrors(result.errors || result.error || result.message));
    } else if (definition.payload) validateSchema(payload, definition.payload, '$', errors);
    if (definition.context && context.eventContext) validateSchema(context.eventContext, definition.context, '$context', errors);
    return { ok: errors.length === 0, unknown: false, definition, errors };
  }

  async assert(name, version, payload, context = {}) {
    const result = await this.validate(name, version, payload, context);
    if (!result.ok) throw Object.assign(new TypeError(`Event contract validation failed for ${name}@${version || 1}.`), { name: 'EventContractError', code: result.unknown ? 'EVENT_DEFINITION_UNKNOWN' : 'EVENT_CONTRACT_INVALID', details: { errors: result.errors }, eventName: name });
    return result.definition;
  }

  upcast(name, fromVersion, payload, targetVersion = null, context = {}) {
    const target = targetVersion == null ? this.get(name)?.version : Number(targetVersion);
    if (!target) throw error(`Unknown event definition: ${name}`, 'EVENT_DEFINITION_UNKNOWN');
    let value = payload;
    let current = Math.max(1, Number(fromVersion) || 1);
    while (current < target) {
      const next = this.get(name, current + 1);
      if (!next) throw error(`Missing event definition ${name}@${current + 1}.`, 'EVENT_UPCAST_VERSION_MISSING');
      const upcaster = next.upcasters.find((entry) => Number(entry?.from || entry?.version || current) === current) || next.upcasters[0];
      if (typeof upcaster === 'function') value = upcaster(value, { ...context, name, fromVersion: current, toVersion: current + 1 });
      else if (typeof upcaster?.upcast === 'function') value = upcaster.upcast(value, { ...context, name, fromVersion: current, toVersion: current + 1 });
      else throw error(`Missing upcaster ${name}@${current}->${current + 1}.`, 'EVENT_UPCASTER_MISSING');
      current++;
    }
    return { payload: value, version: current };
  }

  manifest(options = {}) {
    return deepFreeze({
      schemaVersion: 1,
      generatedAt: options.generatedAt || new Date().toISOString(),
      definitions: this.all().map((definition) => definition.toJSON()),
      frozen: this.frozen,
      count: this.size,
    });
  }

  snapshot() { return deepFreeze({ frozen: this.frozen, size: this.size, events: [...this.latest.keys()].sort(), versions: Object.fromEntries([...this.definitions].map(([name, versions]) => [name, [...versions.keys()].sort((a, b) => a - b)])) }); }
}

function normalizeDefinitions(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') return [];
  const output = [];
  for (const [name, value] of Object.entries(input)) {
    if (Array.isArray(value)) for (const definition of value) output.push({ name, ...definition });
    else output.push({ name, ...(value || {}) });
  }
  return output;
}

function validateSchema(value, schema, path, errors) {
  if (typeof schema === 'function') { const result = schema(value); if (result === false) errors.push({ path, code: 'EVENT_SCHEMA_FUNCTION', message: 'Schema predicate returned false.' }); return; }
  if (!schema || typeof schema !== 'object') return;
  if (schema.required === true && (value === undefined || value === null)) { errors.push({ path, code: 'EVENT_REQUIRED', message: `${path} is required.` }); return; }
  if (value == null) { if (Array.isArray(schema.required)) errors.push({ path, code: 'EVENT_REQUIRED', message: `${path} is required.` }); return; }
  const type = schema.type;
  if (type && !matchesType(value, type)) { errors.push({ path, code: 'EVENT_TYPE', message: `${path} must be ${type}.`, expected: type, actual: typeOf(value) }); return; }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) errors.push({ path, code: 'EVENT_ENUM', message: `${path} is not an accepted value.` });
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push({ path, code: 'EVENT_MIN_LENGTH', message: `${path} is too short.` });
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push({ path, code: 'EVENT_MAX_LENGTH', message: `${path} is too long.` });
    if (schema.pattern && !(schema.pattern instanceof RegExp ? schema.pattern : new RegExp(schema.pattern)).test(value)) errors.push({ path, code: 'EVENT_PATTERN', message: `${path} does not match the required pattern.` });
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push({ path, code: 'EVENT_MINIMUM', message: `${path} is below the minimum.` });
    if (schema.maximum != null && value > schema.maximum) errors.push({ path, code: 'EVENT_MAXIMUM', message: `${path} exceeds the maximum.` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push({ path, code: 'EVENT_MIN_ITEMS', message: `${path} has too few items.` });
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push({ path, code: 'EVENT_MAX_ITEMS', message: `${path} has too many items.` });
    if (schema.items) value.forEach((item, index) => validateSchema(item, schema.items, `${path}[${index}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push({ path: `${path}.${key}`, code: 'EVENT_REQUIRED', message: `${path}.${key} is required.` });
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) validateSchema(value[key], child, `${path}.${key}`, errors);
    if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in (schema.properties || {}))) errors.push({ path: `${path}.${key}`, code: 'EVENT_UNKNOWN_KEY', message: `${path}.${key} is not allowed.` });
  }
}

function matchesType(value, type) { const types = Array.isArray(type) ? type : [type]; return types.some((entry) => entry === 'array' ? Array.isArray(value) : entry === 'integer' ? Number.isInteger(value) : entry === 'null' ? value === null : entry === 'object' ? value && typeof value === 'object' && !Array.isArray(value) : typeof value === entry); }
function typeOf(value) { return value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value; }
function normalizeErrors(value) { if (Array.isArray(value)) return value.map((entry) => typeof entry === 'string' ? { path: '$', code: 'EVENT_VALIDATION_FAILED', message: entry } : entry); if (typeof value === 'string') return [{ path: '$', code: 'EVENT_VALIDATION_FAILED', message: value }]; return [{ path: '$', code: 'EVENT_VALIDATION_FAILED', message: 'Event validation failed.' }]; }
function error(message, code) { return Object.assign(new Error(message), { name: 'EventDefinitionError', code }); }

export default EventDefinitionRegistry;
