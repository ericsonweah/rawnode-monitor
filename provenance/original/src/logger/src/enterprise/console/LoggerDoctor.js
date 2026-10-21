'use strict';

import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import LoggerConfiguration from '../config/LoggerConfiguration.js';
import defaultConfig from '../../../config/logger.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function nearestExisting(directory) {
  let current = path.resolve(directory);
  while (true) {
    try { await access(current, constants.F_OK); return current; }
    catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

function activeChannelNames(configuration) {
  const selected = configuration.channel || configuration.default;
  const channels = configuration.channels || {};
  const visited = new Set();
  const output = new Set();
  const visit = (name) => {
    if (!name || visited.has(name)) return;
    visited.add(name);
    const definition = channels[name];
    if (!definition || definition.enabled === false) return;
    if (definition.driver === 'stack') {
      for (const member of definition.channels || []) visit(String(member));
    } else output.add(name);
  };
  visit(selected);
  return [...output];
}

/** Run safe, side-effect-free production readiness checks. */
export async function runDoctor(options = {}) {
  const checks = [];
  const warnings = [];
  const add = (name, ok, details = {}) => checks.push({ name, ok: Boolean(ok), ...details });
  const warn = (name, details = {}) => warnings.push({ name, ...details });

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  add('node-version', nodeMajor >= 20, { actual: process.versions.node, expected: '>=20.0.0' });

  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    add('package-json', true, { packageName: pkg.name, version: pkg.version });
  } catch (error) {
    add('package-json', false, { error: error.message });
  }

  const dependencyFields = ['dependencies', 'optionalDependencies', 'peerDependencies'];
  const dependencyViolations = dependencyFields.filter((field) => pkg[field] && Object.keys(pkg[field]).length > 0);
  add('zero-runtime-dependencies', dependencyViolations.length === 0, { violations: dependencyViolations });

  const missingExports = [];
  for (const [name, definition] of Object.entries(pkg.exports || {})) {
    if (name === './*' || name === './package.json') continue;
    const target = typeof definition === 'string' ? definition : definition?.import;
    if (!target || !target.startsWith('.')) continue;
    try { await access(path.resolve(packageRoot, target), constants.R_OK); }
    catch { missingExports.push({ name, target }); }
  }
  add('package-exports', missingExports.length === 0, { missing: missingExports });

  let configuration = options.configuration || options.config || defaultConfig;
  let configDiagnostics = [];
  try {
    const compiled = configuration instanceof LoggerConfiguration
      ? configuration
      : new LoggerConfiguration(configuration, { defaults: defaultConfig, strict: false });
    configuration = compiled.snapshot();
    configDiagnostics = compiled.diagnostics;
    add('configuration', !configDiagnostics.some((item) => item.severity === 'error'), { diagnostics: configDiagnostics });
  } catch (error) {
    add('configuration', false, { error: error.message, diagnostics: error.diagnostics || [] });
  }

  const queue = configuration.queue || {};
  add('bounded-pipeline-queue', Number(queue.maxItems) > 0 && Number(queue.maxBytes) > 0, {
    maxItems: queue.maxItems,
    maxBytes: queue.maxBytes,
    overflow: queue.overflow,
  });

  const channels = configuration.channels || {};
  const active = activeChannelNames(configuration);
  for (const name of active) {
    const definition = channels[name] || {};
    const driver = String(definition.driver || 'console');
    if (driver === 'file' || driver === 'daily' || driver === 'audit') {
      const directory = path.resolve(definition.logDirectory || definition.directory || 'storage/logs');
      const ancestor = await nearestExisting(directory);
      try {
        await access(ancestor, constants.W_OK);
        add(`channel:${name}:writable`, true, { driver, directory, existingAncestor: ancestor });
      } catch (error) {
        add(`channel:${name}:writable`, false, { driver, directory, existingAncestor: ancestor, error: error.message });
      }
    }
    if (driver === 'audit') {
      const hasKey = Boolean(definition.key || definition.secret || definition.keyResolver || process.env.LOG_AUDIT_SECRET || process.env.APP_KEY);
      add(`channel:${name}:audit-key`, hasKey, { keyId: definition.keyId || 'primary' });
    }
    if ((driver === 'tcp' || driver === 'tls' || driver === 'udp') && !definition.port) {
      add(`channel:${name}:network-port`, false, { driver, error: 'port is required' });
    }
    if ((driver === 'http' || driver === 'http-batch') && !(definition.url || definition.endpoint)) {
      add(`channel:${name}:endpoint`, false, { driver, error: 'url or endpoint is required' });
    }
  }

  const inspector = configuration.inspector || {};
  if (inspector.enabled === true) {
    const loopback = ['127.0.0.1', '::1', 'localhost'].includes(String(inspector.host || '127.0.0.1'));
    add('inspector-access-control', loopback || Boolean(inspector.token), { host: inspector.host || '127.0.0.1', tokenConfigured: Boolean(inspector.token) });
    if (inspector.origins === '*') warn('inspector-origin-wildcard', { message: 'A wildcard inspector origin is not recommended in production.' });
  }

  for (const diagnostic of configDiagnostics.filter((item) => item.severity === 'warning')) warn(diagnostic.code, diagnostic);
  const failures = checks.filter((check) => !check.ok);
  return {
    ok: failures.length === 0,
    package: { name: pkg.name, version: pkg.version },
    activeChannels: active,
    checks,
    failures: failures.length,
    warnings,
  };
}

export default runDoctor;
