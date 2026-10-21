#!/usr/bin/env node
'use strict';

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const failures = [];
let imported = 0;
for (const [subpath, definition] of Object.entries(pkg.exports || {})) {
  if (subpath === './package.json') { await access(path.join(root, definition)); continue; }
  const target = typeof definition === 'string' ? definition : definition?.import;
  const types = typeof definition === 'object' ? definition?.types : null;
  if (!target) { failures.push(`${subpath}: import target missing`); continue; }
  try { await import(pathToFileURL(path.resolve(root, target)).href); imported++; }
  catch (error) { failures.push(`${subpath} -> ${target}: ${error?.message || error}`); }
  if (types) {
    try { await access(path.resolve(root, types)); }
    catch { failures.push(`${subpath}: declaration missing ${types}`); }
  }
}

const rootModule = await import(pathToFileURL(path.join(root, 'index.js')).href);
for (const name of [
  'AdvancedEventDispatcher', 'EventDispatcher', 'Event', 'ProtocolEvent', 'Broadcastable',
  'RedisEventBridge', 'RedisStreamTransport', 'EventOutbox', 'EventJobQueue', 'WorkflowEngine',
  'AggregateRoot', 'MemoryEventStore', 'ProjectionManager', 'EventServiceProvider',
]) if (!(name in rootModule)) failures.push(`root export missing: ${name}`);
if (!rootModule.default) failures.push('root default export missing');

if (failures.length) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exitCode = 1;
} else process.stdout.write(`Validated ${imported} JavaScript export targets and ${Object.keys(pkg.exports || {}).length} package entries: OK\n`);
