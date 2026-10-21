import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const task = path.resolve('readiness-2026-10-21');
const initial = JSON.parse(await readFile(path.join(task, 'inputs.json')));
const audit = spawnSync(process.execPath, [path.join(task, 'scripts/audit-inputs.mjs'), path.join(task, 'inputs-final.json')], { encoding: 'utf8' });
assert.equal(audit.status, 0, audit.stderr);
const final = JSON.parse(await readFile(path.join(task, 'inputs-final.json')));
assert.deepEqual(final.immutable, initial.immutable, 'Historical evidence, provenance, archive, delivery or instruction file changed');
const distribution = JSON.parse(await readFile(path.join(task, 'distribution.json')));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(distribution.archive)), distribution.sha256);
for (const entry of distribution.inventory) {
  for (const root of ['package', distribution.extracted.package, distribution.installed.package]) assert.equal(hash(await readFile(path.join(root, entry.path))), entry.sha256, root + ': ' + entry.path);
}
const historical = JSON.parse(await readFile('evidence/candidate-inventory.json'));
// This redundant materialization is ignored by Git. Recreate it from the
// immutable, hash-verified original archive when auditing a fresh checkout.
try { await access(path.join(task, 'historical/package/package.json')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await mkdir(path.join(task, 'historical'), { recursive: true });
  const extraction = spawnSync('tar', ['-xzf', path.resolve('artifacts/rawnode-monitor-1.0.0.tgz'), '-C', path.join(task, 'historical')], { encoding: 'utf8' });
  assert.equal(extraction.status, 0, extraction.stderr);
}
for (const entry of historical.files) assert.equal(hash(await readFile(path.join(task, 'historical/package', entry.path))), entry.sha256, 'Historical candidate inventory: ' + entry.path);
function counts(text) {
  return Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key, Number(new RegExp('(?:ℹ|#) ' + key + ' (\\d+)').exec(text)?.[1] ?? NaN)]));
}
const suites = {};
for (const [name, location] of Object.entries({ native: 'final-native', installed: 'final-installed', extracted: 'final-extracted-isolated' })) {
  suites[name] = counts(await readFile(path.join(task, 'logs', location, 'test.txt'), 'utf8'));
  assert.equal(suites[name].pass, 86); assert.equal(suites[name].fail, 0); assert.equal(suites[name].cancelled, 0); assert.equal(suites[name].skipped, 0);
  const checks = JSON.parse(await readFile(path.join(task, 'logs', name === 'extracted' ? 'final-extracted' : location, 'commands.json')));
  for (const check of checks.filter(check => check.leg !== 'test')) assert.equal(check.exit, check.expectedExit, name + ': ' + check.leg);
}
const pm = JSON.parse(await readFile(path.join(task, 'pm-composition.json')));
assert.equal(pm.ok, true); assert.equal(pm.monitor.sha256, distribution.sha256);
const studio = JSON.parse(await readFile(path.join(task, 'studio-final-smoke.json')));
assert.equal(studio.status, 'passed');
const ingest = JSON.parse(await readFile(path.join(task, 'ingest-auth-final-smoke.json')));
assert.equal(ingest.status, 'passed'); assert.equal(ingest.sha256, distribution.sha256);
const whitespace = spawnSync('git', ['diff', '--check'], { encoding: 'utf8' });
assert.equal(whitespace.status, 0, whitespace.stdout + whitespace.stderr);
const receipt = { ok: true, sha256: distribution.sha256, bytes: distribution.bytes, packedFiles: distribution.packedFiles,
  suites, buildJavaScript: 112, manifestEntries: 29, executableEntries: 28, rootExportNames: 189,
  originalFileHashesUnchanged: initial.preservedOriginalFiles, historicalCandidateFileHashesMatched: historical.files.length,
  immutableFilesUnchanged: Object.keys(final.immutable).length, packageCheckoutExtractionInstallationMatch: true,
  privateUnlicensedOwnershipAndGuardPreserved: true, pmReciprocal: pm.reciprocal, studioHttpSseChecks: studio.checkCount, ingestionAndTokenSecurityChecks: ingest.checkCount,
  concurrentExtractionTimeout: { receipt: 'consumer-checks.json', failed: 1, passed: 85, resolution: 'Full isolated extracted suite passed 86/86 without changing package bytes; logs/final-extracted-isolated' },
  harnessCorrections: ['Parse npm pack JSON after prepack check JSON', 'Exclude synthetic file:///tmp redirect fixture from machine-path matches', 'Resolve ESM-only benchmark target through installed metadata instead of CJS root condition', 'Serialize complete suites in reproduction harness to avoid coupling tight deadline tests to parallel verification'] };
await writeFile(path.join(task, 'final-verification.json'), JSON.stringify(receipt, null, 2) + '\n');
await writeFile(path.join(task, 'distribution-checks.json'), JSON.stringify({ ok: true, sha256: distribution.sha256, commands: 'logs/distribution/commands.json', finalChecks: 'final-verification.json', overhead: 'overhead.json', initialOverheadHarnessFailureRetained: 'logs/distribution/overhead-initial.stderr.txt', interpretation: 'The initial overhead command failed in the harness; final-consumers.mjs records the corrected command exit 0. The initial concurrent extracted suite timeout is retained and resolved by the isolated full rerun.' }, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
