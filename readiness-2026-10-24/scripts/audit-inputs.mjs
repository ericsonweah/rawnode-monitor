import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const base = path.resolve('.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file));
    else files.push(file);
  }
  return files.sort();
}
const immutable = {};
for (const file of [...await walk('provenance'), ...await walk('evidence'), ...await walk('artifacts'), ...await walk('readiness-2026-10-21'), 'AGENTS.md', 'DELIVERY.md', 'RawNode_Monitor_Codex_Production_Readiness_Prompt.md']) {
  const bytes = await readFile(file);
  immutable[file] = { bytes: bytes.length, sha256: hash(bytes) };
}
const inventory = JSON.parse(await readFile('provenance/source-inventory.json'));
const original = [];
for (const item of inventory.files) {
  const bytes = await readFile(path.join('provenance/original', item.path));
  if (hash(bytes) !== item.sha256 || bytes.length !== item.bytes) original.push(item.path);
}
const pmPath = '/Users/ericsonweah/Documents/Codex/2026-10-02/task-3/artifacts/rawnode-pm-0.1.0.tgz';
let pm;
try { const bytes = await readFile(pmPath); pm = { path: pmPath, bytes: bytes.length, sha256: hash(bytes) }; }
catch (error) { pm = { path: pmPath, error: error.code }; }
const historical = immutable['artifacts/rawnode-monitor-1.0.0.tgz'];
if (historical.bytes !== 184659 || historical.sha256 !== 'b246ee9eff0b3579f05c886f05ec485719bb1b4847c97c4eefa99dead480baad') throw Error('Historical artifact mismatch');
if (original.length) throw Error('Original inventory mismatch: ' + original.join(','));
const receipt = { base, preservedOriginalFiles: inventory.files.length, originalMismatches: original, historical, historicalCandidateFiles: JSON.parse(await readFile('evidence/candidate-inventory.json')).files.length, pm, immutable };
const target = process.argv[2] || 'readiness-2026-10-24/inputs.json';
await writeFile(target, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ preservedOriginalFiles: inventory.files.length, immutableFiles: Object.keys(immutable).length, historical, pm }));
