import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve('.');
const task = path.join(root, 'readiness-2026-10-24/final');
const logs = path.join(task, 'logs', 'distribution');
await mkdir(logs, { recursive: true });
const commands = [];
async function run(name, command, args, cwd, expected = 0) {
  const start = Date.now();
  const child = spawn(command, args, { cwd, env: { ...process.env, npm_config_cache: path.join(task, 'npm-cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 120_000);
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  clearTimeout(timeout);
  const record = { name, command: [command, ...args], cwd, exit, expected, milliseconds: Date.now() - start };
  commands.push(record);
  await writeFile(path.join(logs, name + '.stdout.txt'), stdout);
  await writeFile(path.join(logs, name + '.stderr.txt'), stderr);
  await writeFile(path.join(logs, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
  assert.equal(exit, expected, name + ': ' + stderr + stdout.slice(-1000));
  return stdout;
}
const packOutput = await run('pack', 'npm', ['pack', '--offline', '--json', '--pack-destination', path.join(task, 'artifacts')], path.join(root, 'package'));
// prepack writes its own JSON check receipt before npm's JSON array.
const pack = JSON.parse(packOutput.slice(packOutput.indexOf('[\n')))[0];
const archive = path.join(task, 'artifacts', pack.filename);
const bytes = await readFile(archive);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const work = await mkdtemp('/private/tmp/rawnode-monitor-readiness-');
const extracted = { consumer: path.join(work, 'extracted'), package: path.join(work, 'extracted/node_modules/@rawnode/monitor') };
const installed = { consumer: path.join(work, 'installed'), package: path.join(work, 'installed/node_modules/@rawnode/monitor') };
for (const consumer of [extracted, installed]) {
  await mkdir(consumer.consumer, { recursive: true });
  await writeFile(path.join(consumer.consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', name: 'readiness-consumer' }) + '\n');
}
await mkdir(extracted.package, { recursive: true });
await run('extract', 'tar', ['-xzf', archive, '--strip-components=1', '-C', extracted.package], work);
await run('install', 'npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--save-exact', archive], installed.consumer);
const manifest = JSON.parse(await readFile(path.join(installed.package, 'package.json')));
assert.equal(manifest.name, '@rawnode/monitor'); assert.equal(manifest.version, '1.0.0');
assert.equal(manifest.private, true); assert.equal(manifest.license, 'UNLICENSED'); assert.equal(manifest.author, 'First Principle Lab LLC');
assert.equal(Object.keys(manifest.exports).length, 29);
for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) assert.equal(Object.keys(manifest[key] || {}).length, 0);
assert.equal((await lstat(installed.package)).isSymbolicLink(), false);
assert.equal(await realpath(installed.package), installed.package);
const inventory = [];
for (const entry of pack.files) {
  assert(!entry.path.startsWith('/') && !entry.path.split('/').includes('..'));
  const source = await readFile(path.join(root, 'package', entry.path));
  const extractedBytes = await readFile(path.join(extracted.package, entry.path));
  const installedBytes = await readFile(path.join(installed.package, entry.path));
  assert(source.equals(extractedBytes), 'checkout/archive mismatch: ' + entry.path);
  assert(source.equals(installedBytes), 'checkout/install mismatch: ' + entry.path);
  inventory.push({ path: entry.path, bytes: source.length, sha256: createHash('sha256').update(source).digest('hex') });
}
const unexpected = inventory.filter(entry => /(?:^|\/)(?:node_modules|\.env(?:\..*)?|\.git|\.DS_Store|id_rsa|id_ed25519)(?:\/|$)|\.(?:tgz|pem|key)$/.test(entry.path));
assert.deepEqual(unexpected, []);
const machinePaths = [];
const suspiciousImports = [];
const credentialPatterns = [];
for (const entry of inventory) {
  const source = await readFile(path.join(installed.package, entry.path), 'utf8');
  if (/\/Users\/|\/home\/|rawnode-monitor-standalone-candidate-codex/.test(source)) machinePaths.push(entry.path);
  if (/\b(?:AKIA[0-9A-Z]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)\b/.test(source)) credentialPatterns.push(entry.path);
  if (/\.(?:js|mjs)$/.test(entry.path) && /(?:from\s*|import\s*\()['"](?:#monitor|#foundation|[^'"]*www\.firstprinciplelab\.com)/.test(source)) suspiciousImports.push(entry.path);
}
assert.deepEqual(machinePaths, []); assert.deepEqual(credentialPatterns, []); assert.deepEqual(suspiciousImports, []);
for (const required of ['src/index.js', 'types/index.d.ts', 'config/monitor.js', 'resources/assets/js/monitor/studio.js', 'resources/assets/css/monitor/studio.css', 'docs/API.md', 'examples/basic.mjs', 'examples/studio-fixture.mjs', 'test/readiness-lifecycle.test.mjs', 'test/exports-types.mts']) assert(inventory.some(entry => entry.path === required));
const consumerScript = `import assert from 'node:assert/strict';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const pkg=JSON.parse(await readFile(new URL('./node_modules/@rawnode/monitor/package.json',import.meta.url)));
const base=await realpath(fileURLToPath(new URL('./node_modules/@rawnode/monitor/',import.meta.url)));
const rows=[];
for(const entry of Object.keys(pkg.exports)){
 const spec='@rawnode/monitor'+(entry==='.'?'':entry.slice(1));
 const resolved=import.meta.resolve(spec);assert(fileURLToPath(resolved).startsWith(base+'/'));
 const module=entry==='./package.json'?await import(spec,{with:{type:'json'}}):await import(spec);
 if(entry==='.') {assert.equal(module.default,module.MonitorRuntime);assert.equal(Object.keys(module).length,189);}
 if(entry==='./studio/client'){assert.equal(typeof document,'undefined');assert.equal(typeof module.mountMonitorStudio,'function');}
 rows.push({entry,resolved,symbols:Object.keys(module).length});
}
await assert.rejects(import('@rawnode/monitor/src/index.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
console.log(JSON.stringify({ok:true,node:process.version,entries:rows.length,executable:rows.length-1,rootNames:189,domFreeStudioClient:true,privateDeepImportRejected:true,rows},null,2));
`;
for (const consumer of [extracted, installed]) {
  await writeFile(path.join(consumer.consumer, 'imports.mjs'), consumerScript);
  // Place type consumers outside the package so its self-reference cannot hide installation errors.
  await writeFile(path.join(consumer.consumer, 'types.mts'), await readFile(path.join(consumer.package, 'test/types.mts')));
  await writeFile(path.join(consumer.consumer, 'exports-types.mts'), await readFile(path.join(consumer.package, 'test/exports-types.mts')));
}
const receipt = { archive, sha256, bytes: bytes.length, package: manifest.name, version: manifest.version, packedFiles: inventory.length, node: process.version, pack, extracted, installed, inventory,
  inspection: { machinePaths, suspiciousImports, credentialPatterns, unexpected, scope: 'path/native-import/known-private-key-pattern checks; not a universal secret detector' } };
await writeFile(path.join(task, 'distribution.json'), JSON.stringify(receipt, null, 2) + '\n');
for (const [name, consumer] of Object.entries({ extracted, installed })) {
  await run(name + '-imports', 'node', ['imports.mjs'], consumer.consumer);
  for (const source of ['types.mts', 'exports-types.mts']) await run(name + '-' + source, 'tsc', ['--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--resolveJsonModule', source], consumer.consumer);
}
await run('overhead', 'node', ['--expose-gc', path.join(task, 'scripts/overhead.mjs'), installed.consumer], work);
await writeFile(path.join(task, 'distribution-checks.json'), JSON.stringify({ ok: true, sha256, commands }, null, 2) + '\n');
console.log(JSON.stringify({ archive, sha256, bytes: bytes.length, packedFiles: inventory.length, extracted, installed }));
