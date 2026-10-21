'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ProcessDefinition } from '../src/config/ProcessDefinition.js';

const fixture = path.resolve('tests/fixtures/runtime-app.mjs');

test('ProcessDefinition validates and persists only explicit environment overrides', () => {
  const definition = new ProcessDefinition({
    name: 'api',
    script: fixture,
    mode: 'cluster',
    instances: 2,
    env: { APP_SECRET: 'only-this-override' },
    readiness: { mode: 'ipc' },
  });
  assert.equal(definition.instances, 2);
  assert.equal(definition.env.APP_SECRET, 'only-this-override');
  assert.equal(definition.env.PATH, process.env.PATH);
  assert.deepEqual(definition.toJSON().env, { APP_SECRET: 'only-this-override' });
  assert.equal(Object.isFrozen(definition), true);
});

test('ProcessDefinition rejects unsafe names and invalid scale mode', () => {
  assert.throws(() => new ProcessDefinition({ name: '../bad', script: fixture }), /Invalid process name/);
  const fork = new ProcessDefinition({ name: 'one', script: fixture, mode: 'fork', instances: 50 });
  assert.equal(fork.instances, 1);
});
