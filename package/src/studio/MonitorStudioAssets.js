'use strict';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));

export class MonitorStudioAssets {
  constructor(options = {}) { this.root = path.resolve(options.root || packageRoot); this.cache = new Map(); this.production = options.production === true; }
  async read(name) {
    const safe = String(name || '');
    const definitions = { 'studio.js': ['resources/assets/js/monitor/studio.js', 'application/javascript; charset=utf-8'], 'studio.css': ['resources/assets/css/monitor/studio.css', 'text/css; charset=utf-8'] };
    const definition = Object.hasOwn(definitions, safe) ? definitions[safe] : null; if (!definition) return null;
    if (this.cache.has(safe)) return this.cache.get(safe);
    const file = path.resolve(this.root, definition[0]); const relative = path.relative(this.root, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Monitor Studio asset resolves outside the application root.');
    const record = Object.freeze({ name: safe, type: definition[1], body: await readFile(file, 'utf8') });
    if (this.production) this.cache.set(safe, record);
    return record;
  }
  clear() { this.cache.clear(); }
}
export default MonitorStudioAssets;
