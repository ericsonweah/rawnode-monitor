'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(new URL('../..', import.meta.url).pathname);
const bin = path.join(root, 'bin/index.js');

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('CLI exposes version, doctor, health, levels, channels, and masked config', async () => {
  const version = await run(['version', '--json']);
  assert.equal(version.code, 0);
  assert.equal(JSON.parse(version.stdout).version, '1.1.0');

  const doctor = await run(['doctor', '--json']);
  assert.equal(doctor.code, 0, doctor.stderr || doctor.stdout);
  assert.equal(JSON.parse(doctor.stdout).ok, true);

  const health = await run(['health', '--json']);
  assert.equal(health.code, 0, health.stderr);
  assert.equal(JSON.parse(health.stdout).health.status, 'healthy');

  const levels = await run(['levels', '--json']);
  const definitions = JSON.parse(levels.stdout);
  assert.equal(definitions.length, 14);
  assert.equal(definitions[0].name, 'emergency');
  assert.equal(definitions.at(-1).name, 'important');

  const channels = await run(['channels', '--json']);
  assert.equal(JSON.parse(channels.stdout).default, 'stack');

  const config = await run(['config', '--json'], { LOG_AUDIT_SECRET: 'must-not-leak' });
  assert.equal(config.code, 0);
  assert.doesNotMatch(config.stdout, /must-not-leak/);
  assert.match(config.stdout, /\[REDACTED\]/);
});

test('CLI tail reads only the requested final records', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rawnode-logger-cli-'));
  const file = path.join(directory, 'application.log');
  await writeFile(file, 'one\ntwo\nthree\nfour\n');
  const result = await run(['tail', file, '--lines', '2']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'three\nfour');
});
