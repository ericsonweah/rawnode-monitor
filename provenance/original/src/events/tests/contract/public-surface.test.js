'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Events from '../../src/events/index.js';
import baseline from '../fixtures/v1-public-manifest.json' with { type: 'json' };

test('v1 public symbols and methods remain present', () => {
  for (const name of baseline.exports) assert.ok(name in Events, `Missing ${name}`);
  for (const [name, methods] of Object.entries(baseline.files)) {
    for (const method of methods) assert.equal(typeof Events[name]?.prototype?.[method], 'function', `${name}.${method}`);
  }
});

test('root default namespace contains legacy and enterprise entry points', () => {
  assert.equal(Events.default.AdvancedEventDispatcher, Events.AdvancedEventDispatcher);
  assert.equal(Events.default.EventDispatcher, Events.EventDispatcher);
  assert.equal(Events.default.EventAssertions, Events.EventAssertions);
  assert.equal(Events.default.EventOutbox, Events.EventOutbox);
});
