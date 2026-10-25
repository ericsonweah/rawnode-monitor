import { spawnSync } from 'node:child_process';
import { readdir, access, writeFile } from 'node:fs/promises';
import os from 'node:os';
const commands = [];
for (const [command, args] of [['git', ['remote', '-v']], ['git', ['branch', '--show-current']], ['git', ['rev-parse', 'HEAD']], ['git', ['status', '--short']], ['sw_vers', []], ['npm', ['--version']], ['tsc', ['--version']], ['which', ['node', 'npm', 'tsc']]]) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  commands.push({ command: [command, ...args], exit: result.status, stdout: result.stdout, stderr: result.stderr });
}
const inspected = [];
for (const location of ['/Users/ericsonweah/.nvm/versions/node', '/Users/ericsonweah/.nodebrew', '/Users/ericsonweah/.local/share/fnm/node-versions', '/Users/ericsonweah/.volta/tools/image/node', '/usr/local/Cellar/node@22', '/opt/homebrew/bin']) {
  try { inspected.push({ location, entries: await readdir(location) }); }
  catch (error) { inspected.push({ location, error: error.code }); }
}
await writeFile('readiness-2026-10-25/environment.json', JSON.stringify({ observedAt: new Date().toISOString(), cwd: process.cwd(), node: process.version, platform: process.platform, arch: process.arch, release: os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemory: os.totalmem(), initialObservation: { note: 'Prior legitimate dirty files and readiness-2026-10-24 preserved; see git status command captured below.' }, commands, node22InspectedLocations: inspected, node22Executed: false, browserExecuted: false, browserInventory: 'browser-availability.json' }, null, 2) + '\n');
