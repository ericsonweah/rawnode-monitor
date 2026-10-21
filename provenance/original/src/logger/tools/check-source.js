#!/usr/bin/env node
'use strict';

import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const ignored = new Set(['node_modules', '.git']);
const importPattern = /(?:import\s+(?:[^'";]*?\s+from\s+)?|export\s+[^'";]*?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, files);
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) files.push(absolute);
  }
  return files;
}

async function resolveRelative(importer, specifier) {
  if (!specifier.startsWith('.')) return true;
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [base, `${base}.js`, `${base}.mjs`, path.join(base, 'index.js')];
  for (const candidate of candidates) {
    try { await access(candidate); return true; } catch {}
  }
  return false;
}

function parseAll(files) {
  return new Promise((resolve, reject) => {
    const parser = path.join(root, 'tools/check-source-parser.js');
    const child = spawn(process.execPath, ['--experimental-vm-modules', parser], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) return reject(new Error(stderr || `Source parser exited with ${code}`));
      try { resolve(JSON.parse(stdout)); }
      catch (error) { reject(new Error(`Could not parse source-check output: ${error.message}\n${stdout}\n${stderr}`)); }
    });
    child.stdin.end(JSON.stringify(files));
  });
}

const files = (await walk(root)).sort();
const parsed = await parseAll(files);
const failures = parsed.failures.map((failure) => ({ type: 'syntax', ...failure }));

for (const file of files) {
  const source = await readFile(file, 'utf8');
  importPattern.lastIndex = 0;
  for (let match; (match = importPattern.exec(source));) {
    if (!(await resolveRelative(file, match[1]))) {
      failures.push({ type: 'import', file, specifier: match[1], message: 'Relative import target does not exist.' });
    }
  }
}

if (failures.length) {
  for (const failure of failures) {
    process.stderr.write(`${failure.type}: ${path.relative(root, failure.file)}${failure.specifier ? ` -> ${failure.specifier}` : ''}\n${failure.message || failure.stack || ''}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`Checked ${files.length} JavaScript modules and relative imports: OK\n`);
}
