import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cwd = path.resolve(process.argv[2] || path.join(root, 'package'));
const destination = path.resolve(process.argv[3] || path.join(root, 'readiness-2026-10-21/logs/contract-audit'));
await mkdir(destination, { recursive: true });
const flags = ['--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022'];
const commands = [
  ['focused', 'node', ['--test', '--test-timeout=20000', 'test/alert-lifecycle.test.mjs', 'test/contracts-hardening.test.mjs']],
  ['types', 'tsc', [...flags, 'test/types.mts']],
  ['exports-types', 'tsc', [...flags, '--resolveJsonModule', 'test/exports-types.mts']],
];
const results = [];
for (const [leg, command, args] of commands) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 60_000 });
  await writeFile(path.join(destination, `${leg}.txt`), `${result.stdout || ''}${result.stderr || ''}${result.error ? String(result.error) : ''}`);
  results.push({ leg, command: [command, ...args], cwd, started: new Date(started).toISOString(), milliseconds: Date.now() - started, exit: result.status, signal: result.signal, error: result.error?.message || null });
}
await writeFile(path.join(destination, 'commands.json'), JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, typescript: spawnSync('tsc', ['--version'], { encoding: 'utf8' }).stdout.trim(), results }, null, 2) + '\n');
console.log(JSON.stringify(results));
if (results.some(result => result.exit !== 0)) process.exitCode = 1;
