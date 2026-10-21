#!/usr/bin/env node
'use strict';
import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const groups = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const violations = groups.filter((group) => pkg[group] && Object.keys(pkg[group]).length > 0);
if (violations.length) {
  process.stderr.write(`Zero-dependency contract violated by: ${violations.join(', ')}\n`);
  process.exitCode = 2;
} else process.stdout.write('Zero-dependency contract: OK\n');
