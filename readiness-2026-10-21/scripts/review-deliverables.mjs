import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
function git(args, expected = 0) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  if (result.status !== expected) throw Error(result.stderr || 'git failed: ' + args.join(' '));
  return result.stdout;
}
// Keep the original comparison meaningful after the readiness commit is made.
const base = process.argv[2] || JSON.parse(await readFile('readiness-2026-10-21/changed-files.json', 'utf8')).base;
let patch = git(['diff', '--binary', base, '--', 'package']);
const tracked = git(['diff', '--name-only', base, '--', 'package']).trim().split('\n').filter(Boolean);
const added = new Set(git(['diff', '--name-only', '--diff-filter=A', base, '--', 'package']).trim().split('\n').filter(Boolean));
const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'package']).trim().split('\n').filter(Boolean);
for (const file of untracked) patch += git(['diff', '--no-index', '--', '/dev/null', file], 1);
await writeFile('readiness-2026-10-21/review.patch', patch);
const files = [];
for (const file of [...tracked, ...untracked].sort()) {
  const bytes = await readFile(file);
  files.push({ path: file, status: untracked.includes(file) || added.has(file) ? 'added' : 'modified', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile('readiness-2026-10-21/changed-files.json', JSON.stringify({ base, files }, null, 2) + '\n');
console.log(JSON.stringify({ packageFiles: files.length, added: untracked.length, modified: tracked.length, patchBytes: Buffer.byteLength(patch) }));
