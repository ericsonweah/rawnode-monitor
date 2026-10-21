#!/usr/bin/env node
'use strict';
import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const fields = ['dependencies', 'optionalDependencies', 'peerDependencies'];
const violations = fields.filter((field) => pkg[field] && Object.keys(pkg[field]).length);
if (violations.length) {
  process.stderr.write(`Zero-dependency contract violated by: ${violations.join(', ')}\n`);
  process.exitCode = 2;
} else process.stdout.write('Zero-dependency contract: OK\n');
