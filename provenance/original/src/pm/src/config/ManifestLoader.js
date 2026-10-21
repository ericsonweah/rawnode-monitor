'use strict';

import path from 'node:path';
import { access } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { ProcessDefinition } from './ProcessDefinition.js';
import { ConfigurationError } from '../errors.js';

const CANDIDATES = Object.freeze([
  'rawnode.process.mjs',
  'rawnode.process.js',
  'rawnode-pm.config.mjs',
  'rawnode-pm.config.js',
  'config/process.js',
]);

async function firstExisting(cwd, values) {
  for (const value of values) {
    const absolute = path.resolve(cwd, value);
    try { await access(absolute); return absolute; } catch {}
  }
  return null;
}

function normalizeManifest(value) {
  if (Array.isArray(value)) return { apps: value };
  if (value && Array.isArray(value.apps)) return value;
  if (value && Array.isArray(value.processes)) return { ...value, apps: value.processes };
  if (value && value.name && (value.script || value.command || value.entry)) return { apps: [value] };
  throw new ConfigurationError('Process manifest must export an app definition, an array, or { apps: [] }.');
}

export class ManifestLoader {
  constructor(options = {}) {
    this.cwd = path.resolve(options.cwd || process.cwd());
  }

  async resolve(file = null) {
    if (file) return path.resolve(this.cwd, file);
    const found = await firstExisting(this.cwd, CANDIDATES);
    if (!found) throw new ConfigurationError(`No process manifest found. Tried: ${CANDIDATES.join(', ')}`);
    return found;
  }

  async load(file = null, options = {}) {
    const absolute = await this.resolve(file);
    const url = pathToFileURL(absolute);
    if (options.fresh !== false) url.searchParams.set('t', String(Date.now()));
    const mod = await import(url.href);
    const exported = mod.default ?? mod.processes ?? mod.apps ?? mod;
    const manifest = normalizeManifest(typeof exported === 'function' ? await exported({ cwd: this.cwd, env: process.env }) : exported);
    const apps = manifest.apps.map((definition) => ProcessDefinition.from(definition, { cwd: path.dirname(absolute) }));
    const names = new Set();
    for (const app of apps) {
      if (names.has(app.name)) throw new ConfigurationError(`Duplicate process name '${app.name}' in manifest.`);
      names.add(app.name);
    }
    return { file: absolute, options: { ...(manifest.options || {}) }, apps };
  }
}

export default ManifestLoader;
