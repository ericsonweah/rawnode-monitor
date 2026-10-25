import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const run = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const [packageArg, session = 'token-http-review-01'] = process.argv.slice(2);
if (!packageArg || !/^[a-z0-9-]+$/.test(session)) throw Error('Expected absolute installed package path and unique session');
const packageRoot = path.resolve(packageArg);
const fixtureScript = path.join(run, 'scripts/native-browser-fixture.mjs');
const output = path.join(run, 'browser/token-http-review');
await mkdir(output, { recursive: true, mode: 0o700 });
const digest = value => createHash('sha256').update(value).digest('hex');
const distribution = JSON.parse(await readFile(path.join(run, 'final/distribution.json')));
assert.equal(digest(await readFile(distribution.archive)), distribution.sha256);
const receipt = {
  kind: 'HTTP-only external wrapper review; no native browser result',
  startedAt: new Date().toISOString(),
  runtime: { node: process.version, executable: process.execPath, platform: process.platform, arch: process.arch },
  command: [process.execPath, fileURLToPath(import.meta.url), packageRoot, session], cwd: process.cwd(),
  archive: { path: distribution.archive, sha256: distribution.sha256 }, packageRoot, session,
  fixtureScriptSha256: digest(await readFile(fixtureScript)),
  probeScriptSha256: digest(await readFile(fileURLToPath(import.meta.url))),
  cases: [], cleanup: {},
};
const child = spawn(process.execPath, [fixtureScript, packageRoot, output, session, 'token'], { stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '', stdout = '', cookie, base;
child.stdin.on('error', error => { receipt.cleanup.stdinError = error.code || error.name; });
child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
const deadline = setTimeout(() => { receipt.cleanup.forcedTimeout = true; child.kill('SIGTERM'); }, 45000);
const ready = new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => reject(Error(`Fixture exited before readiness: ${code}`)));
  child.stdout.on('data', chunk => {
    stdout = (stdout + chunk).slice(-65536);
    const line = stdout.split('\n').find(item => item.startsWith('{') && item.includes('"controlUrl"'));
    if (line) { try { resolve(JSON.parse(line)); } catch (error) { reject(error); } }
  });
});
async function get(urlPath, { method = 'GET', headers = {}, body = '', absoluteTarget = false } = {}) {
  return await new Promise((resolve, reject) => {
    const req = request(new URL(urlPath, base), { method, agent: false, ...(absoluteTarget ? { path: new URL(urlPath, base).href } : {}), headers: { ...headers, ...(body ? { 'content-length': Buffer.byteLength(body) } : {}) } }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) req.destroy(Error('Response exceeded probe bound')); else chunks.push(chunk); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(4000, () => req.destroy(Error('Request deadline')));
    req.on('error', reject); req.end(body);
  });
}
async function check(name, pathname, expected, options = {}, verify = () => true) {
  const response = await get(pathname, options);
  const condition = verify(response);
  receipt.cases.push({ name, path: pathname.split('?')[0], method: options.method || 'GET', expectedStatus: expected, actualStatus: response.status, condition, outcome: response.status === expected && condition ? 'PASS' : 'FAIL', bodyBytes: Buffer.byteLength(response.text), bodySha256: digest(response.text) });
  return response;
}
try {
  const input = await ready;
  receipt.fixture = input; base = input.url;
  await check('shell requires host session', '/monitor', 401);
  await check('packaged asset requires host session', '/monitor/assets/studio.js', 401);
  await check('instrumentation asset requires host session', '/fixture/client.js', 401);
  await check('session rejects missing code', '/qualification/session', 403, { method: 'POST' });
  await check('session rejects wrong code', '/qualification/session', 403, { method: 'POST', body: 'code=incorrect', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const sessionResponse = await check('exact code establishes HttpOnly same-site session', '/qualification/session', 303, { method: 'POST', body: 'code=local-operator', headers: { 'content-type': 'application/x-www-form-urlencoded' } }, response => {
    const value = response.headers['set-cookie']?.[0] || '';
    return response.headers.location === '/monitor' && /HttpOnly/.test(value) && /SameSite=Strict/.test(value) && !/Expires=|Max-Age=/i.test(value);
  });
  cookie = sessionResponse.headers['set-cookie']?.[0]?.split(';')[0];
  assert.ok(cookie);
  const sessionHeaders = { cookie };
  const bearerHeaders = { cookie, authorization: 'Bearer qualification-only-token' };
  await check('session shell declares token-required without token literal', '/monitor', 200, { headers: sessionHeaders }, response => response.text.includes('data-token-required="true"') && !response.text.includes('qualification-only-token'));
  await check('session packaged asset excludes literal credential and persistent storage', '/monitor/assets/studio.js', 200, { headers: sessionHeaders }, response => !response.text.includes('qualification-only-token') && !/localStorage|sessionStorage/.test(response.text));
  await check('valid bearer without host session is denied', '/monitor/api/overview', 401, { headers: { authorization: 'Bearer qualification-only-token' } });
  await check('session alone cannot read API', '/monitor/api/overview', 401, { headers: sessionHeaders });
  await check('absolute-form API target still requires bearer', '/monitor/api/overview', 401, { headers: sessionHeaders, absoluteTarget: true });
  await check('wrong bearer cannot read API', '/monitor/api/overview', 401, { headers: { cookie, authorization: 'Bearer invalid-qualification-token' } });
  await check('query token cannot replace bearer', '/monitor/api/overview?token=synthetic-query-value', 401, { headers: sessionHeaders });
  await check('session and correct bearer can read API', '/monitor/api/overview', 200, { headers: bearerHeaders }, response => JSON.parse(response.text).ok === true);
  await check('token session has no native SSE authorization without bearer', '/monitor/api/stream', 401, { headers: sessionHeaders });
  await check('custom session retains cross-origin read rejection', '/monitor/api/overview', 403, { headers: { ...bearerHeaders, origin: 'http://cross-origin.invalid' } });
  await check('custom session retains cross-site rejection', '/monitor/api/overview', 403, { headers: { ...bearerHeaders, 'sec-fetch-site': 'cross-site' } });
  await check('custom session retains loopback Host rejection', '/monitor/api/overview', 403, { headers: { ...bearerHeaders, host: 'not-loopback.invalid' } });
  const before = JSON.parse((await get('/qualification/status')).text).server;
  await check('custom session retains mutation CSRF rejection', '/monitor/api/incidents/fixture-incident/resolve', 403, { method: 'POST', headers: { ...bearerHeaders, origin: 'http://cross-origin.invalid', 'content-type': 'application/json' }, body: '{"message":"synthetic denied mutation"}' });
  const after = JSON.parse((await get('/qualification/status')).text).server;
  receipt.cases.push({ name: 'denied CSRF mutation preserves synthetic server state', outcome: before.incidentState === after.incidentState && before.silences === after.silences && before.mutations === after.mutations ? 'PASS' : 'FAIL', before, after });
  await check('owned session can select empty fixture mode', '/fixture/mode?mode=empty', 200, { method: 'POST', headers: sessionHeaders });
  await check('empty fixture mode must not bypass bearer authorization', '/monitor/api/traces', 401, { headers: sessionHeaders });
  await check('authorized empty fixture mode returns its synthetic response', '/monitor/api/traces', 200, { headers: bearerHeaders }, response => Array.isArray(JSON.parse(response.text).data));
  await check('owned session can select error fixture mode', '/fixture/mode?mode=error', 200, { method: 'POST', headers: sessionHeaders });
  await check('error fixture mode must not bypass bearer authorization', '/monitor/api/overview', 401, { headers: sessionHeaders });
  await check('authorized error fixture mode returns synthetic failure', '/monitor/api/overview', 503, { headers: bearerHeaders });
  await check('restore seeded fixture mode', '/fixture/mode?mode=seeded', 200, { method: 'POST', headers: sessionHeaders });
  await check('owned instrumentation can arm synthetic failure', '/qualification/fail-next', 200, { method: 'POST', headers: sessionHeaders });
  await check('synthetic failure must not precede bearer authorization', '/monitor/api/incidents/fixture-incident/resolve', 401, { method: 'POST', headers: { ...sessionHeaders, 'content-type': 'application/json' }, body: '{"message":"synthetic unauthenticated request"}' });
  await check('authorized mutation receives still-armed synthetic failure', '/monitor/api/incidents/fixture-incident/resolve', 503, { method: 'POST', headers: { ...bearerHeaders, 'content-type': 'application/json' }, body: '{"message":"synthetic authorized failure"}' });
  const finalState = JSON.parse((await get('/qualification/status')).text).server;
  receipt.cases.push({ name: 'all refused/failure probes preserve incident and silence state', outcome: finalState.incidentState === 'open' && finalState.silences === 0 ? 'PASS' : 'FAIL', state: finalState });
  await check('select empty fixture mode for bounded limiter probe', '/fixture/mode?mode=empty', 200, { method: 'POST', headers: sessionHeaders });
  const burst = await Promise.all(Array.from({ length: 150 }, () => get('/monitor/api/traces', { headers: bearerHeaders })));
  const statuses = Object.fromEntries([...new Set(burst.map(item => item.status))].map(status => [status, burst.filter(item => item.status === status).length]));
  receipt.cases.push({ name: 'manager rate limit remains enforced before synthetic empty responses', selectedRequests: 150, statuses, outcome: burst.some(item => item.status === 429) && burst.every(item => [200, 429].includes(item.status)) && burst.filter(item => item.status === 429).every(item => item.headers['retry-after']) ? 'PASS' : 'FAIL' });
} catch (error) {
  receipt.error = { name: error.name, message: error.message };
} finally {
  child.stdin.end('close\n');
  receipt.cleanup.exit = await exited;
  clearTimeout(deadline);
  if (base) {
    try { await get('/qualification/status'); receipt.cleanup.listenerClosed = false; }
    catch (error) { receipt.cleanup.listenerClosed = error.code === 'ECONNREFUSED'; receipt.cleanup.listenerProbeCode = error.code || error.name; }
  }
  const jsonlPath = path.join(output, `${session}.jsonl`);
  const events = await readFile(jsonlPath, 'utf8').catch(() => '');
  receipt.cleanup.closedReceipt = events.split('\n').filter(Boolean).map(line => JSON.parse(line)).findLast(item => item.kind === 'closed') || null;
  receipt.logReview = {
    path: jsonlPath, bytes: Buffer.byteLength(events), sha256: digest(events),
    rawBearerValuePresent: events.includes('qualification-only-token'), rawSessionCookiePresent: !!cookie && events.includes(cookie),
    queryTokenValuePresent: events.includes('synthetic-query-value'),
    scope: 'HTTP headers/queries from this probe; no native browser, native prompt, storage observation or browser-event payload acceptance is claimed.',
  };
  receipt.stderr = stderr;
  receipt.finishedAt = new Date().toISOString();
  receipt.outcome = !receipt.error && receipt.cases.every(item => item.outcome === 'PASS') && receipt.cleanup.exit.code === 0 && receipt.cleanup.listenerClosed && receipt.cleanup.closedReceipt?.listening === false && !receipt.logReview.rawBearerValuePresent && !receipt.logReview.rawSessionCookiePresent ? 'PASS' : 'FAIL';
  await writeFile(path.join(output, `${session}-probe.json`), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
}
console.log(JSON.stringify({ session, outcome: receipt.outcome, cases: receipt.cases.length, failed: receipt.cases.filter(item => item.outcome === 'FAIL').map(item => item.name), cleanup: receipt.cleanup, error: receipt.error || null }));
process.exitCode = receipt.outcome === 'PASS' ? 0 : 1;
