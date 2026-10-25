import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const run = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Supply exact installed package directory');
const session = 'lifecycle-controls-http-01';
const evidence = path.join(run, 'browser/lifecycle-controls-http');
await mkdir(evidence, { recursive: true, mode: 0o700 });
const hash = value => createHash('sha256').update(value).digest('hex');
const fixtureScript = path.join(run, 'scripts/native-browser-fixture.mjs');
const distribution = JSON.parse(await readFile(path.join(run, 'final/distribution.json')));
assert.equal(hash(await readFile(distribution.archive)), distribution.sha256);
const receipt = {
  scope: 'HTTP serving and JavaScript syntax only. No browser execution, DOM model, native interaction or lifecycle/polling acceptance.',
  session, startedAt: new Date().toISOString(), command: [process.execPath, fileURLToPath(import.meta.url), packageRoot], cwd: process.cwd(),
  runtime: { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch },
  archive: { path: distribution.archive, sha256: distribution.sha256 }, packageRoot,
  fixtureScriptSha256: hash(await readFile(fixtureScript)), probeScriptSha256: hash(await readFile(fileURLToPath(import.meta.url))), cleanup: {},
};
const child = spawn(process.execPath, [fixtureScript, packageRoot, evidence, session, 'local'], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', error => { receipt.cleanup.stdinError = error.code || error.name; });
let stdout = '', stderr = '', url;
child.stderr.on('data', value => { stderr = (stderr + value).slice(-8192); });
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
const bound = setTimeout(() => { receipt.cleanup.forcedTimeout = true; child.kill('SIGTERM'); }, 20000);
async function get(route) {
  return await new Promise((resolve, reject) => {
    const req = request(new URL(route, url), { agent: false }, res => {
      let text = '';
      res.on('data', value => { text += value; if (text.length > 1024 * 1024) req.destroy(Error('Response bound exceeded')); });
      res.on('end', () => resolve({ status: res.statusCode, text, contentType: res.headers['content-type'] }));
      res.on('error', reject);
    });
    req.setTimeout(3000, () => req.destroy(Error('Request deadline')));
    req.on('error', reject); req.end();
  });
}
try {
  const input = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(Error('Fixture exited before readiness: ' + code)));
    child.stdout.on('data', value => { stdout += value; const line = stdout.split('\n').find(item => item.startsWith('{') && item.includes('"controlUrl"')); if (line) resolve(JSON.parse(line)); });
  });
  url = input.url; receipt.fixture = input;
  const client = await get('/fixture/client.js'); assert.equal(client.status, 200);
  const servedPath = path.join(evidence, 'served-fixture-client.mjs');
  await writeFile(servedPath, client.text, { mode: 0o600 });
  const syntax = spawnSync(process.execPath, ['--check', servedPath], { encoding: 'utf8', timeout: 5000 });
  receipt.servedModule = { path: servedPath, bytes: Buffer.byteLength(client.text), sha256: hash(client.text), contentType: client.contentType, syntax: { command: [process.execPath, '--check', servedPath], status: syntax.status, signal: syntax.signal, stdout: syntax.stdout, stderr: syntax.stderr, error: syntax.error?.message || null } };
  assert.equal(syntax.status, 0);
  const asset = await get('/monitor/assets/studio.js'); assert.equal(asset.status, 200);
  receipt.packagedClient = { servedSha256: hash(asset.text), installedSha256: hash(await readFile(path.join(packageRoot, 'resources/assets/js/monitor/studio.js'))) };
  assert.equal(receipt.packagedClient.servedSha256, receipt.packagedClient.installedSha256);
  receipt.labels = ['Observe delayed health to traces', 'Observe destroy during delayed health', 'Observe polling for five seconds', 'Record status and focus'].map(label => ({ label, present: client.text.includes(label) }));
  assert.ok(receipt.labels.every(item => item.present));
} catch (error) { receipt.error = { name: error.name, message: error.message }; }
finally {
  child.stdin.end('close\n'); receipt.cleanup.exit = await exited; clearTimeout(bound);
  if (url) { try { await get('/qualification/status'); receipt.cleanup.listenerClosed = false; } catch (error) { receipt.cleanup.listenerClosed = error.code === 'ECONNREFUSED'; receipt.cleanup.listenerProbeCode = error.code || error.name; } }
  const log = await readFile(path.join(evidence, session + '.jsonl'), 'utf8').catch(() => '');
  receipt.cleanup.closedReceipt = log.split('\n').filter(Boolean).map(line => JSON.parse(line)).findLast(item => item.kind === 'closed') || null;
  receipt.stderr = stderr; receipt.finishedAt = new Date().toISOString();
  receipt.outcome = !receipt.error && receipt.cleanup.exit.code === 0 && receipt.cleanup.listenerClosed && receipt.cleanup.closedReceipt?.listening === false ? 'PASS' : 'FAIL';
  await writeFile(path.join(evidence, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
}
console.log(JSON.stringify({ scope: receipt.scope, outcome: receipt.outcome, wrapperHash: receipt.fixtureScriptSha256, syntaxExit: receipt.servedModule?.syntax?.status, cleanup: receipt.cleanup, error: receipt.error || null }));
process.exitCode = receipt.outcome === 'PASS' ? 0 : 1;
