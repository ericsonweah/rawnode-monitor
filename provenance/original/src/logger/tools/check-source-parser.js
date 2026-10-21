#!/usr/bin/env node
'use strict';

import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const files = JSON.parse(input || '[]');
const failures = [];

for (const file of files) {
  try {
    let source = await readFile(file, 'utf8');
    if (source.startsWith('#!')) source = source.replace(/^#![^\n]*(?:\n|$)/, '\n');
    new vm.SourceTextModule(source, { identifier: file });
  } catch (error) {
    failures.push({ file, message: error?.message || String(error), stack: error?.stack });
  }
}

process.stdout.write(JSON.stringify({ checked: files.length, failures }));
