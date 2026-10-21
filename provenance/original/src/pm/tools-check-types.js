#!/usr/bin/env node
'use strict';

import { access, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const declarations = new Set();

for (const entry of Object.values(pkg.exports || {})) {
  if (entry && typeof entry === 'object' && typeof entry.types === 'string') declarations.add(entry.types);
}
if (typeof pkg.types === 'string') declarations.add(pkg.types);
if (!declarations.size) throw new Error('package.json must publish at least one declaration file.');

for (const relative of declarations) {
  await access(path.join(root, relative.replace(/^\.\//, '')));
}

const source = await readFile(path.join(root, 'types/index.d.ts'), 'utf8');
for (const required of [
  'ProcessDefinition',
  'ProcessManager',
  'Supervisor',
  'ControlClient',
  'RuntimeAgent',
  'RawNodeRuntimeAdapter',
  'StartupGenerator',
]) {
  if (!new RegExp(`export\\s+(?:declare\\s+)?class\\s+${required}\\b`).test(source)) {
    throw new Error(`Missing public declaration for ${required}.`);
  }
}

const result = await new Promise((resolve) => {
  const child = spawn('tsc', ['-p', 'tsconfig.types.json'], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.once('error', (error) => resolve(error?.code === 'ENOENT' ? { skipped: true } : { error }));
  child.once('exit', (code) => resolve({ code }));
});

if (result.error) throw result.error;
if (result.code != null && result.code !== 0) process.exitCode = result.code;
else process.stdout.write(`Checked ${declarations.size} declaration target(s)${result.skipped ? ' (TypeScript compiler unavailable; structural checks only)' : ': OK'}\n`);
