'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const subpaths = {
  'rawnode-events': ['default', 'AdvancedEventDispatcher', 'Event', 'RedisEventBridge', 'EventOutbox', 'WorkflowEngine'],
  'rawnode-events/core': ['ListenerHandle', 'ListenerScope', 'DispatchReport'],
  'rawnode-events/bridge': ['RedisStreamTransport', 'BridgeStateMachine'],
  'rawnode-events/broadcasting': ['BroadcastManager'],
  'rawnode-events/contracts': ['EventSchemaRegistry'],
  'rawnode-events/durable': ['EventOutbox', 'MemoryOutboxStore', 'OutboxPublisher'],
  'rawnode-events/observability': ['EventMetricsStore', 'EventHealth', 'EventDiagnostics'],
  'rawnode-events/queue': ['EventJobQueue', 'EventScheduler'],
  'rawnode-events/serialization': ['SafeJsonCodec', 'createEventEnvelope'],
  'rawnode-events/testing': ['FakeEventBus', 'EventRecorder', 'EventAssertions'],
  'rawnode-events/workflows': ['WorkflowEngine', 'MemoryWorkflowStore'],
  'rawnode-events/provider': ['default', 'EventServiceProvider'],
};

test('documented package exports resolve and expose expected symbols', async () => {
  for (const [specifier, expected] of Object.entries(subpaths)) {
    const module = await import(specifier);
    for (const name of expected) assert.ok(name in module, `${specifier} should export ${name}`);
  }
});

test('package remains zero-dependency and publishes declaration targets', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies || {}, {});
  assert.deepEqual(pkg.optionalDependencies || {}, {});
  assert.deepEqual(pkg.peerDependencies || {}, {});
  for (const entry of Object.values(pkg.exports)) {
    if (!entry || typeof entry !== 'object' || !entry.types) continue;
    assert.equal((await stat(path.join(root, entry.types.replace(/^\.\//, '')))).isFile(), true, `Missing ${entry.types}`);
  }
});

test('CLI shebang is first and entry point is executable', async () => {
  const file = path.join(root, 'bin/rawnode-events.js');
  const source = await readFile(file, 'utf8');
  const metadata = await stat(file);
  assert.equal(source.startsWith('#!/usr/bin/env node\n'), true);
  assert.notEqual(metadata.mode & 0o111, 0);
});
