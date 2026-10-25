import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

// Run after final packaging, consumer checks and composition/security receipts.
// Optional argument: evidence directory containing the final distribution.json.
const repository = path.resolve('.');
const task = path.join(repository, 'qualification-runs/20261025T135100Z-node22-browser-pm');
const evidence = path.resolve(process.argv[2] || task);
assert.ok(evidence === task || evidence.startsWith(task + path.sep), 'Final evidence must be inside this task directory.');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: repository, encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  return result.stdout;
};
const initial = await json(path.join(task, 'inputs.json'));
assert.ok(Object.keys(initial.immutable).length >= 1530);
run(process.execPath, [path.join(task, 'scripts/audit-inputs.mjs'), path.join(evidence, 'inputs-final.json')]);
const current = await json(path.join(evidence, 'inputs-final.json'));
assert.deepEqual(current.immutable, initial.immutable, 'Historical/prior evidence, archives, provenance or instructions changed.');
assert.deepEqual(current.pm, initial.pm, 'Accepted PM input changed.');
assert.equal(current.preservedOriginalFiles, 866);
assert.equal(current.historicalCandidateFiles, 169);
assert.deepEqual(current.originalMismatches, []);

const baseline = await json(path.join(task, 'baseline.json'));
const finalGit = { head: run('git', ['rev-parse', 'HEAD']), branch: run('git', ['branch', '--show-current']), index: run('git', ['diff', '--cached', '--binary']), status: run('git', ['status', '--short']) };
assert.equal(finalGit.head, baseline.git.head.stdout);
assert.equal(finalGit.branch, baseline.git.branch.stdout);
assert.equal(finalGit.index, baseline.git.index.stdout, 'Index changed');
const distribution = await json(path.join(evidence, 'distribution.json'));
const archive = await readFile(distribution.archive);
assert.equal(hash(archive), distribution.sha256, 'Final archive changed.');
assert.equal(archive.length, distribution.bytes);
assert.equal(hash(await readFile(distribution.repeat.archive)), distribution.sha256);
assert.equal(distribution.repeat.exactByteMatch, true);
const expected = new Map(distribution.inventory.map(item => [item.path, { bytes: item.bytes, sha256: item.sha256 }]));
assert.equal(expected.size, distribution.inventory.length, 'Duplicate inventory paths.');
assert.equal(expected.size, distribution.packedFiles);
assert.deepEqual([...expected.keys()].sort(), distribution.pack.files.map(item => item.path).sort());
for (const [entry] of expected) assert.ok(!entry.startsWith('/') && !entry.split('/').includes('..'), 'Unsafe inventory path: ' + entry);

async function inventory(directory, prefix = '') {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) entries.push(...await inventory(absolute, relative));
    else {
      assert.equal(item.isFile(), true, 'Unexpected link/special file: ' + absolute);
      const bytes = await readFile(absolute);
      entries.push([relative, { bytes: bytes.length, sha256: hash(bytes) }]);
    }
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

const temporary = await mkdtemp(path.join(os.tmpdir(), 'monitor-final-audit-'));
let historicalCount;
try {
  const archiveEntries = run('tar', ['-tzf', distribution.archive]).trim().split('\n');
  assert.equal(archiveEntries.length, expected.size);
  for (const entry of archiveEntries) assert.ok(entry.startsWith('package/') && !entry.split('/').includes('..'), 'Unsafe archive entry: ' + entry);
  run('tar', ['-xzf', distribution.archive, '-C', temporary]);
  const exact = await inventory(path.join(temporary, 'package'));
  assert.deepEqual(exact, [...expected].sort(([left], [right]) => left.localeCompare(right)), 'Fresh archive extraction differs from recorded inventory.');
  for (const [name, consumer] of Object.entries({ extracted: distribution.extracted, installed: distribution.installed })) {
    const owner = await realpath(consumer.consumer);
    const packageRoot = await realpath(consumer.package);
    assert.ok(owner.startsWith('/private/tmp/') || owner.startsWith('/tmp/'), name + ' must be a task-owned temporary consumer.');
    assert.equal(packageRoot, path.join(owner, 'node_modules/@rawnode/monitor'));
    assert.deepEqual(await inventory(packageRoot), exact, name + ' package differs from archive.');
  }
  for (const [relative, record] of exact) {
    const source = await readFile(path.join(repository, 'package', relative));
    assert.equal(source.length, record.bytes, 'Source size drift: ' + relative);
    assert.equal(hash(source), record.sha256, 'Source hash drift: ' + relative);
  }
  await mkdir(path.join(temporary, 'historical'));
  run('tar', ['-xzf', path.join(repository, 'artifacts/rawnode-monitor-1.0.0.tgz'), '-C', path.join(temporary, 'historical')]);
  const historical = await json(path.join(repository, 'evidence/candidate-inventory.json'));
  for (const entry of historical.files) {
    const bytes = await readFile(path.join(temporary, 'historical/package', entry.path));
    assert.equal(hash(bytes), entry.sha256, 'Historical candidate inventory: ' + entry.path);
    assert.equal(bytes.length, entry.bytes);
  }
  historicalCount = historical.files.length;
} finally {
  await rm(temporary, { recursive: true, force: true });
}

const manifest = await json(path.join(repository, 'package/package.json'));
assert.equal(manifest.name, '@rawnode/monitor');
assert.equal(manifest.version, '1.0.0');
assert.equal(manifest.private, true);
assert.equal(manifest.license, 'Apache-2.0');
assert.deepEqual(manifest.author, { name: 'FIRST PRINCIPLE LAB, LLC', email: 'rawnode@firstprinciplelab.com', url: 'https://firstprinciplelab.com' });
assert.equal(manifest.type, 'module');
assert.equal(manifest.engines.node, '>=22');
assert.equal(manifest.scripts.prepublishOnly, 'node scripts/reject-publication.mjs');
for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies', 'workspaces']) assert.equal(Object.keys(manifest[key] || {}).length, 0);
assert.equal(Object.keys(manifest.exports).length, 29);
assert.equal(Object.values(manifest.exports).filter(entry => typeof entry === 'object' && entry.import).length, 28);
assert.equal(Object.keys(manifest.exports).some(key => key.includes('*')), false);
const license = await readFile('package/LICENSE', 'utf8');
const notice = await readFile('package/NOTICE.md', 'utf8');
assert.match(license, /Apache License/);
assert.match(license, /Version 2\.0, January 2004/);
assert.match(notice, /FIRST PRINCIPLE LAB, LLC/);
assert.match(await readFile('package/scripts/reject-publication.mjs', 'utf8'), /process.exitCode = 1/);

function counts(output) {
  const result = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...output.matchAll(new RegExp('(?:ℹ|#) ' + key + ' (\\d+)', 'g'))];
    assert.equal(matches.length, 1, 'Expected one test summary for ' + key);
    result[key] = Number(matches[0][1]);
  }
  assert.ok(result.tests > 0);
  assert.equal(result.tests, result.pass);
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(result[key], 0);
  return result;
}

const suites = {};
const builds = {};
for (const name of ['native', 'extracted', 'installed']) {
  const directory = path.join(evidence, 'logs', 'final-' + name);
  suites[name] = counts(await readFile(path.join(directory, 'test.txt'), 'utf8'));
  const commands = await json(path.join(directory, 'commands.json'));
  assert.deepEqual(commands.map(command => command.leg).sort(), ['build', 'test', 'basic', 'types', 'types-all', 'guard'].sort());
  for (const command of commands) {
    assert.equal(command.exit, command.leg === 'guard' ? 1 : 0, name + ': ' + command.leg);
    assert.equal(command.exit, command.expectedExit);
    assert.equal(command.timedOut, false);
  }
  assert.match(await readFile(path.join(directory, 'guard.txt'), 'utf8'), /Publication blocked/);
  const build = await readFile(path.join(directory, 'build.txt'), 'utf8');
  builds[name] = JSON.parse(build.split('\n').find(line => line.startsWith('{"ok":')));
  assert.equal(builds[name].ok, true);
  assert.equal(builds[name].checkedJavaScript, 112);
  assert.equal(builds[name].exports, 29);
}
assert.deepEqual(suites.native, suites.extracted);
assert.deepEqual(suites.native, suites.installed);
const consumerChecks = await json(path.join(evidence, 'consumer-checks.json'));
assert.equal(consumerChecks.sha256, distribution.sha256);
assert.deepEqual(consumerChecks.results.map(result => result.name).sort(), ['extracted', 'installed', 'native']);
for (const result of consumerChecks.results) assert.equal(result.exit, 0);
const distributionCommands = await json(path.join(evidence, 'logs/distribution/commands.json'));
for (const command of distributionCommands) assert.equal(command.exit, command.expected ?? 0, 'Distribution: ' + command.name);

const imports = {};
for (const name of ['extracted', 'installed']) {
  const receipt = await json(path.join(evidence, 'logs/distribution', name + '-imports.stdout.txt'));
  assert.equal(receipt.ok, true);
  assert.equal(receipt.entries, 29);
  assert.equal(receipt.executable, 28);
  assert.equal(receipt.rootNames, 189);
  assert.equal(receipt.domFreeStudioClient, true);
  assert.equal(receipt.privateDeepImportRejected, true);
  assert.deepEqual(receipt.rows.map(row => row.entry).sort(), Object.keys(manifest.exports).sort());
  const packageRoot = await realpath(distribution[name].package);
  for (const row of receipt.rows) assert.ok(fileURLToPath(row.resolved).startsWith(packageRoot + path.sep), 'Export resolved outside consumer: ' + row.entry);
  imports[name] = { entries: receipt.entries, executable: receipt.executable, rootNames: receipt.rootNames, domFreeStudioClient: true, privateDeepImportRejected: true };
}

const pm = await json(path.join(evidence, 'pm-composition.json'));
assert.equal(pm.ok, true);
assert.equal(pm.monitor.sha256, distribution.sha256);
assert.equal(pm.pm.sha256, '0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f');
assert.equal(pm.pm.bytes, 94_194);
assert.equal(pm.monitorPackageUnchangedByPmInstall, true);
assert.equal(pm.monitorMatchesExactExtraction, true);
assert.equal(pm.pairedStrictTypes, true);
assert.equal(pm.returnedAndDiskDiagnosticRedaction, true);
assert.equal(pm.processListenerCountsUnchanged, true);
assert.deepEqual(counts(await readFile(path.join(evidence, 'logs/pm-composition/reciprocal.txt'), 'utf8')), { tests: 5, pass: 5, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
for (const command of await json(path.join(evidence, 'logs/pm-composition/commands.json'))) {
  assert.equal(command.exit, 0);
  assert.equal(command.timedOut, false);
}
const studio = await json(path.join(evidence, 'studio-final-smoke.json'));
assert.equal(studio.status, 'passed');
assert.equal(studio.distribution.sha256, distribution.sha256);
const ingest = await json(path.join(evidence, 'ingest-auth-final-smoke.json'));
assert.equal(ingest.status, 'passed');
assert.equal(ingest.sha256, distribution.sha256);
for (const receipt of [studio, ingest]) {
  assert.equal(receipt.checks.length, receipt.checkCount);
  for (const check of receipt.checks) assert.equal(check.passed, true);
}
const sourceInventory = await inventory(path.join(repository, 'package'));
assert.deepEqual(sourceInventory, [...expected].sort(([left], [right]) => left.localeCompare(right)), 'Complete source inventory differs from archive');
const before = new Map(baseline.packageSource.map(item => [item.path, item]));
const changedFromOct25 = sourceInventory.filter(([name, entry]) => before.get(name)?.sha256 !== entry.sha256).map(([name, entry]) => ({ path: name, ...entry, beforeSha256: before.get(name)?.sha256 || null }));
assert(changedFromOct25.every(entry => !/^(?:src|types|resources|config|test|examples)\//.test(entry.path)), 'Runtime/behavioral payload changed in legal-only final artifact');
const regressionMap = await json(path.join(task, 'seven-regressions.json'));
assert.equal(regressionMap.count, 7);
for (const item of regressionMap.cases) assert.equal(hash(await readFile(path.join(repository, 'package', item.file))), item.sha256);
await writeFile(path.join(evidence, 'source-final.json'), JSON.stringify({ complete: true, files: sourceInventory.map(([path, entry]) => ({ path, ...entry })), changedFromOct25, sevenRegressionsUnchanged: true }, null, 2) + '\n');
run('git', ['diff', '--check']);
const receipt = {
  ok: true, checkedAt: new Date().toISOString(), sha256: distribution.sha256, bytes: distribution.bytes,
  packedFiles: distribution.packedFiles, suites, builds, imports, finalGit, changedFromOct25, sevenRegressionsUnchanged: true, repeatPackExactByteMatch: true,
  originalFileHashesUnchanged: current.preservedOriginalFiles, historicalCandidateFileHashesMatched: historicalCount,
  immutableFilesUnchanged: Object.keys(current.immutable).length,
  packageCheckoutFreshExtractionPriorExtractionInstallationMatch: true,
  privateApacheOwnershipDependenciesEngineAndGuardPreserved: true,
  pmReciprocal: pm.reciprocal, pairedStrictTypes: true,
  studioHttpSseChecks: studio.checkCount, ingestionAndTokenSecurityChecks: ingest.checkCount,
  realBrowser: 'Separately recorded browser acceptance evidence; HTTP/SSE receipts above do not establish browser acceptance',
  scope: 'This audit checks final artifact/source/consumer identity and saved command receipts. It does not rerun the suites or extend their tested platform/service scope.',
};
await writeFile(path.join(evidence, 'final-verification.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
