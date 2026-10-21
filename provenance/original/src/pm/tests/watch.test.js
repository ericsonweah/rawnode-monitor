'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { WatchManager } from '../src/watch/WatchManager.js';
import { ProcessDefinition } from '../src/config/ProcessDefinition.js';

const fixture = path.resolve('tests/fixtures/runtime-app.mjs');

test('watch manager coalesces filesystem changes with polling fallback', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rawnode-pm-watch-'));
  await mkdir(path.join(root, 'app'));
  const definition = new ProcessDefinition({
    name: 'watch-app',
    cwd: root,
    script: fixture,
    watch: { enabled: true, paths: ['app'], debounceMs: 25, pollingIntervalMs: 50, reconcileIntervalMs: 100 },
  });
  const manager = new WatchManager();
  try {
    const changed = new Promise((resolve) => manager.watch(definition, resolve));
    await new Promise((resolve) => setTimeout(resolve, 100));
    await writeFile(path.join(root, 'app', 'change.js'), 'export default 1;\n');
    const events = await changed;
    assert.ok(events.some((entry) => entry.file.endsWith('change.js')));
  } finally { await manager.close(); }
});
