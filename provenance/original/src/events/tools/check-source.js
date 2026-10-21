#!/usr/bin/env node
'use strict';

import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const ignored = new Set(['node_modules', '.git', 'coverage', '.rawnode']);
const extensions = new Set(['.js', '.mjs']);
const importPattern = /(?:\bimport\s*(?:[^'"()]*?\sfrom\s*)?|\bexport\s+[^'"]*?\sfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g;

async function walk(directory, output = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, output);
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) output.push(absolute);
  }
  return output;
}

function syntax(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('close', (code) => resolve({ file, code, stderr }));
  });
}

async function exists(file) { try { await access(file); return true; } catch { return false; } }
async function resolveRelative(importer, specifier) {
  if (!specifier.startsWith('.')) return true;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(base) ? [base] : [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')];
  for (const candidate of candidates) if (await exists(candidate)) return true;
  return false;
}

const files = (await walk(root)).sort();
const failures = [];
let cursor = 0;
const concurrency = Math.max(1, Math.min(8, Number(process.env.CHECK_CONCURRENCY) || 4));
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < files.length) {
    const result = await syntax(files[cursor++]);
    if (result.code !== 0) failures.push({ type: 'syntax', ...result });
  }
}));

for (const file of files) {
  const source = await readFile(file, 'utf8');
  importPattern.lastIndex = 0;
  for (let match; (match = importPattern.exec(source));) {
    if (!(await resolveRelative(file, match[1]))) failures.push({ type: 'import', file, specifier: match[1] });
  }
}

if (failures.length) {
  for (const failure of failures) {
    process.stderr.write(`${failure.type}: ${path.relative(root, failure.file)}${failure.specifier ? ` -> ${failure.specifier}` : ''}\n${failure.stderr || ''}`);
  }
  process.exitCode = 1;
} else process.stdout.write(`Checked ${files.length} JavaScript modules and relative imports: OK\n`);
