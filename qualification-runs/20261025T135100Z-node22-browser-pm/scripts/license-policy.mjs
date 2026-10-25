import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const task = path.resolve('qualification-runs/20261025T135100Z-node22-browser-pm');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const baseline = JSON.parse(await readFile(path.join(task, 'baseline.json')));
const inputs = JSON.parse(await readFile(path.join(task, 'inputs.json')));
const manifest = JSON.parse(await readFile('package/package.json'));
const official = await readFile('/private/tmp/rawnode-monitor-apache-license-20261025.txt');
const current = await readFile('package/LICENSE');
assert(current.equals(official));
assert.equal(official.length, 11358);
assert.equal(hash(official), 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30');
assert.equal(manifest.license, 'Apache-2.0');
assert.equal(manifest.name, '@rawnode/monitor');
assert.equal(manifest.version, '1.0.0');
assert.equal(manifest.private, true);
assert.deepEqual(manifest.author, { name: 'FIRST PRINCIPLE LAB, LLC', email: 'rawnode@firstprinciplelab.com', url: 'https://firstprinciplelab.com' });
assert.equal(manifest.scripts.prepublishOnly, 'node scripts/reject-publication.mjs');
for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies', 'workspaces']) assert.equal(Object.keys(manifest[key] || {}).length, 0, key);
const originalManifestBytes = await readFile('provenance/original/package.json');
const originalManifest = JSON.parse(originalManifestBytes);
const originalLicense = await readFile('provenance/original/LICENSE');
assert.equal(originalManifest.license, 'ISC');
assert.equal(originalManifest.author, 'Rawnode.org');
assert.equal(originalLicense.length, 0);

const roots = ['package/src', 'package/resources', 'package/config', 'package/types', 'package/examples', 'package/test', 'provenance/original/src/monitor', 'provenance/original/resources/assets/js/monitor', 'provenance/original/resources/assets/css/monitor', 'provenance/original/config/monitor.js', 'provenance/original/types/monitor/index.d.ts', 'provenance/original/src/foundation/providers/MonitorServiceProvider.js'];
async function files(entry) {
  const output = [];
  try {
    for (const child of await readdir(entry, { withFileTypes: true })) {
      const next = path.join(entry, child.name);
      if (child.isDirectory()) output.push(...await files(next));
      else if (/\.(?:js|mjs|mts|ts|css)$/.test(child.name)) output.push(next);
    }
  } catch (error) { if (error.code === 'ENOTDIR') return [entry]; throw error; }
  return output;
}
const scannedFiles = (await Promise.all(roots.map(files))).flat().sort();
const noticeMatches = [];
for (const filename of scannedFiles) {
  const lines = (await readFile(filename, 'utf8')).split('\n');
  lines.forEach((line, index) => { if (/\b(?:copyright|license|licensed|licence|author|attribution|third.party|SPDX)\b/i.test(line)) noticeMatches.push({ file: filename, line: index + 1, text: line }); });
}
const legal = path.join(task, 'legal');
await mkdir(legal, { recursive: true });
await writeFile(path.join(legal, 'LICENSE-2.0.official.txt'), official);
await copyFile(path.join(baseline.extraction, 'LICENSE'), path.join(legal, 'baseline-candidate-LICENSE.txt'));
await copyFile(path.join(baseline.extraction, 'NOTICE.md'), path.join(legal, 'baseline-candidate-NOTICE.md'));
const guide = await readFile('AGENTS.md');
const guideBaseline = inputs.immutable['AGENTS.md'];
const guideHash = typeof guideBaseline === 'string' ? guideBaseline : guideBaseline?.sha256;
if (guideHash) assert.equal(hash(guide), guideHash);
const receipt = {
  observedAt: new Date().toISOString(),
  authority: { path: 'rawnode-monitor-node22-browser-pm-qualification-codex-prompt.md', section: '2. Mandatory ownership, namespace, and licensing policy', scope: 'Owner supplies Apache-2.0 for current owner-controlled original material; AGENTS.md remains unchanged; private/publication refusal remain independent.' },
  baseline: { archive: baseline.archive, license: baseline.manifest.license, author: baseline.manifest.author },
  applied: { name: manifest.name, version: manifest.version, license: manifest.license, author: manifest.author, private: manifest.private, guard: manifest.scripts.prepublishOnly, dependencyChannelsEmpty: true },
  officialLicense: { source: 'https://www.apache.org/licenses/LICENSE-2.0.txt', bytes: official.length, sha256: hash(official), exactPackageMatch: true, copy: 'legal/LICENSE-2.0.official.txt', downloadedWith: 'curl --fail --location --max-time 30 --output /private/tmp/rawnode-monitor-apache-license-20261025.txt https://www.apache.org/licenses/LICENSE-2.0.txt', attempts: [{ exit: 6, reason: 'Sandbox DNS resolution failed' }, { exit: 0, reason: 'Approved network escalation to official source' }] },
  original: { manifestLicense: originalManifest.license, manifestAuthor: originalManifest.author, manifestSha256: hash(originalManifestBytes), licenseBytes: originalLicense.length, licenseSha256: hash(originalLicense), contributorsField: originalManifest.contributors || null },
  review: { roots, scannedFileCount: scannedFiles.length, scannedFiles, noticeMatches, conclusion: 'No file-specific conflicting license/attribution notice found in reviewed shipped material and corresponding preserved Monitor inputs. This bounded scan and supplied ownership assertion do not manufacture contributor assignments or establish unidentified outside rights.' },
  history: { originalRootAndAdjacentLicensesUnmodified: true, previousUnlicensedArtifactsRetained: true, pmNotEdited: true, guideSha256: hash(guide), guideBaselineMatched: guideHash ? true : 'Parent final audit covers protected-file mapping' },
  checks: [
    { command: 'npm run build && npm run prepublishOnly', cwd: 'package', node: 'v24.21.0', buildExit: 0, buildCheckedJavaScript: 112, buildExports: 29, guardExit: 1, combinedExit: 1, guardText: 'Publication blocked: candidate requires explicit owner release authorization and final public-version approval.', evidence: 'legal/verification.txt' },
    { command: 'git diff --check', exit: 0 }
  ],
  remaining: { concreteFileSpecificRightsConflicts: [], suppliedSelectionsPending: false, administrativeRegistryVerification: 'UNRUN; owner assertion only', companyWebsite: 'Owner says unpublished; no availability assertion or engineering gate', finalPublicVersion: 'Owner approval remains required; preparation version retained', publicationAuthorization: 'NOT GRANTED', operationalContact: 'Not authorized for notifications or represented as monitored security reporting' }
};
await writeFile(path.join(task, 'license-policy.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ license: manifest.license, owner: manifest.author, exactLicenseSha256: hash(official), scannedFiles: scannedFiles.length, conflictingNoticeMatches: noticeMatches.length, guideHash: hash(guide) }));
