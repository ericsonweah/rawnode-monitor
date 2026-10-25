import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const receiptPath = path.join(root, 'distribution.json');
const distribution = JSON.parse(await readFile(receiptPath, 'utf8'));
const pm = {
  archive: '/Users/ericsonweah/Documents/Codex/2026-10-02/task-3/artifacts/rawnode-pm-0.1.0.tgz',
  sha256: '0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f',
  bytes: 94_194,
};
const monitorBytes = await readFile(distribution.archive);
const monitor = { archive: distribution.archive, sha256: distribution.sha256, bytes: monitorBytes.length };
assert.equal(createHash('sha256').update(monitorBytes).digest('hex'), monitor.sha256);
const pmBytes = await readFile(pm.archive);
assert.equal(pmBytes.length, pm.bytes);
assert.equal(createHash('sha256').update(pmBytes).digest('hex'), pm.sha256);
const consumer = await realpath(distribution.installed.consumer);
assert.ok(consumer.startsWith('/private/tmp/') || consumer.startsWith('/tmp/'), 'Composition requires a task-owned temporary installed consumer.');
const packageRoot = await realpath(distribution.installed.package);
assert.equal(packageRoot, path.join(consumer, 'node_modules/@rawnode/monitor'));
const fixture = path.join(consumer, 'composition');
const logs = path.join(root, 'logs/pm-composition');
await mkdir(fixture, { recursive: true });
await mkdir(logs, { recursive: true });

const commands = [];
const configRoot = path.join(logs, 'npm-isolation');
await mkdir(configRoot, { recursive: true });
for (const name of ['user.npmrc', 'global.npmrc']) await writeFile(path.join(configRoot, name), '');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH'].includes(key)));
Object.assign(environment, { npm_config_userconfig: path.join(configRoot, 'user.npmrc'), npm_config_globalconfig: path.join(configRoot, 'global.npmrc'), npm_config_cache: path.join(configRoot, 'cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' });
async function run(leg, command, args, cwd, timeoutMs = 30_000) {
  const started = new Date();
  const child = spawn(command, args, { cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
  const exit = await new Promise(resolve => {
    child.once('error', error => { output += String(error); resolve(null); });
    child.once('exit', resolve);
  });
  clearTimeout(timer);
  const result = { leg, command: [command, ...args], cwd, started: started.toISOString(), milliseconds: Date.now() - started, exit, timedOut };
  commands.push(result);
  await writeFile(path.join(logs, `${leg}.txt`), output);
  await writeFile(path.join(logs, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
  console.log(JSON.stringify({ ...result, tail: output.slice(-2_000) }));
  assert.equal(timedOut, false, `${leg} timed out`);
  assert.equal(exit, 0, `${leg} failed; see ${logs}/${leg}.txt`);
  return output;
}

async function inventory(directory, prefix = '') {
  const output = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    if (item.isDirectory()) Object.assign(output, await inventory(path.join(directory, item.name), relative));
    else {
      assert.equal(item.isFile(), true, `Unexpected link/special package entry: ${relative}`);
      output[relative] = createHash('sha256').update(await readFile(path.join(directory, item.name))).digest('hex');
    }
  }
  return output;
}

const before = await inventory(packageRoot);
await run('npm-version', 'npm', ['--version'], consumer);
await run('typescript-version', 'tsc', ['--version'], consumer);
await run('install-pm', 'npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', path.join(consumer, '.composition-npm-cache'), pm.archive], consumer);
assert.deepEqual(await inventory(packageRoot), before, 'PM installation changed final installed Monitor package bytes.');
assert.deepEqual(await inventory(packageRoot), await inventory(distribution.extracted.package), 'Installed Monitor package differs from exact extraction.');
const pmRoot = await realpath(path.join(consumer, 'node_modules/@rawnode/pm'));
assert.equal(pmRoot, path.join(consumer, 'node_modules/@rawnode/pm'));
const pmManifest = JSON.parse(await readFile(path.join(pmRoot, 'package.json'), 'utf8'));
assert.equal(pmManifest.name, '@rawnode/pm');
assert.equal(pmManifest.version, '0.1.0');
assert.equal(pmManifest.engines.node, '>=20.19.0');
const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@rawnode/monitor');
const pins = { monitor, pm };
await writeFile(path.join(fixture, 'composition-pins.json'), JSON.stringify(pins, null, 2) + '\n');
const fixtureNames = ['pm-composition-direct.mjs', 'pm-composition.test.mjs', 'pm-worker.mjs', 'pm-consumer.mts'];
for (const name of fixtureNames) await copyFile(new URL(name, import.meta.url), path.join(fixture, name));
await run('resolution', process.execPath, ['--input-type=module', '-e', "import {fileURLToPath} from 'node:url'; import path from 'node:path'; const root=process.cwd(); for(const name of ['@rawnode/monitor','@rawnode/monitor/integrations','@rawnode/pm','@rawnode/pm/runtime']) { const url=import.meta.resolve(name); if(!fileURLToPath(url).startsWith(path.join(root,'node_modules')+path.sep)) throw Error('Unexpected resolution: '+url); console.log(name+' '+url); }"], consumer);
await run('direct', process.execPath, ['pm-composition-direct.mjs'], fixture);
const tests = await run('reciprocal', process.execPath, ['--test', '--test-timeout=15000', 'pm-composition.test.mjs'], fixture);
await run('paired-types', 'tsc', ['--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', 'pm-consumer.mts'], fixture);
assert.match(tests, /(?:tests 5|"tests":5)/);
assert.match(tests, /(?:pass 5|"pass":5)/);
assert.equal(createHash('sha256').update(await readFile(monitor.archive)).digest('hex'), monitor.sha256);
await writeFile(path.join(root, 'pm-composition.json'), JSON.stringify({
  ok: true, node: process.version, monitor: { ...monitor, name: manifest.name, version: manifest.version },
  pm: { ...pm, name: pmManifest.name, version: pmManifest.version, engines: pmManifest.engines }, consumer, fixture,
  monitorPackageUnchangedByPmInstall: true, monitorMatchesExactExtraction: true,
  shapes: ['direct', 'runtime', 'adapter', 'RuntimeAgent'], reciprocal: { tests: 5, passed: 5, failed: 0, cancelled: 0, skipped: 0, realChildIpc: true, naturalChildExit: true, childBinaryIdentityChecked: true, borrowedPmResourcePreserved: true },
  returnedAndDiskDiagnosticRedaction: true, processListenerCountsUnchanged: true, pairedStrictTypes: true,
  fixtureSources: await Promise.all(fixtureNames.map(async name => ({ path: `scripts/${name}`, sha256: createHash('sha256').update(await readFile(new URL(name, import.meta.url))).digest('hex') }))),
  scope: 'Fresh installed exact Monitor archive and accepted PM archive. Synthetic telemetry only; one task-owned PM child, no daemon, live backend, app or sibling edits.',
  historicalAttribution: 'PM 47 native/47 packed tests remain historical PM-lane results and were not rerun or counted as Monitor tests.',
  commands: path.relative(root, path.join(logs, 'commands.json')),
}, null, 2) + '\n');
