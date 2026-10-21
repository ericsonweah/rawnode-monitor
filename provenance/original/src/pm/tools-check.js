#!/usr/bin/env node
'use strict';

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function walk(root, out = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(absolute, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(absolute);
  }
  return out;
}

function check(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ file, code, stderr }));
  });
}

const files = await walk(process.cwd());
const failures = [];
let cursor = 0;
await Promise.all(Array.from({ length: Math.min(8, files.length || 1) }, async () => {
  while (cursor < files.length) {
    const result = await check(files[cursor++]);
    if (result.code !== 0) failures.push(result);
  }
}));
if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure.file}\n${failure.stderr}\n`);
  process.exitCode = 1;
} else process.stdout.write(`Checked ${files.length} JavaScript files: OK\n`);
