import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [runtimeInput, cwdInput, outInput, ...requested] = process.argv.slice(2);
if (!runtimeInput || !cwdInput || !outInput) throw Error('Usage: node runtime-checks.mjs NODE PACKAGE LOG_DIR [build test basic types types-all guard]');
const runtime = await realpath(runtimeInput);
const cwd = await realpath(cwdInput);
const out = path.resolve(outInput);
await mkdir(out, { recursive: true });
const npmCli = path.resolve(path.dirname(runtime), '../lib/node_modules/npm/bin/npm-cli.js');
const compiler = await realpath('/usr/local/bin/tsc');
await readFile(npmCli);
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(?:NODE_OPTIONS|NODE_PATH|NODE_V8_COVERAGE|NODE_NO_WARNINGS|npm_config_)/i.test(key)) delete env[key];
env.PATH = `${path.dirname(runtime)}:${process.env.PATH}`;
env.npm_config_userconfig = path.join(out, 'empty-user.npmrc');
env.npm_config_globalconfig = path.join(out, 'empty-global.npmrc');
env.npm_config_cache = path.join(out, 'npm-cache');
env.npm_config_update_notifier = 'false';
await writeFile(env.npm_config_userconfig, '');
await writeFile(env.npm_config_globalconfig, '');
const version = spawnSync(runtime, ['--version'], { encoding: 'utf8', env });
assert.equal(version.status, 0);
const npmVersion = spawnSync(runtime, [npmCli, '--version'], { cwd, encoding: 'utf8', env });
assert.equal(npmVersion.status, 0);
const typeVersion = spawnSync(runtime, [compiler, '--version'], { encoding: 'utf8', env });
assert.equal(typeVersion.status, 0);
const manifest = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
const selectedFiles = (await readdir(path.join(cwd, 'test'))).filter(file => file.endsWith('.test.mjs')).sort();
assert.ok(selectedFiles.length);
const typeFlags = ['--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022'];
const commands = {
  build: [npmCli, '--offline', 'run', 'build'],
  test: [npmCli, '--offline', 'test'],
  basic: ['examples/basic.mjs'],
  types: [compiler, ...typeFlags, 'test/types.mts'],
  'types-all': [compiler, ...typeFlags, '--resolveJsonModule', 'test/exports-types.mts'],
  guard: [npmCli, '--offline', 'run', 'prepublishOnly'],
};
const receipt = { startedAt: new Date().toISOString(), runtime, runtimeVersion: version.stdout.trim(), npmCli, npmVersion: npmVersion.stdout.trim(), compiler, compilerVersion: typeVersion.stdout.trim(), compilerRuntime: version.stdout.trim(), platform: process.platform, arch: process.arch, cwd, manifest: { name: manifest.name, version: manifest.version, engines: manifest.engines }, packageManifestSha256: createHash('sha256').update(await readFile(path.join(cwd, 'package.json'))).digest('hex'), selectedFiles, commands: [] };
for (const leg of requested.length ? requested : Object.keys(commands)) {
  assert.ok(commands[leg], 'Unknown leg: ' + leg);
  const args = commands[leg];
  const started = Date.now();
  const child = spawn(runtime, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', timedOut = false, signal;
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {} }, 120_000);
  const exit = await new Promise(resolve => { child.once('error', error => { output += String(error); resolve(null); }); child.once('exit', (code, exitSignal) => { signal = exitSignal; resolve(code); }); });
  clearTimeout(timer);
  const result = { leg, command: [runtime, ...args], cwd, startedAt: new Date(started).toISOString(), milliseconds: Date.now() - started, exit, signal, timedOut, expectedExit: leg === 'guard' ? 1 : 0 };
  if (leg === 'test') {
    result.counts = Object.fromEntries(['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key, Number(new RegExp(`(?:^|\\n)[^\\n]*?\\b${key} (\\d+)(?:\\r?\\n|$)`).exec(output)?.[1] ?? NaN)]));
    result.summaryValid = result.counts.tests > 0 && result.counts.pass === result.counts.tests && ['fail', 'cancelled', 'skipped', 'todo'].every(key => result.counts[key] === 0);
  }
  if (leg === 'build') {
    try { result.build = JSON.parse(output.split('\n').find(line => line.startsWith('{"ok":'))); result.summaryValid = result.build.ok && result.build.node === receipt.runtimeVersion; }
    catch { result.summaryValid = false; }
  }
  if (leg === 'guard') result.summaryValid = output.includes('Publication blocked:');
  await writeFile(path.join(out, `${leg}.txt`), output);
  receipt.commands.push(result);
  receipt.ok = receipt.commands.every(row => row.exit === row.expectedExit && !row.timedOut && row.summaryValid !== false);
  await writeFile(path.join(out, 'commands.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, tail: output.slice(-800) }));
}
receipt.finishedAt = new Date().toISOString();
await writeFile(path.join(out, 'commands.json'), JSON.stringify(receipt, null, 2) + '\n');
if (!receipt.ok) process.exitCode = 1;
