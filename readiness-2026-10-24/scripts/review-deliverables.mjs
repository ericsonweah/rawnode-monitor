import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

// Optional arguments: output directory, base revision. Keep the diff grounded in
// the clean HEAD at the start of this task, including after a later owner commit.
const output = path.resolve(process.argv[2] || 'readiness-2026-10-24');
const base = process.argv[3] || '884a4974ba14d15a21ed4014bbe004ebf95384a7';
function git(args, expected = 0) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== expected) throw Error(result.stderr || 'git failed: ' + args.join(' '));
  return result.stdout;
}
let patch = git(['diff', '--binary', base, '--', 'package']);
const tracked = git(['diff', '--name-only', base, '--', 'package']).trim().split('\n').filter(Boolean);
const added = new Set(git(['diff', '--name-only', '--diff-filter=A', base, '--', 'package']).trim().split('\n').filter(Boolean));
const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'package']).trim().split('\n').filter(Boolean);
for (const file of untracked) patch += git(['diff', '--no-index', '--', '/dev/null', file], 1);
const files = [];
for (const file of [...new Set([...tracked, ...untracked])].sort()) {
  const bytes = await readFile(file);
  files.push({ path: file, status: untracked.includes(file) || added.has(file) ? 'added' : 'modified', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'review.patch'), patch);
await writeFile(path.join(output, 'changed-files.json'), JSON.stringify({ base, files }, null, 2) + '\n');
console.log(JSON.stringify({ packageFiles: files.length, added: files.filter(file => file.status === 'added').length, modified: files.filter(file => file.status === 'modified').length, patchBytes: Buffer.byteLength(patch) }));
