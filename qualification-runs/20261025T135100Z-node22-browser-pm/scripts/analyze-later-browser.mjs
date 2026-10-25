import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const run = fileURLToPath(new URL('../', import.meta.url));
const browser = path.join(run, 'browser');
const distribution = JSON.parse(await readFile(path.join(run, 'final/distribution.json')));
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(hash(await readFile(distribution.archive)), distribution.sha256);
const environment = JSON.parse(await readFile(path.join(browser, 'environment.json')));
for (const suffix of process.argv.slice(2).length ? process.argv.slice(2) : ['02', '03']) {
  assert(['02', '03', '04'].includes(suffix));
  const session = `final-local-${suffix}`;
  const prefix = `local${suffix}`;
  const raw = await readFile(path.join(browser, session + '.jsonl'));
  const rows = raw.toString().trim().split('\n').map((line, i) => ({ ...JSON.parse(line), line: i + 1 }));
  assert(rows.every(row => row.session === session));
  const closed = rows.at(-1);
  assert.equal(closed.kind, 'closed', `Wait for ${session} to close before making its final receipt.`);
  const input = JSON.parse(await readFile(path.join(browser, session + '-input.json')));
  assert.equal(input.root, distribution.installed.package);
  for (const [file, sha256] of Object.entries(input.files)) {
    assert.equal(distribution.inventory.find(row => row.path === file)?.sha256, sha256);
    assert.equal(hash(await readFile(path.join(input.root, file))), sha256);
  }
  const harnessPath = path.join(run, `scripts/native-browser-fixture-v${suffix === '04' ? '4' : '3'}.mjs`);
  const select = name => rows.filter(row => row.case === `${prefix}-${name}`);
  const event = (name, kind) => select(name).filter(row => row.kind === 'browser-event' && row.input.kind === kind);
  const observations = name => event(name, 'observation');
  const lineNumbers = entries => entries.filter(Boolean).map(row => row.line);
  const subcases = [];
  const add = (id, status, details) => subcases.push({ id, status, ...details });
  const unchanged = (before, after) => ['mutations', 'silences', 'alertState', 'incidentState'].every(key => before[key] === after[key]);
  for (const [stage, count, promptMessage] of [['rule', 1, 'Rule ID'], ['duration', 2, 'Silence duration'], ['reason', 3, 'Reason:'], ['resolution', 1, 'Resolution note:']]) {
    const name = 'cancel-' + stage;
    if (!select(name).length) continue;
    const intent = event(name, 'intent')[0], prompts = event(name, 'native-prompt'), after = observations(name).at(-1);
    const mutationRequests = select(name).filter(row => row.kind === 'request' && row.path.startsWith('/monitor/api/') && ['POST', 'DELETE'].includes(row.method));
    const ok = intent && after && prompts.length === count && prompts.at(-1).input.message.startsWith(promptMessage) && prompts.at(-1).input.result === null && prompts.slice(0, -1).every(row => typeof row.input.result === 'string') && mutationRequests.length === 0 && unchanged(intent.server, after.server);
    add(name, ok ? 'PASS' : 'FAIL', { evidenceType: 'delegated native prompt and independent server request/state receipts', lines: lineNumbers([intent, ...prompts, after]), promptResults: prompts.map(row => row.input.result), mutationRequests: mutationRequests.length, before: intent?.server, after: after?.server, cleanCase: ok && intent.server.mutations === 0 && intent.server.incidentState === 'open' });
  }
  if (suffix === '02') {
    const trace = observations('trace-inspection');
    const paused = trace.filter(row => row.input.mainText.includes('Live refresh paused while inspecting.'));
    const resumed = trace.find(row => !row.input.mainText.includes('Live refresh paused while inspecting.'));
    const detail = select('trace-inspection').find(row => row.kind === 'request' && /\/traces\//.test(row.path));
    const resumedRequest = select('trace-inspection').find(row => row.kind === 'request' && row.path.endsWith('/api/traces') && paused.at(-1) && row.line > paused.at(-1).line);
    add('trace-detail-redaction', detail && paused.length >= 1 && paused[0].input.mainText.includes('"token": "[REDACTED]"') && !paused[0].input.mainText.includes('fixture-secret') && paused[0].input.images === 0 ? 'PASS' : 'FAIL', { lines: lineNumbers([detail, paused[0]]), scope: 'Actual native browser requested and rendered the trace details, span fields and redacted token. Keyboard triggering is reported by the parent native transcript, separately from raw JSONL.' });
    add('trace-retained-observation', paused.length >= 2 && paused[0].input.mainText === paused[1].input.mainText ? 'PASS' : 'BLOCKED', { lines: lineNumbers(paused), milliseconds: paused.length >= 2 ? Date.parse(paused[1].at) - Date.parse(paused[0].at) : null, scope: 'Identical paused details in two observations; not a proof of visible polling deadlines because visibility was not captured.' });
    add('trace-resume-presentation', resumed && resumedRequest && resumedRequest.line < resumed.line && !resumed.input.mainText.includes('"spanId"') ? 'PASS' : 'FAIL', { lines: lineNumbers([paused.at(-1), resumedRequest, resumed]), scope: 'Resume produced a fresh traces read and a new list presentation without the paused detail content.' });
  }
  if (suffix === '03') {
    const name = 'valid-resolution';
    const prompt = event(name, 'native-prompt')[0];
    const mutation = select(name).find(row => row.kind === 'mutation');
    const observed = observations(name).find(row => row.input.client?.view === 'incidents');
    add('intentional-incident-resolution', prompt?.input.result === 'Synthetic issue mitigated intentionally' && mutation?.status === 200 && mutation.path.endsWith('/resolve') && mutation.before.incidentState === 'open' && mutation.after.incidentState === 'resolved' && observed?.server.incidentState === 'resolved' && observed.input.mainText.includes('resolved') ? 'PASS' : 'FAIL', { lines: lineNumbers([prompt, mutation, observed]), scope: 'A separate deliberate action after completed Cancel controls resolves only the synthetic incident.' });
  }
  if (suffix === '04') {
    for (const action of ['pending-navigation', 'pending-destroy']) {
      const record = event(action, 'lifecycle-observation').find(row => row.input.action === action);
      const value = record?.input;
      const admitted = select(action).filter(row => row.kind === 'request' && row.path.startsWith('/monitor/api/') && row.line < record.line);
      const common = value && value.fixtureDelayMs === 500 && value.elapsedMs >= 650 && value.settlement.timedOut === false && value.settlement.results.every(row => row.status === 'fulfilled') && admitted.some(row => row.path.endsWith('/health'));
      const good = action === 'pending-navigation' ? common && value.after.client.view === 'traces' && value.after.mainText.startsWith('Traces\n') && value.after.ariaBusy === 'false' && admitted.some(row => row.path.endsWith('/traces')) : common && value.domUnchangedAfterDestroy === true && value.disposedClient.destroyed && value.disposedClient.streaming === false && value.disposedClient.polling === false && value.after.ariaBusy === 'false' && record.server.clients === 0;
      add(action, good ? 'PASS' : 'FAIL', { lines: lineNumbers([...admitted, record]), evidenceType: 'native-clicked external control executes the actual packaged public browser client; not a DOM model', fixtureDelayMs: value?.fixtureDelayMs, elapsedMs: value?.elapsedMs, settlement: value?.settlement, admittedPaths: admitted.map(row => ({ at: row.at, path: row.path })), finalClient: value?.disposedClient || value?.after.client, visibility: value?.after.visibility, finalServer: record?.server, scope: action === 'pending-navigation' ? 'Immediate health-to-traces navigation settles on traces after both actual requests arrived; old view does not replace the final view.' : 'Destroy during an admitted delayed health request leaves the DOM unchanged after settlement, releases stream ownership and reports polling false.' });
    }
    const narrow = rows.filter(row => row.kind === 'browser-event' && row.input.kind === 'observation' && row.input.width < 500);
    add('narrow-css-viewport', narrow.length && narrow.every(row => row.input.width === row.input.documentWidth) ? 'PASS' : 'BLOCKED', { lines: lineNumbers(narrow), observations: narrow.map(row => ({ width: row.input.width, documentWidth: row.input.documentWidth, view: row.input.client.view })), scope: 'Observed narrow CSS viewport has no document horizontal overflow; native accessibility navigation is parent-observed. Not a full mobile/accessibility audit.' });
    const polling = rows.filter(row => row.kind === 'browser-event' && row.input.kind === 'lifecycle-observation' && row.input.action === 'poll-window');
    const visiblePolling = polling.filter(row => row.input.before.visibility === 'visible' && row.input.after.visibility === 'visible' && row.input.elapsedMs >= 5000 && row.input.requestDelta > 0 && row.input.mutationDelta === 0);
    add('visible-polling-progress', visiblePolling.length ? 'PASS' : polling.length ? 'BLOCKED' : 'UNRUN', { mandatoryInThisSession: false, lines: lineNumbers(polling), observations: polling.map(row => ({ beforeVisibility: row.input.before.visibility, afterVisibility: row.input.after.visibility, elapsedMs: row.input.elapsedMs, requestDelta: row.input.requestDelta, mutationDelta: row.input.mutationDelta })), reason: visiblePolling.length ? 'A bounded visible window records continuing requests without mutations.' : 'No bounded visible poll-window with request progress is recorded here; the separately selected token05 mode carries the required native polling-progress gate. Hidden pages intentionally defer automatic refresh.', limit: 'Request progress and polling booleans do not establish exact timer or concurrent-request cardinality.' });
  }
  const destroyed = rows.filter(row => row.kind === 'browser-event' && row.input.kind === 'observation' && row.input.client?.destroyed === true);
  if (destroyed.length) add('native-unmount-stream-release', destroyed.every(row => row.server.clients === 0) ? 'PASS' : 'FAIL', { lines: lineNumbers(destroyed), scope: 'No exposed mounted handle and zero stream clients after native unmount.' });
  add('fixture-close', closed.reason === 'stdin' && closed.listening === false && closed.server.clients === 0 && closed.server.signalListeners === 0 ? 'PASS' : 'FAIL', { lines: [closed.line - 1, closed.line], reason: closed.reason, listening: closed.listening, server: closed.server, exitCode: 0, exitEvidence: 'Parent execution result; server close independently captured in raw JSONL.' });
  const result = { session, status: subcases.some(row => row.status === 'FAIL') ? 'FAIL' : subcases.some(row => row.status === 'BLOCKED' && row.mandatoryInThisSession !== false) ? 'BLOCKED' : 'PASS', scope: 'Selected session subcases only, not a full Studio acceptance pass; optional observations keep their individual status', analyzedAt: new Date().toISOString(), artifact: { path: distribution.archive, sha256: distribution.sha256, bytes: distribution.bytes, files: distribution.packedFiles }, input, log: { path: session + '.jsonl', sha256: hash(raw), lines: rows.length, startedAt: rows[0].at, finishedAt: closed.at }, harness: { path: path.relative(run, harnessPath), sha256: hash(await readFile(harnessPath)), packagedRuntimeEdited: false }, environment, subcases, mutations: rows.filter(row => row.kind === 'mutation'), limitations: ['No earlier failure or partial receipt is overwritten.', 'Native screenshots were reviewed in the conversation; no standalone screenshot export is claimed.', 'This is local tokenless mode; token/session mode has separate evidence.'] };
  await writeFile(path.join(browser, `${prefix}-receipt.json`), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify({ session, status: result.status, subcases: subcases.map(row => ({ id: row.id, status: row.status })) }));
}
