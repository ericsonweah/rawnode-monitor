import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { constants } from 'node:fs';
const root = path.resolve('.');
const task = path.join(root, 'readiness-2026-10-21');
const distribution = JSON.parse(await readFile(path.join(task, 'distribution.json')));
assert.equal(createHash('sha256').update(await readFile(distribution.archive)).digest('hex'), distribution.sha256);
async function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: options.cwd || root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const start = Date.now();
  const timeout = setTimeout(() => child.kill('SIGTERM'), 180000);
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  clearTimeout(timeout);
  return { command: [command, ...args], cwd: options.cwd || root, milliseconds: Date.now() - start, exit, stdout, stderr };
}
// Keep the harness failure distinct: createRequire uses require conditions,
// while the package intentionally exposes an ESM-only root import target.
await copyFile(path.join(task, 'logs/distribution/overhead.stderr.txt'), path.join(task, 'logs/distribution/overhead-initial.stderr.txt'), constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error; });
const overhead = await run(process.execPath, ['--expose-gc', path.join(task, 'scripts/overhead.mjs'), distribution.installed.consumer]);
await writeFile(path.join(task, 'logs/distribution/overhead.stdout.txt'), overhead.stdout);
await writeFile(path.join(task, 'logs/distribution/overhead.stderr.txt'), overhead.stderr);
assert.equal(overhead.exit, 0, overhead.stderr);
await writeFile(path.join(task, 'overhead.json'), JSON.stringify({ sha256: distribution.sha256, ...JSON.parse(overhead.stdout), command: overhead.command, milliseconds: overhead.milliseconds }, null, 2) + '\n');
const legs = ['build', 'test', 'basic', 'types', 'types-all', 'guard'];
const results = [];
// Suite-level isolation avoids coupling deadline tests to three simultaneous
// builds/test runners on the same workstation. Each Node suite keeps its own
// normal test-file concurrency.
for (const [name, consumer] of Object.entries({ native: { package: path.join(root, 'package') }, extracted: distribution.extracted, installed: distribution.installed })) {
  const result = await run(process.execPath, [path.join(task, 'scripts/run-checks.mjs'), consumer.package, path.join(task, 'logs', 'final-' + name), ...legs]);
  console.log(JSON.stringify({ name, exit: result.exit, tail: result.stdout.slice(-1000), stderr: result.stderr }));
  results.push({ name, ...result });
}
await writeFile(path.join(task, 'consumer-checks.json'), JSON.stringify({ sha256: distribution.sha256, overhead: { exit: overhead.exit, command: overhead.command, milliseconds: overhead.milliseconds }, results }, null, 2) + '\n');
assert(results.every(result => result.exit === 0), 'One or more final consumer checks failed');
