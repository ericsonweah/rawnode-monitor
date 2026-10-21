'use strict';

// src/events/EventName.js

import { normalizeEventName as normalize } from './support/glob.js';

export const RESERVED_EVENT_PREFIXES = Object.freeze(['internal', 'http', 'tcp', 'udp', 'ws', 'redis']);

export function validateEventName(name) {
  if (typeof name !== 'string') throw new TypeError('Event name must be a string');
  const [domain] = name.split(':');
  if (!domain || !name.includes(':')) throw new Error(`Invalid event name '${name}'`);
  if (RESERVED_EVENT_PREFIXES.includes(domain)) throw new Error(`Event namespace '${domain}' is reserved`);
  return true;
}

export function normalizeEventName(name, options = {}) {
  return normalize(name, options.normalizeDot === true);
}

export function parseEventName(name, options = {}) {
  const normalized = normalizeEventName(name, options);
  if (typeof normalized !== 'string' || !normalized) throw new TypeError('Event name must be a non-empty string');
  const segments = normalized.split(':');
  return Object.freeze({
    value: normalized,
    domain: segments[0] || null,
    subject: segments.length > 2 ? segments.slice(1, -1).join(':') : segments[1] || null,
    verb: segments.length > 1 ? segments.at(-1) : null,
    segments: Object.freeze(segments),
    reserved: RESERVED_EVENT_PREFIXES.includes(segments[0]),
  });
}

export function eventName(domain, subject, verb) {
  return [domain, subject, verb].flat().filter((value) => value != null && String(value).length).map(String).join(':');
}

export function isReservedEventName(name) {
  return RESERVED_EVENT_PREFIXES.includes(String(name).split(':', 1)[0]);
}

export function assertFrameworkEventName(name) {
  const parsed = parseEventName(name);
  if (!parsed.reserved) throw new Error(`Event namespace '${parsed.domain}' is not a framework-reserved namespace`);
  return true;
}
