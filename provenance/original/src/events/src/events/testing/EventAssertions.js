'use strict';

import assert from 'node:assert/strict';

function sourceRecords(source) {
  if (Array.isArray(source)) return source;
  if (typeof source?.all === 'function') return source.all();
  if (Array.isArray(source?.records)) return source.records;
  throw new TypeError('Event assertion source must be an EventRecorder or record array');
}

export function assertDispatched(source, eventName, predicate = null, message = null) {
  const records = sourceRecords(source);
  const match = records.find((record) => record.eventName === String(eventName) && (!predicate || predicate(...record.args, record)));
  assert.ok(match, message || `Expected event "${eventName}" to be dispatched`);
  return match;
}

export function assertNotDispatched(source, eventName, predicate = null, message = null) {
  const records = sourceRecords(source);
  const match = records.find((record) => record.eventName === String(eventName) && (!predicate || predicate(...record.args, record)));
  assert.equal(match, undefined, message || `Expected event "${eventName}" not to be dispatched`);
  return true;
}

export function assertDispatchedTimes(source, eventName, expected, message = null) {
  const count = sourceRecords(source).filter((record) => record.eventName === String(eventName)).length;
  assert.equal(count, expected, message || `Expected event "${eventName}" ${expected} time(s), received ${count}`);
  return true;
}

export function assertDispatchOrder(source, eventNames, message = null) {
  const actual = sourceRecords(source).map((record) => record.eventName);
  let cursor = 0;
  for (const name of actual) if (name === eventNames[cursor]) cursor++;
  assert.equal(cursor, eventNames.length, message || `Expected dispatch order ${eventNames.join(' -> ')}, received ${actual.join(' -> ')}`);
  return true;
}

export class EventAssertions {
  constructor(source) { this.source = source; }
  dispatched(name, predicate, message) { return assertDispatched(this.source, name, predicate, message); }
  notDispatched(name, predicate, message) { return assertNotDispatched(this.source, name, predicate, message); }
  dispatchedTimes(name, count, message) { return assertDispatchedTimes(this.source, name, count, message); }
  order(names, message) { return assertDispatchOrder(this.source, names, message); }
}

export default EventAssertions;
