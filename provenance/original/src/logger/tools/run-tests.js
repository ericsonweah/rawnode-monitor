#!/usr/bin/env node
'use strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function walk(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, files);
    else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(absolute);
  }
  return files;
}
const files = (await walk(path.resolve('tests'))).sort();
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit' });
child.once('close', (code) => { process.exitCode = code ?? 1; });
