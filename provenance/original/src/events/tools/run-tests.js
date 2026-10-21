#!/usr/bin/env node
'use strict';

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

async function walk(directory, output = []) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return output; throw error; }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(absolute, output);
    else if (entry.isFile() && entry.name.endsWith('.test.js')) output.push(absolute);
  }
  return output;
}

const files = (await walk(path.resolve('tests'))).sort();
if (!files.length) throw new Error('No event tests were discovered');
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit' });
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
