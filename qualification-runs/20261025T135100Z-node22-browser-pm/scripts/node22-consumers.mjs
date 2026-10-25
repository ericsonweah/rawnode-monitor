import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, copyFile, readdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

assert.equal(process.version, 'v22.0.0', 'Run this harness using the exact declared floor.');
const runRoot = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(runRoot, 'node22-final');
const finalReceipt = path.join(runRoot, 'final/distribution.json');
const original = JSON.parse(await readFile(finalReceipt, 'utf8'));
const archiveBytes = await readFile(original.archive);
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(hash(archiveBytes), original.sha256);
assert.equal(archiveBytes.length, original.bytes);
await mkdir(path.join(out, 'logs/distribution'), { recursive: true });
await mkdir(path.join(out, 'scripts'), { recursive: true });
const config = path.join(out, 'npm-isolation');
await mkdir(config, { recursive: true });
for (const file of ['user.npmrc', 'global.npmrc']) await writeFile(path.join(config, file), '');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH', 'NODE_V8_COVERAGE', 'NODE_NO_WARNINGS'].includes(key)));
Object.assign(env, { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, npm_config_userconfig: path.join(config, 'user.npmrc'), npm_config_globalconfig: path.join(config, 'global.npmrc'), npm_config_cache: path.join(config, 'cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' });
const npmCli = path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
const compiler = await realpath('/usr/local/bin/tsc');
const commands = [];
async function run(name, command, args, cwd) {
  const started = Date.now();
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGTERM'); } catch {} }, 120_000);
  const { exit, signal } = await new Promise(resolve => { child.once('error', error => { stderr += String(error); resolve({ exit: null, signal: null }); }); child.once('exit', (exit, signal) => resolve({ exit, signal })); });
  clearTimeout(timer);
  const row = { name, command: [command, ...args], cwd, startedAt: new Date(started).toISOString(), milliseconds: Date.now() - started, exit, signal, timedOut };
  commands.push(row);
  await writeFile(path.join(out, 'logs/distribution', `${name}.stdout.txt`), stdout);
  await writeFile(path.join(out, 'logs/distribution', `${name}.stderr.txt`), stderr);
  await writeFile(path.join(out, 'distribution-commands.json'), JSON.stringify(commands, null, 2) + '\n');
  assert.equal(timedOut, false, name);
  assert.equal(exit, 0, `${name}: ${stderr}`);
  console.log(JSON.stringify(row));
  return stdout;
}
const work = await mkdtemp('/private/tmp/rawnode-monitor-node22-consumers-');
const extracted = { consumer: path.join(work, 'extracted'), package: path.join(work, 'extracted/node_modules/@rawnode/monitor') };
const installed = { consumer: path.join(work, 'installed'), package: path.join(work, 'installed/node_modules/@rawnode/monitor') };
for (const consumer of [extracted, installed]) {
  await mkdir(consumer.consumer, { recursive: true });
  await writeFile(path.join(consumer.consumer, 'package.json'), JSON.stringify({ name: 'node22-qualification-consumer', private: true, type: 'module' }) + '\n');
}
await mkdir(extracted.package, { recursive: true });
await run('extract', '/usr/bin/tar', ['-xzf', original.archive, '--strip-components=1', '-C', extracted.package], work);
const npmVersion = (await run('npm-version', process.execPath, [npmCli, '--version'], work)).trim();
const compilerVersion = (await run('typescript-version', process.execPath, [compiler, '--version'], work)).trim();
await run('install', process.execPath, [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save-exact', original.archive], installed.consumer);
async function files(directory, prefix = '') {
  const list = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) list.push(...await files(path.join(directory, entry.name), relative));
    else { assert(entry.isFile(), `Unexpected link or special entry: ${relative}`); list.push(relative); }
  }
  return list.sort();
}
const entries = original.inventory.map(row => row.path).sort();
for (const consumer of [extracted, installed]) {
  assert.equal((await lstat(consumer.package)).isSymbolicLink(), false);
  assert.equal(await realpath(consumer.package), consumer.package);
  assert.deepEqual(await files(consumer.package), entries);
  for (const row of original.inventory) {
    assert.equal(hash(await readFile(path.join(consumer.package, row.path))), row.sha256, row.path);
    assert.equal((await lstat(path.join(consumer.package, row.path))).mode & 0o777, row.modes.archive, row.path);
  }
  for (const file of ['imports.mjs', 'types.mts', 'exports-types.mts']) await copyFile(path.join(original.extracted.consumer, file), path.join(consumer.consumer, file));
}
const receipt = { ...original, sourceDistributionReceipt: finalReceipt, packingNode: original.node, packingExecPath: original.execPath, packingTooling: original.tooling, tooling: { node: { executable: process.execPath, version: process.version }, npm: { executable: npmCli, version: npmVersion, executionRuntime: process.version }, tsc: { executable: compiler, version: compilerVersion, executionRuntime: process.version } }, node: process.version, execPath: process.execPath, npmCli, npmVersion, compiler, compilerVersion, compilerRuntime: process.version, platform: process.platform, arch: process.arch, extracted, installed, consumerPackageFilesVerified: entries.length, checkedAgainstFinalArchiveInventory: true, npmIsolation: { config, offline: true, installScriptsDisabled: true, nodeOptionsRemoved: true }, commands: path.join(out, 'distribution-commands.json') };
await writeFile(path.join(out, 'distribution.json'), JSON.stringify(receipt, null, 2) + '\n');
const typeFlags = ['--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--resolveJsonModule'];
for (const [name, consumer] of Object.entries({ extracted, installed })) {
  const imports = JSON.parse(await run(`${name}-imports`, process.execPath, ['imports.mjs'], consumer.consumer));
  assert.equal(imports.node, process.version); assert.equal(imports.entries, 29); assert.equal(imports.executable, 28); assert.equal(imports.rootNames, 189);
  for (const source of ['types.mts', 'exports-types.mts']) await run(`${name}-${source}`, process.execPath, [compiler, ...typeFlags, source], consumer.consumer);
}
for (const name of ['studio-final-smoke.mjs', 'ingest-auth-final-smoke.mjs', 'pm-composition-direct.mjs', 'pm-composition.test.mjs', 'pm-worker.mjs', 'pm-consumer.mts']) await copyFile(path.join(runRoot, 'final/scripts', name), path.join(out, 'scripts', name));
// Retarget only the external harness: npm/TypeScript and all nested processes
// execute under the selected floor binary; installed package bytes stay intact.
let pmRunner = await readFile(path.join(runRoot, 'final/scripts/run-pm-composition.mjs'), 'utf8');
pmRunner = pmRunner.replace("const commands = [];", "const commands = [];\nconst npmCli = path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');\nconst compiler = await realpath('/usr/local/bin/tsc');");
pmRunner = pmRunner.replace("Object.assign(environment, { npm_config_userconfig:", "Object.assign(environment, { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, npm_config_userconfig:");
pmRunner = pmRunner.replace("'npm-version', 'npm', ['--version']", "'npm-version', process.execPath, [npmCli, '--version']");
pmRunner = pmRunner.replace("'typescript-version', 'tsc', ['--version']", "'typescript-version', process.execPath, [compiler, '--version']");
pmRunner = pmRunner.replace("'install-pm', 'npm', ['install'", "'install-pm', process.execPath, [npmCli, 'install'");
pmRunner = pmRunner.replace("'paired-types', 'tsc', ['--noEmit'", "'paired-types', process.execPath, [compiler, '--noEmit'");
assert(!pmRunner.includes("'install-pm', 'npm'") && !pmRunner.includes("'paired-types', 'tsc'"));
await writeFile(path.join(out, 'scripts/run-pm-composition.mjs'), pmRunner);
assert.equal(hash(await readFile(original.archive)), original.sha256);
await writeFile(path.join(out, 'distribution-checks.json'), JSON.stringify({ ok: true, runtime: process.version, execPath: process.execPath, sha256: original.sha256, files: entries.length, extracted, installed, commands }, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, sha256: original.sha256, extracted, installed }));
