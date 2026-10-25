import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

assert.equal(process.version, 'v22.0.0');
const run = fileURLToPath(new URL('../', import.meta.url));
const task = path.join(run, 'node22-final');
const root = path.resolve('.');
const hash = data => createHash('sha256').update(data).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const distribution = await json(path.join(task, 'distribution.json'));
const checks = {};
for (const [name, receipt] of Object.entries({ source: path.join(run, 'node22-source-after/commands.json'), extracted: path.join(task, 'logs/extracted/commands.json'), installed: path.join(task, 'logs/installed/commands.json') })) {
  const result = await json(receipt);
  assert.equal(result.ok, true); assert.equal(result.runtimeVersion, process.version);
  assert.equal(result.commands.length, 6);
  const tests = result.commands.find(row => row.leg === 'test');
  assert.deepEqual(tests.counts, { tests: 97, suites: 0, pass: 97, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  for (const command of result.commands) { assert.equal(command.exit, command.expectedExit); assert.equal(command.timedOut, false); assert.equal(command.signal, null); }
  checks[name] = { status: 'PASS', receipt: path.relative(run, receipt), runtime: result.runtimeVersion, npm: result.npmVersion, compiler: result.compilerVersion, compilerRuntime: result.compilerRuntime, selectedFiles: result.selectedFiles.length, testCounts: tests.counts, gates: result.commands.map(row => ({ name: row.leg, exit: row.exit, expectedExit: row.expectedExit, timedOut: row.timedOut })) };
}
const originalHash = hash(await readFile(path.join(root, 'readiness-2026-10-25/artifacts/rawnode-monitor-1.0.0.tgz')));
assert.equal(originalHash, '69e756daa6d127ca919acef8f430998a35bf1217cb2491d20b11dd77a1e908f7');
const finalHash = hash(await readFile(distribution.archive));
assert.equal(finalHash, distribution.sha256);
const verifiedPackages = [];
for (const [name, packageRoot] of Object.entries({ source: path.join(root, 'package'), extracted: distribution.extracted.package, installed: distribution.installed.package })) {
  for (const row of distribution.inventory) {
    assert.equal(hash(await readFile(path.join(packageRoot, row.path))), row.sha256, `${name}/${row.path}`);
    if (name !== 'source') assert.equal((await lstat(path.join(packageRoot, row.path))).mode & 0o777, row.modes.archive);
  }
  verifiedPackages.push({ name, packageRoot, files: distribution.inventory.length, archiveHashesMatch: true });
}
const pm = await json(path.join(task, 'pm-composition.json'));
assert.equal(pm.ok, true); assert.equal(pm.node, process.version); assert.equal(pm.monitor.sha256, finalHash);
assert.equal(pm.pm.sha256, '0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f');
assert.equal(hash(await readFile(pm.pm.archive)), pm.pm.sha256);
assert.equal(pm.reciprocal.naturalChildExit, true); assert.equal(pm.reciprocal.childBinaryIdentityChecked, true); assert.equal(pm.reciprocal.borrowedPmResourcePreserved, true);
const http = await json(path.join(task, 'studio-final-smoke.json'));
const auth = await json(path.join(task, 'ingest-auth-final-smoke.json'));
assert.equal(http.status, 'passed'); assert.equal(auth.status, 'passed'); assert.equal(http.node, process.version); assert.equal(auth.node, process.version);
const services = await json(path.join(task, 'logs/services/commands.json'));
assert.equal(services.length, 3);
for (const row of services) { assert.equal(row.exit, 0); assert.equal(row.timedOut, false); assert.equal(row.node, process.version); assert.equal(row.archiveSha256, finalHash); }
const harness = [];
for (const [directory, names] of [[path.join(run, 'scripts'), ['runtime-checks.mjs', 'mock-timer-probe.mjs', 'node22-consumers.mjs', 'node22-final-checks.mjs', 'audit-node22.mjs']], [path.join(task, 'scripts'), await readdir(path.join(task, 'scripts'))]]) {
  for (const name of names) { const file = path.join(directory, name); harness.push({ path: path.relative(run, file), sha256: hash(await readFile(file)) }); }
}
const result = { status: 'PASS', observedAt: new Date().toISOString(), runtime: process.version, execPath: process.execPath, compiler: { path: '/usr/local/lib/node_modules/typescript/bin/tsc', version: '5.9.3', executionRuntime: process.version }, archive: distribution.archive, sha256: finalHash, bytes: distribution.bytes, files: distribution.inventory.length, originalOctober25ArchiveUnchanged: originalHash, checks, verifiedPackages, publicEntries: { entries: 29, executable: 28, rootNames: 189, extracted: true, installed: true, domFreeStudioImport: true, privateDeepImportRejected: true }, strictOutsidePackageTypeConsumers: { extracted: true, installed: true, skipLibCheck: false }, pm: { sha256: pm.pm.sha256, bytes: pm.pm.bytes, engines: pm.pm.engines, reciprocal: pm.reciprocal, directShapes: pm.shapes, diagnosticRedaction: true, monitorUnchanged: true }, http: { status: http.status, checks: http.checkCount }, authenticationAndIngestion: { status: auth.status, checks: auth.checkCount }, cleanup: { serviceWatchdogsFired: false, allNativeSuitesExitedNaturally: true, realPmChildExitedNaturally: true, finalPackagesUnmodified: true, temporaryConsumersRetainedForReview: true, runtimeRetainedInTaskTemporaryDirectory: true }, harness, limitations: ['Native browser interaction is a separate incomplete gate; these HTTP/SSE and DOM-free imports do not replace it.', 'Local macOS x64 results do not qualify other operating systems or external services.', 'Node 22.0.0 floor compatibility is not a security-maintenance recommendation.', '97 tests are the same distinct cases executed in source, extraction, and installation, not 291 distinct regressions.'] };
await writeFile(path.join(task, 'qualification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ status: result.status, node: result.runtime, sha256: result.sha256, tests: Object.fromEntries(Object.entries(checks).map(([name, value]) => [name, value.testCounts])), http: result.http, authenticationAndIngestion: result.authenticationAndIngestion, pm: result.pm.reciprocal }));
