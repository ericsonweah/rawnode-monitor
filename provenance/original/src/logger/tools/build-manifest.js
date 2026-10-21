#!/usr/bin/env node
'use strict';

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const ignored = new Set(['node_modules', '.git', 'MANIFEST.json']);
async function walk(directory, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, files);
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}
const entries = [];
let totalBytes = 0;
for (const absolute of await walk(root)) {
  const data = await readFile(absolute);
  totalBytes += data.length;
  entries.push({
    path: path.relative(root, absolute).split(path.sep).join('/'),
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
}
const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), files: entries.length, totalBytes, entries };
await writeFile(path.join(root, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Manifest written: ${entries.length} files, ${totalBytes} bytes\n`);
