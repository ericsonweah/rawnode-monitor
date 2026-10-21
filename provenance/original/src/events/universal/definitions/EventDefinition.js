'use strict';

import { assertEventName, deepFreeze, deepMerge } from '../support/safe.js';

const VISIBILITY = new Set(['local', 'public', 'private', 'presence', 'internal', 'system']);
const CLASSIFICATION = new Set(['public', 'internal', 'confidential', 'restricted']);
const DELIVERY = new Set(['best-effort', 'at-most-once', 'at-least-once', 'effectively-once']);
const ORDERING = new Set(['none', 'global', 'partition']);

export class EventDefinition {
  constructor(input = {}) {
    const name = assertEventName(input.name || input.eventName);
    const version = Math.max(1, Number(input.version) || 1);
    const visibility = String(input.visibility || 'local');
    const classification = String(input.classification || (visibility === 'public' ? 'public' : 'internal'));
    const delivery = String(input.delivery || (input.durable ? 'at-least-once' : 'best-effort'));
    const ordering = String(input.ordering || (input.partitionBy ? 'partition' : 'none'));
    if (!VISIBILITY.has(visibility)) throw new TypeError(`Unsupported event visibility '${visibility}'.`);
    if (!CLASSIFICATION.has(classification)) throw new TypeError(`Unsupported event classification '${classification}'.`);
    if (!DELIVERY.has(delivery)) throw new TypeError(`Unsupported event delivery '${delivery}'.`);
    if (!ORDERING.has(ordering)) throw new TypeError(`Unsupported event ordering '${ordering}'.`);
    this.kind = 'event-definition';
    this.name = name;
    this.version = version;
    this.id = `${name}@${version}`;
    this.owner = input.owner == null ? null : String(input.owner);
    this.description = input.description == null ? null : String(input.description);
    this.payload = input.payload || input.schema || null;
    this.context = input.context || null;
    this.visibility = visibility;
    this.classification = classification;
    this.transports = Object.freeze(normalizeStrings(input.transports));
    this.channels = Object.freeze(normalizeStrings(input.channels));
    this.durable = input.durable === true;
    this.replayable = input.replayable !== false;
    this.delivery = delivery;
    this.ordering = ordering;
    this.partitionBy = input.partitionBy || null;
    this.idempotency = input.idempotency === true || delivery === 'effectively-once';
    this.retention = input.retention || null;
    this.redact = Object.freeze(normalizeStrings(input.redact));
    this.deprecated = input.deprecated || false;
    this.sunsetAt = input.sunsetAt || null;
    this.security = deepFreeze(deepMerge({}, input.security || {}));
    this.metadata = deepFreeze(deepMerge({}, input.metadata || {}));
    this.validator = typeof input.validate === 'function' ? input.validate : typeof input.validator === 'function' ? input.validator : null;
    this.upcasters = Object.freeze(Array.isArray(input.upcasters) ? input.upcasters.slice() : []);
    this.downcasters = Object.freeze(Array.isArray(input.downcasters) ? input.downcasters.slice() : []);
    deepFreeze(this);
  }

  partition(payload, context = null) {
    if (typeof this.partitionBy === 'function') return this.partitionBy(payload, context);
    if (typeof this.partitionBy === 'string' && payload && typeof payload === 'object') return getPath(payload, this.partitionBy);
    return null;
  }

  toJSON() {
    const { validator, upcasters, downcasters, ...value } = this;
    return { ...value, payload: describeContract(this.payload), context: describeContract(this.context), upcasters: upcasters.length, downcasters: downcasters.length };
  }
}

function normalizeStrings(value) { return [...new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map(String).map((entry) => entry.trim()).filter(Boolean))]; }
function getPath(value, path) { return String(path).split('.').reduce((current, key) => current?.[key], value); }
function describeContract(value) { if (!value) return null; if (typeof value === 'function') return { type: 'function', name: value.name || 'anonymous' }; if (typeof value?.describe === 'function') return value.describe(); return value; }

export function defineEvent(input) { return input instanceof EventDefinition ? input : new EventDefinition(input); }
export default EventDefinition;
