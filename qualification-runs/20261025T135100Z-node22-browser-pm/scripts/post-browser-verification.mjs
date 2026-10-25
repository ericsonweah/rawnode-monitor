import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// Execute only after the coordinating agent confirms browserdone. This performs
// read-only package/history checks and task-owned temporary archive/patch checks.
// It does not overwrite earlier verification receipts or run any live service.
const repository = path.resolve('.');
const task = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(task, process.argv[2] || 'post-browser-verification.json');
assert.ok(output.startsWith(task), 'Receipt must remain inside this run');
try { await access(output); throw new Error('Refusing to overwrite existing receipt: ' + output); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const startedAt = new Date().toISOString();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const commands = [];
function run(command, args, cwd = repository, expected = 0) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });
  commands.push({ command: [command, ...args], cwd, startedAt: new Date(started).toISOString(), milliseconds: Date.now() - started, exit: result.status, signal: result.signal, error: result.error?.message || null });
  assert.equal(result.status, expected, result.stderr || result.stdout || result.error?.message);
  return result.stdout;
}
async function checkedFile(file, expectedSha256, expectedBytes) {
  const bytes = await readFile(file);
  assert.equal(hash(bytes), expectedSha256, 'Hash drift: ' + file);
  if (expectedBytes !== undefined) assert.equal(bytes.length, expectedBytes, 'Size drift: ' + file);
  return { path: file, bytes: bytes.length, sha256: hash(bytes) };
}
async function inventory(directory, prefix = '') {
  const files = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await inventory(absolute, relative));
    else {
      assert.equal(item.isFile(), true, 'Unexpected link/special file: ' + absolute);
      const bytes = await readFile(absolute);
      files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes), mode: (await lstat(absolute)).mode & 0o777 });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
const initial = await json(path.join(task, 'inputs.json'));
const baseline = await json(path.join(task, 'baseline.json'));
const finalDistribution = await json(path.join(task, 'final/distribution.json'));
const node22Distribution = await json(path.join(task, 'node22-final/distribution.json'));
const archive = await checkedFile(finalDistribution.archive, 'a749983cc32e7ed9df10088dbe671fc4c6a3d47ed9a22da8a9d48d1e789c2615', 214_938);
const repeat = await checkedFile(finalDistribution.repeat.archive, archive.sha256, archive.bytes);
const baselineArchive = await checkedFile(baseline.archive.path, '69e756daa6d127ca919acef8f430998a35bf1217cb2491d20b11dd77a1e908f7', 209_613);
const pm = await checkedFile(initial.pm.path, '0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f', 94_194);
assert.equal(Object.keys(initial.immutable).length, 1530);
async function historicalPaths(directory) {
  const paths = [];
  for (const entry of await readdir(path.join(repository, directory), { withFileTypes: true })) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await historicalPaths(relative));
    else paths.push(relative);
  }
  return paths;
}
const currentProtectedPaths = [];
for (const directory of ['provenance', 'evidence', 'artifacts', 'readiness-2026-10-21', 'readiness-2026-10-24', 'readiness-2026-10-25']) currentProtectedPaths.push(...await historicalPaths(directory));
currentProtectedPaths.push('rawnode-monitor-node22-browser-pm-qualification-codex-prompt.md', 'AGENTS.md', 'DELIVERY.md', 'RawNode_Monitor_Codex_Production_Readiness_Prompt.md');
assert.deepEqual(currentProtectedPaths.sort(), Object.keys(initial.immutable).sort(), 'Protected historical path set changed');
for (const [relative, expected] of Object.entries(initial.immutable)) await checkedFile(path.join(repository, relative), expected.sha256, expected.bytes);
const git = {
  head: run('git', ['rev-parse', 'HEAD']),
  branch: run('git', ['branch', '--show-current']),
  index: run('git', ['diff', '--cached', '--binary']),
  status: run('git', ['status', '--short']),
};
for (const key of ['head', 'branch', 'index']) assert.equal(git[key], baseline.git[key].stdout, 'Git ' + key + ' changed');
run('git', ['diff', '--check']);
const packageRoots = { source: path.join(repository, 'package'), node24Extracted: finalDistribution.extracted.package, node24Installed: finalDistribution.installed.package, node22Extracted: node22Distribution.extracted.package, node22Installed: node22Distribution.installed.package };
const patch = await checkedFile(path.join(task, 'changes-from-oct25.patch'), '8bb02ece8f404bd8f4f3f336a994f4cd39aa945848aeced4f1cf97ad6779ba0d', 34_225);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'monitor-post-browser-audit-'));
const packages = [];
let exact;
try {
  const entries = run('tar', ['-tzf', archive.path]).trim().split('\n');
  assert.equal(entries.length, 177);
  for (const entry of entries) assert.ok(entry.startsWith('package/') && !entry.split('/').includes('..'));
  run('tar', ['-xzf', archive.path, '-C', temporary]);
  exact = await inventory(path.join(temporary, 'package'));
  assert.equal(exact.length, 177);
  assert(exact.every(item => item.mode === 0o644 || item.mode === 0o755));
  for (const [name, directory] of Object.entries(packageRoots)) {
    assert.equal(await realpath(directory), directory, 'Package root must not be a link');
    const files = await inventory(directory);
    assert.deepEqual(files, exact, 'Complete byte/mode inventory drift: ' + name);
    packages.push({ name, path: directory, files: files.length, completeHashesAndModesMatchArchive: true });
  }
  const patchedRoot = path.join(temporary, 'baseline-patch');
  await mkdir(patchedRoot);
  run('tar', ['-xzf', baselineArchive.path, '-C', patchedRoot]);
  run('patch', ['-p1', '--batch', '-i', patch.path], patchedRoot);
  assert.deepEqual(await inventory(path.join(patchedRoot, 'package')), exact, 'Review patch does not reconstruct final archive from exact baseline');
} finally { await rm(temporary, { recursive: true, force: true }); }
const old = new Map(baseline.packageSource.map(item => [item.path, item]));
const changes = exact.filter(item => old.get(item.path)?.sha256 !== item.sha256).map(item => ({ ...item, beforeSha256: old.get(item.path)?.sha256 || null }));
const expectedPaths = ['CHANGELOG.md', 'LICENSE', 'NOTICE.md', 'README.md', 'docs/MIGRATION.md', 'docs/PUBLICATION.md', 'docs/VALIDATION.md', 'package.json', 'scripts/reject-publication.mjs', 'test/studio-actions.test.mjs'].sort();
assert.deepEqual(changes.map(item => item.path).sort(), expectedPaths);
const priorSource = await json(path.join(task, 'final/source-final.json'));
assert.deepEqual(changes.map(({ mode, ...item }) => item), priorSource.changedFromOct25);
const regressionMap = await json(path.join(task, 'seven-regressions.json'));
assert.equal(regressionMap.cases.length, 7);
for (const item of regressionMap.cases) await checkedFile(path.join(repository, 'package', item.file), item.sha256);
const sourceFingerprint = await checkedFile(path.join(task, 'final/source-final.json'), 'e20d19ca746d3c75abbeae27ac5f60a54aab467d141e62e799553f3bb01e1c96', 31_041);
const manifest = await json(path.join(repository, 'package/package.json'));
assert.equal(manifest.private, true); assert.equal(manifest.license, 'Apache-2.0'); assert.equal(manifest.engines.node, '>=22');
assert.deepEqual(manifest.author, { name: 'FIRST PRINCIPLE LAB, LLC', email: 'rawnode@firstprinciplelab.com', url: 'https://firstprinciplelab.com' });
assert.equal(manifest.scripts.prepublishOnly, 'node scripts/reject-publication.mjs');
for (const channel of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies', 'workspaces']) assert.equal(Object.keys(manifest[channel] || {}).length, 0);
const receipt = {
  status: 'PASS', startedAt, finishedAt: new Date().toISOString(), command: [process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], cwd: repository, runtime: process.version,
  harnessSha256: hash(await readFile(fileURLToPath(import.meta.url))), archive, repeat, baselineArchive, pm,
  protectedFileHashesUnchanged: Object.keys(initial.immutable).length, originalFilesIncluded: initial.preservedOriginalFiles, historicalCandidateFilesPreviouslyVerified: initial.historicalCandidateFiles,
  packages, changesFromOctober25: changes, sevenRegressionsUnchanged: true, reviewPatchAppliedToFreshBaselineMatchesFinal: true, patch, sourceFingerprint, git, commands,
  historicalAndEarlierFinalReceiptsNotOverwritten: true,
  temporaryAuditExtractionAndPatchCopyRemoved: true,
  browserOutcome: 'This receipt verifies post-browser artifact/preservation state only. Native browser assertions and fixture cleanup belong to the separately finalized browser receipt.',
  scope: 'No package mutation, repack, npm installation, suite rerun, service, daemon, remote operation, existing-process enumeration or signal is performed by this audit.',
};
await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, archiveSha256: archive.sha256, packages: packages.length, filesEach: exact.length, protected: receipt.protectedFileHashesUnchanged, changedFiles: changes.length, receipt: output }));
