import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const evidence = fileURLToPath(new URL('../', import.meta.url));
const logs = path.join(evidence, 'logs/services');
await mkdir(logs, { recursive: true });
const distribution = JSON.parse(await readFile(path.join(evidence, 'distribution.json')));
const records = [];
for (const name of ['run-pm-composition', 'studio-final-smoke', 'ingest-auth-final-smoke']) {
  const script = path.join(evidence, 'scripts', name + '.mjs');
  const started = Date.now();
  const child = spawn(process.execPath, [script], { cwd: process.cwd(), env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !['NODE_OPTIONS', 'NODE_PATH'].includes(key))), stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', timedOut = false;
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 45_000);
  const exit = await new Promise(resolve => { child.once('error', error => { output += String(error); resolve(null); }); child.once('exit', resolve); });
  clearTimeout(timer);
  const record = { name, command: [process.execPath, script], cwd: process.cwd(), harnessSha256: createHash('sha256').update(await readFile(script)).digest('hex'), node: process.version, archiveSha256: distribution.sha256, started: new Date(started).toISOString(), milliseconds: Date.now() - started, exit, timedOut };
  records.push(record);
  await writeFile(path.join(logs, name + '.txt'), output);
  await writeFile(path.join(logs, 'commands.json'), JSON.stringify(records, null, 2) + '\n');
  console.log(JSON.stringify({ ...record, tail: output.slice(-1200) }));
  assert.equal(exit, 0, name); assert.equal(timedOut, false, name);
}
