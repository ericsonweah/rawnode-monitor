#!/usr/bin/env node
'use strict';
import { spawn } from 'node:child_process';
const child = spawn(process.env.TSC || 'tsc', ['-p', 'tsconfig.types.json'], { stdio: 'inherit', shell: process.platform === 'win32' });
child.once('error', (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.once('close', (code) => { process.exitCode = code ?? 1; });
