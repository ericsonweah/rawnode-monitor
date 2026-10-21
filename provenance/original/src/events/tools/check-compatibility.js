#!/usr/bin/env node
'use strict';

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as Events from '../src/events/index.js';

const baseline = JSON.parse(await readFile(new URL('../tests/fixtures/v1-public-manifest.json', import.meta.url), 'utf8'));
for (const name of baseline.exports) assert.ok(name in Events, `Missing v1 export: ${name}`);
for (const [name, methods] of Object.entries(baseline.files)) {
  const value = Events[name];
  assert.ok(value, `Missing v1 public symbol: ${name}`);
  if (typeof value !== 'function') continue;
  for (const method of methods) assert.equal(typeof value.prototype?.[method], 'function', `${name}.${method} is missing`);
}

// Behavioral probes that protect the most fragile legacy contracts.
const bus = new Events.AdvancedEventDispatcher({ profile: 'compat' });
const order = [];
bus.on('compat:probe:done', () => order.push('exact'));
bus.on('compat:probe:*', () => order.push('child'));
bus.on('compat:*', () => order.push('root'));
bus.onPattern('compat:**', () => order.push('pattern'));
bus.onAny(() => order.push('any'));
assert.equal(bus.dispatch('compat:probe:done'), undefined);
assert.deepEqual(order, ['exact', 'child', 'root', 'pattern', 'any']);
assert.equal(bus.dispatch('udp.peerValidated'), undefined); // dot normalization remains opt-in.
await bus.close();

const legacy = new Events.EventDispatcher();
assert.equal(legacy.on('x', () => {}), undefined);
assert.equal(legacy.dispatch('x'), undefined);
process.stdout.write(`Compatibility verified across ${baseline.exports.length} v1 symbols and behavioral probes\n`);
