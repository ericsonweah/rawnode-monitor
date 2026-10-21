'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JsonStateStore } from '../src/persistence/JsonStateStore.js';

 test('state store encrypts desired state and restores it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawnode-pm-state-'));
  const file = path.join(root, 'state.json');
  const key = Buffer.alloc(32, 7);
  const store = new JsonStateStore({ file, keyProvider: async () => key });
  await store.save({ desired: { secret: 'do-not-leak' } });
  const raw = await readFile(file, 'utf8');
  assert.doesNotMatch(raw, /do-not-leak/);
  const loaded = await store.load();
  assert.equal(loaded.desired.secret, 'do-not-leak');
});
