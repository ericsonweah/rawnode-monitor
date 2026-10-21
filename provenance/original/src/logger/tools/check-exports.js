#!/usr/bin/env node
'use strict';

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const requiredLegacy = [
  'Logger','AdvancedLogger','defaultLogger','logger','Config','colors','ConsoleTransport','FileTransport',
  'ObservableFileTransport','ObservableFileTransportEnhanced','ObservableConsoleTransport','ObservableConsoleTransportEnhanced',
];
const requiredEnterprise = [
  'createLogger','LoggerRuntime','LoggerBuilder','LoggerFacade','NullLogger','LevelRegistry','SafeSerializer','Redactor',
  'EnterpriseConsoleTransport','EnterpriseFileTransport','AuditFileTransport','MemoryTransport','RedisStreamTransport',
  'TcpTransport','UdpTransport','HttpBatchTransport','ChannelManager','LoggerServiceProvider','InspectorServer',
  'createHttpLoggingMiddleware','LoggerRecorder','runDoctor','runCli',
];
const failures = [];

const rootModule = await import(pathToFileURL(path.join(root, 'index.js')).href);
for (const name of [...requiredLegacy, ...requiredEnterprise]) if (!(name in rootModule)) failures.push(`root export missing: ${name}`);
if (!rootModule.default) failures.push('root default export missing');

for (const [subpath, definition] of Object.entries(pkg.exports || {})) {
  if (subpath === './*' || subpath === './package.json') continue;
  const target = typeof definition === 'string' ? definition : definition?.import;
  if (!target) continue;
  const absolute = path.resolve(root, target);
  try { await access(absolute); await import(pathToFileURL(absolute).href); }
  catch (error) { failures.push(`${subpath} -> ${target}: ${error.message}`); }
  const types = typeof definition === 'object' ? definition.types : null;
  if (types) {
    try { await access(path.resolve(root, types)); }
    catch { failures.push(`${subpath} types missing: ${types}`); }
  }
}

if (failures.length) {
  failures.forEach((failure) => process.stderr.write(`${failure}\n`));
  process.exitCode = 1;
} else process.stdout.write(`Checked ${Object.keys(pkg.exports || {}).length} package export entries and ${requiredLegacy.length + requiredEnterprise.length} public symbols: OK\n`);
