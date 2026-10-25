import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [cwd, destination, ...legs] = process.argv.slice(2);
if (!cwd || !destination) throw Error('Usage: node run-checks.mjs CWD LOG_DIR [build test basic types guard]');
await mkdir(destination, { recursive: true });
const commands = {
  build: ['npm', ['run', 'build']],
  test: ['npm', ['test']],
  basic: ['node', ['examples/basic.mjs']],
  types: ['tsc', ['--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', 'test/types.mts']],
  'types-all': ['tsc', ['--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--resolveJsonModule', 'test/exports-types.mts']],
  guard: ['npm', ['run', 'prepublishOnly']],
};
const results = [];
const configRoot = path.join(destination, 'npm-isolation');
await mkdir(configRoot, { recursive: true });
for (const name of ['user.npmrc', 'global.npmrc']) await writeFile(path.join(configRoot, name), '');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key) && !['NODE_OPTIONS', 'NODE_PATH'].includes(key)));
Object.assign(environment, { npm_config_userconfig: path.join(configRoot, 'user.npmrc'), npm_config_globalconfig: path.join(configRoot, 'global.npmrc'), npm_config_cache: path.join(configRoot, 'cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' });
for (const leg of legs) {
  const [command, args] = commands[leg];
  const start = new Date();
  const child = spawn(command, args, { cwd: path.resolve(cwd), env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', value => { output += value; });
  child.stderr.on('data', value => { output += value; });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, 120_000);
  const exit = await new Promise(resolve => { child.once('error', error => { output += String(error); resolve(null); }); child.once('exit', resolve); });
  clearTimeout(timeout);
  const result = { leg, command: [command, ...args], cwd: path.resolve(cwd), started: start.toISOString(), milliseconds: Date.now() - start, exit, timedOut, expectedExit: leg === 'guard' ? 1 : 0 };
  if (leg === 'test') {
    result.counts = Object.fromEntries(['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key, Number(new RegExp(`(?:^|\\n)[^\\n]*?\\b${key} (\\d+)(?:\\r?\\n|$)`).exec(output)?.[1] ?? NaN)]));
    result.summaryValid = result.counts.tests > 0 && result.counts.pass === result.counts.tests && ['fail', 'cancelled', 'skipped', 'todo'].every(key => result.counts[key] === 0);
  }
  if (leg === 'guard') result.summaryValid = output.includes('Publication blocked:');
  await writeFile(path.join(destination, leg + '.txt'), output);
  results.push(result);
  console.log(JSON.stringify({ ...result, tail: output.slice(-1200) }));
}
await writeFile(path.join(destination, 'commands.json'), JSON.stringify(results, null, 2) + '\n');
if (results.some(result => result.exit !== result.expectedExit || result.timedOut || result.summaryValid === false)) process.exitCode = 1;
