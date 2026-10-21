#!/usr/bin/env node
'use strict';

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const output = path.join(root, 'MANIFEST.json');
const ignored = new Set(['node_modules', '.git', 'coverage', 'MANIFEST.json']);
async function walk(directory, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
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
  const info = await stat(absolute);
  totalBytes += data.length;
  entries.push({
    path: path.relative(root, absolute).split(path.sep).join('/'),
    bytes: data.length,
    mode: `0${(info.mode & 0o777).toString(8)}`,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
}
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), package: { name: pkg.name, version: pkg.version }, fileCount: entries.length, totalBytes, hashAlgorithm: 'sha256', files: entries };
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`Manifest written: ${entries.length} files, ${totalBytes} bytes\n`);
