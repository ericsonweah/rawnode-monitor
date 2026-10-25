import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Run last, after browser receipts and report edits are complete. Produces new
// immutable outputs; it never overwrites an earlier manifest or summary.
const task = fileURLToPath(new URL('../', import.meta.url));
const manifestPath = path.resolve(task, process.argv[2] || 'closing-artifacts.json');
assert.ok(manifestPath.startsWith(task) && manifestPath.endsWith('.json'));
const summaryPath = manifestPath.slice(0, -5) + '-summary.json';
for (const output of [manifestPath, summaryPath]) {
  try { await access(output); throw new Error('Refusing to overwrite existing output: ' + output); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const excluded = new Set([manifestPath, summaryPath]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [];
const documents = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (excluded.has(absolute)) continue;
    if (entry.isDirectory()) { await visit(absolute); continue; }
    assert.equal(entry.isFile(), true, 'Unexpected symlink/special run artifact: ' + absolute);
    const bytes = await readFile(absolute);
    const relative = path.relative(task, absolute).split(path.sep).join('/');
    files.push({ path: relative, bytes: bytes.length, sha256: hash(bytes), mode: (await lstat(absolute)).mode & 0o777 });
    if (relative.endsWith('.md')) documents.push({ absolute, relative, text: bytes.toString('utf8') });
  }
}
await visit(task);
files.sort((a, b) => a.path.localeCompare(b.path));
const missingLinks = [];
let checkedLinks = 0;
for (const document of documents) {
  for (const match of document.text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const absolute = path.resolve(path.dirname(document.absolute), target);
    checkedLinks++;
    if (excluded.has(absolute)) continue; // These two outputs are created below.
    try { await access(absolute); }
    catch { missingLinks.push({ document: document.relative, target: match[1] }); }
  }
}
assert.deepEqual(missingLinks, [], 'Missing local Markdown links');
const archivePath = 'final/artifacts/rawnode-monitor-1.0.0.tgz';
const archive = files.find(item => item.path === archivePath);
assert.equal(archive?.sha256, 'a749983cc32e7ed9df10088dbe671fc4c6a3d47ed9a22da8a9d48d1e789c2615');
assert.equal(archive.bytes, 214_938);
const browserReceipt = files.find(item => item.path === 'BROWSER_RECEIPT.json');
assert.ok(browserReceipt, 'Finalize the browser receipt before the closing manifest');
const postBrowser = files.find(item => item.path === 'post-browser-verification.json');
assert.ok(postBrowser, 'Run post-browser artifact verification before the closing manifest');
const manifest = {
  createdAt: new Date().toISOString(), command: [process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], cwd: process.cwd(), node: process.version,
  scope: 'Complete regular-file inventory of this qualification run at closing time, including retained attempts and npm caches. This is outside the npm payload. Existing private paths in original receipts are not newly collected.',
  exclusions: [...excluded].map(file => path.relative(task, file)),
  exclusionReason: 'The manifest excludes itself, and excludes its summary because that summary records this manifest digest. Earlier manifests, if any, remain included. No self-referential hash is claimed.',
  nominatedArchive: archive,
  localMarkdownLinks: { documents: documents.length, checkedLinks, missing: missingLinks, scope: 'Local target existence; external availability and heading anchors not asserted' },
  fileCount: files.length, totalBytes: files.reduce((sum, item) => sum + item.bytes, 0), files,
};
const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
await writeFile(manifestPath, manifestBytes, { flag: 'wx' });
const selectedPaths = ['REPORT.md', 'GATE_MATRIX.md', 'BROWSER_RECEIPT.json', 'BROWSER_HANDOFF.md', 'post-browser-verification.json', 'NODE22_QUALIFICATION.md', 'OWNER_DECISIONS.md', 'SERVICE_SCOPE.md', 'OPERATOR_DECISIONS.md', 'changes-from-oct25.patch', 'final/distribution.json', 'final/final-verification.json', 'node22-final/qualification.json'];
const summary = {
  createdAt: new Date().toISOString(), manifest: { path: path.relative(task, manifestPath), bytes: manifestBytes.length, sha256: hash(manifestBytes) },
  archive: { ...archive, name: '@rawnode/monitor', version: '1.0.0', packedFiles: 177 },
  keyDeliverables: selectedPaths.map(name => { const item = files.find(file => file.path === name); assert.ok(item, 'Missing deliverable: ' + name); return item; }),
  filesInventoried: files.length, totalBytes: manifest.totalBytes, localMarkdownLinks: manifest.localMarkdownLinks,
  note: 'Use report and gate matrix for actual qualification status. A complete artifact inventory does not convert an incomplete browser or unrun service gate into a pass. Publication authorization remains NOT GRANTED.',
};
await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ manifest: manifestPath, summary: summaryPath, manifestSha256: summary.manifest.sha256, files: files.length, linksChecked: checkedLinks, nominatedArchiveSha256: archive.sha256 }));
