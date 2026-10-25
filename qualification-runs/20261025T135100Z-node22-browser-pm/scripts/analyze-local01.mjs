import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const run = fileURLToPath(new URL('../', import.meta.url));
const browser = path.join(run, 'browser');
const logPath = path.join(browser, 'final-local-01.jsonl');
const bytes = await readFile(logPath);
const rows = bytes.toString('utf8').trim().split('\n').map((line, i) => ({ ...JSON.parse(line), line: i + 1 }));
const hash = value => createHash('sha256').update(value).digest('hex');
const inputPath = path.join(browser, 'final-local-01-input.json');
const input = JSON.parse(await readFile(inputPath));
const distribution = JSON.parse(await readFile(path.join(run, 'final/distribution.json')));
assert.equal(rows[0].session, 'final-local-01');
assert(rows.every(row => row.session === 'final-local-01'));
assert.equal(rows.at(-1).kind, 'closed', 'Analyze only the closed session.');
assert.equal(input.root, distribution.installed.package);
assert.equal(hash(await readFile(distribution.archive)), distribution.sha256);
for (const [file, sha256] of Object.entries(input.files)) {
  assert.equal(distribution.inventory.find(row => row.path === file)?.sha256, sha256);
  assert.equal(hash(await readFile(path.join(input.root, file))), sha256);
}
const notePath = path.join(browser, 'local01-native-observations.md');
const harnessPath = path.join(run, 'scripts/native-browser-fixture-v1.mjs');
const groups = new Map();
for (const row of rows) if (row.case) { if (!groups.has(row.case)) groups.set(row.case, []); groups.get(row.case).push(row); }
const group = name => groups.get(name) || [];
const events = (name, kind) => group(name).filter(row => row.kind === 'browser-event' && row.input.kind === kind);
const observations = name => events(name, 'observation');
const prompts = name => events(name, 'native-prompt');
const requests = (name, expression) => group(name).filter(row => row.kind === 'request' && expression.test(row.path));
const mutations = name => group(name).filter(row => row.kind === 'mutation');
const lines = values => values.map(row => row.line);
const unchanged = (before, after) => ['mutations', 'silences', 'alertState', 'incidentState'].every(key => before[key] === after[key]);
const subcases = [];
const add = (id, status, details) => subcases.push({ id, status, ...details });
for (const [id, answers] of [['local01-cancel-rule', [null]], ['local01-cancel-duration', ['fixture-alert', null]], ['local01-cancel-reason', ['fixture-alert', '60', null]]]) {
  const intent = events(id, 'intent')[0], prompt = prompts(id), observation = observations(id).at(-1);
  const match = JSON.stringify(prompt.map(row => row.input.result)) === JSON.stringify(answers);
  const mutationRequests = group(id).filter(row => row.kind === 'request' && row.path.startsWith('/monitor/api/') && ['POST', 'DELETE'].includes(row.method));
  const ok = match && intent && observation && mutationRequests.length === 0 && mutations(id).length === 0 && unchanged(intent.server, observation.server);
  add(id, ok ? 'PASS' : 'FAIL', { requirement: 'Real native Cancel causes no corresponding operator mutation', evidenceType: 'delegated native prompt result plus independent server requests/state', lines: lines([intent, ...prompt, observation].filter(Boolean)), promptResults: prompt.map(row => row.input.result), mutationRequests: mutationRequests.length, before: intent?.server, after: observation?.server });
}
const resolution = 'local01-cancel-resolution';
const rp = prompts(resolution)[0], ro = observations(resolution).at(-1), ri = events(resolution, 'intent')[0];
const resolveRequests = requests(resolution, /\/resolve$/);
add('resolution-native-cancel', rp?.input.result === null && resolveRequests.length === 0 && unchanged(rp.server, ro.server) ? 'PASS' : 'FAIL', { requirement: 'Cancel resolution itself leaves the current synthetic incident unchanged', lines: lines([rp, ro]), resolutionRequests: resolveRequests.length, stateAtPrompt: rp.server, stateAfterCancel: ro.server, qualification: 'Passed only after a separately recorded accidental acknowledgement; not a case-wide zero-mutation result.' });
add('resolution-case-targeting', mutations(resolution).length === 1 ? 'FAIL' : 'BLOCKED', { layer: 'native controller action targeting', productDefectEstablished: false, lines: lines([ri, ...mutations(resolution), ro]), before: ri.server, after: ro.server, reason: 'The case intent was resolution cancellation, but a synthetic acknowledge POST completed first. That mutation remains preserved in this receipt.' });
const allObservations = rows.filter(row => row.kind === 'browser-event' && row.input.kind === 'observation');
const requiredViews = ['overview', 'health', 'metrics', 'traces', 'resources', 'alerts', 'slos', 'incidents', 'fleet', 'deployments', 'diagnostics'];
const views = requiredViews.map(view => { const hits = allObservations.filter(row => row.input.client?.view === view && row.input.mainText && row.input.mainText !== 'Loading…' && !row.input.mainText.startsWith('Monitor Studio\n')); return { view, status: hits.length ? 'PASS' : 'BLOCKED', observationLines: lines(hits), sample: hits[0]?.input.mainText.split('\n').filter(Boolean).slice(0, 2).join(' / ') }; });
add('eleven-main-views', views.every(row => row.status === 'PASS') ? 'PASS' : 'BLOCKED', { requirement: 'Render each required main view', views, limit: 'Rendering and snapshots only; not full acceptance of every control.' });
const diagnostic = observations('local01-diagnostic-inspection')[0];
const dget = requests('local01-diagnostic-inspection', /\/diagnostics$/)[0];
const dresume = requests('local01-diagnostic-inspection', /\/doctor$/)[0];
add('diagnostic-full-inspection', diagnostic?.input.mainText.includes('Live refresh paused while inspecting.') && diagnostic.input.mainText.includes('Runtime diagnostics') && dget ? 'PASS' : 'FAIL', { lines: lines([dget, diagnostic].filter(Boolean)), evidence: 'The requested full diagnostic snapshot and paused-inspection banner were observed.', limit: 'One recorded post-load snapshot; this is not a repeated deadline/poll preservation proof.' });
add('diagnostic-resume-request', dresume ? 'PASS' : 'BLOCKED', { lines: lines([dresume].filter(Boolean)), evidenceType: 'server request correlated with authored native Resume-click note', nativeNote: path.basename(notePath), limit: 'Resumed presentation was not captured.' });
add('diagnostic-resume-presentation', 'BLOCKED', { reason: 'No subsequent diagnostics observation proves the full snapshot cleared and live presentation resumed before navigation.' });
add('native-trace-detail', 'BLOCKED', { lines: lines(group('local01-view-traces')), detailRequests: requests('local01-view-traces', /\/traces\//).length, nativeNote: path.basename(notePath), reason: 'Native table-cell targeting and Return did not open details; coordinate control returned noWindowsAvailable. No detail HTTP request or detail presentation was observed.', productDefectEstablished: false });
for (const [id, expected] of [['local01-empty', 'No sampled spans found.'], ['local01-error', 'Fixture unavailable <script>alert(1)</script>'], ['local01-recovery', 'Live operational state across this RawNode runtime.']]) {
  const o = observations(id).at(-1);
  add(id, o?.input.mainText.includes(expected) ? 'PASS' : 'FAIL', { lines: lines(group(id)), renderedText: expected, recordedErrors: o?.input.errors, observedImageElements: o?.input.images });
}
const sse = 'local01-sse-reconnect';
const disconnected = observations(sse).find(row => row.input.client.connected === false && row.server.clients === 0);
const reconnected = observations(sse).find(row => row.input.client.connected === true && row.server.clients === 1);
const streamRequest = requests(sse, /\/stream$/)[0], disconnectRequest = requests(sse, /\/disconnect$/)[0];
add('native-tokenless-sse-reconnection', disconnected && reconnected && streamRequest && disconnectRequest && disconnectRequest.line < disconnected.line && disconnected.line < streamRequest.line && streamRequest.line < reconnected.line ? 'PASS' : 'FAIL', { lines: lines([disconnectRequest, disconnected, streamRequest, reconnected].filter(Boolean)), evidence: 'The packaged fixture disconnects the existing server stream; browser reports disconnected with zero clients, then a fresh stream request and connected with one client. Packaged client uses native window.EventSource; this fixture does not manually reopen it.', authMode: 'tokenless loopback local mode', limit: 'This does not qualify native EventSource with bearer-only authentication.' });
const cycleRows = group('local01-cycle20');
const afterCycle = events('local01-all-rules', 'intent')[0];
add('cycle-twenty-completion', 'PASS', { evidenceType: 'authored native transcript observation of packaged completion text', nativeNote: path.basename(notePath), text: '20 mount cycles complete', supportingRequestLines: lines(cycleRows.filter(row => row.kind === 'request' && row.path.startsWith('/monitor/api/'))), exactIterationEventsRecorded: false });
add('cycle-stream-client-ownership', afterCycle?.server.clients === 1 && afterCycle.server.signalListeners === 1 ? 'PASS' : 'FAIL', { lines: [afterCycle.line], after: afterCycle.server, scope: 'One server stream client and baseline signal listener count after the completed cycle action; not an exact browser polling-timer count.' });
add('polling-timer-cardinality', 'BLOCKED', { reason: 'snapshot.polling is a boolean, not a timer count. Request timestamps and unchanged screenshots do not establish exactly one timer.' });
const allRules = 'local01-all-rules';
const ap = prompts(allRules), am = mutations(allRules), ao = observations(allRules).at(-1);
add('deliberate-empty-rule-all-rules-silence', JSON.stringify(ap.map(row => row.input.result)) === JSON.stringify(['', '2.5', 'Synthetic qualification']) && am.length === 1 && am[0].status === 200 && am[0].before.silences === 0 && am[0].after.silences === 1 && ao.input.mainText.includes('Synthetic qualification\tAll') ? 'PASS' : 'FAIL', { lines: lines([...ap, ...am, ao]), promptResults: ap.map(row => row.input.result), appliedSilences: 1, scope: 'Deliberately submitted empty rule differs from null Cancel; native UI shows All and one server silence exists.', limit: 'Exact stored ruleIds/duration were not recorded by this external browser log.' });
const invalid = 'local01-invalid-duration';
const ip = prompts(invalid), ii = events(invalid, 'intent')[0], io = observations(invalid).at(-1);
add('invalid-zero-duration-rejection', JSON.stringify(ip.map(row => row.input.result)) === JSON.stringify(['fixture-alert', '0']) && mutations(invalid).length === 0 && unchanged(ii.server, io.server) ? 'PASS' : 'FAIL', { lines: lines([ii, ...ip, io]), mutationRequests: requests(invalid, /\/silences$/).length, scope: 'Rejected zero duration, no reason prompt, no operator mutation, unchanged synthetic state.' });
add('invalid-duration-visible-feedback', 'PASS', { evidenceType: 'authored native transcript observation, not v1 mainText JSON', nativeNote: path.basename(notePath), text: 'Silence duration must be a positive number of minutes (whole milliseconds).' });
const failed = mutations('local01-mutation-failure')[0];
add('forced-mutation-failure-state', failed?.status === 503 && failed.before.silences === failed.after.silences && failed.before.incidentState === failed.after.incidentState ? 'PASS' : 'FAIL', { lines: lines(group('local01-mutation-failure')), statusCode: failed?.status, operatorRequestCountIncrements: 1, appliedStateChange: false, reason: 'The external fixture fails the next deliberate synthetic mutation before delegating it.' });
add('forced-mutation-failure-visible-feedback', 'PASS', { evidenceType: 'authored native transcript observation, not v1 mainText JSON', nativeNote: path.basename(notePath), text: 'Synthetic failure <script>unsafe</script>' });
const delayed = observations('local01-delay-navigation').at(-1);
add('delayed-navigation-health-rendered', delayed?.input.client.view === 'health' && delayed.input.mainText.startsWith('Health\n') ? 'PASS' : 'FAIL', { lines: lines(group('local01-delay-navigation')), scope: 'Health rendered under a delayed fixture.' });
add('navigation-during-pending-response-race', 'BLOCKED', { reason: 'The native control sequence was slower than the 500 ms delay; no controlled overlapping response/cancellation boundary was captured.' });
const destroyed = observations('local01-destroy').at(-1), closed = rows.at(-1);
add('native-unmount-stream-release', destroyed?.input.client.destroyed === true && destroyed.server.clients === 0 ? 'PASS' : 'FAIL', { lines: [destroyed.line], state: destroyed.server, scope: 'Destroyed client snapshot and zero server stream clients; no exact browser listener/timer census.' });
add('fixture-close', closed.reason === 'stdin' && closed.listening === false && closed.server.clients === 0 && closed.server.signalListeners === 0 ? 'PASS' : 'FAIL', { lines: [closed.line - 1, closed.line], closed, processExit: { code: 0, evidenceType: 'parent execution result reported in authored note' } });
add('captured-client-errors', allObservations.every(row => row.input.errors.length === 0) ? 'PASS' : 'FAIL', { observationCount: allObservations.length, scope: 'No captured window error/unhandled rejection/CSP events after instrumentation; not a full console or network audit.' });
add('synthetic-html-rendering', allObservations.every(row => row.input.images === 0) ? 'PASS' : 'FAIL', { scope: 'Captured app image-element count remained zero while synthetic HTML appeared literally in main text and native failure feedback.', universalEscapingClaim: false });
add('narrow-mobile-layout-keyboard-focus', 'BLOCKED', { observedWidths: [...new Set(allObservations.map(row => row.input.width))], reason: 'Only observed desktop/800px widths are in this log; no complete narrow/mobile or keyboard/focus acceptance sequence.' });
add('token-authenticated-polling-mode', 'UNRUN', { reason: 'This closed session is tokenless local mode; token/session authorization needs its separate identified session.' });
const caseIndex = [...groups].map(([id, values]) => ({ id, firstLine: values[0].line, lastLine: values.at(-1).line, intentLines: lines(events(id, 'intent')), promptLines: lines(prompts(id)), observationLines: lines(observations(id)), mutationLines: lines(mutations(id)) }));
const receipt = {
  session: 'final-local-01', status: 'BLOCKED', scope: 'Partially completed native Safari local-mode acceptance; mandatory trace/pending-operation/other interaction dimensions remain incomplete. A controller targeting failure is retained separately from product behavior.',
  analyzedAt: new Date().toISOString(), log: { path: path.basename(logPath), sha256: hash(bytes), bytes: bytes.length, lines: rows.length, firstAt: rows[0].at, lastAt: closed.at },
  input: { path: path.basename(inputPath), sha256: hash(await readFile(inputPath)), ...input },
  artifact: { path: distribution.archive, sha256: distribution.sha256, bytes: distribution.bytes, files: distribution.packedFiles, installedRootMatchesDistribution: true, servedInputFileHashesMatchArchive: input.files },
  externalHarness: { path: path.relative(run, harnessPath), sha256: hash(await readFile(harnessPath)), delegatesNativePromptUnchanged: true, suppliedPromptAnswers: false, instrumentationChanges: ['unique title', 'no-store response headers', 'appended fixture-only controls and observations', 'bounded independent server mutation/state receipts'], packagedRuntimeEdited: false },
  browser: { userAgents: [...new Set(allObservations.map(row => row.input.userAgent))], mode: 'native Safari session per parent transcript; private/profile internals not independently captured in JSONL', appBuildIndependentlyCaptured: false },
  nativeObservationNote: { path: path.basename(notePath), sha256: hash(await readFile(notePath)), type: 'authored from root agent native transcript report; not raw browser output' },
  subcases, caseIndex,
  totals: { subcaseStatuses: Object.fromEntries(['PASS', 'FAIL', 'BLOCKED', 'UNRUN'].map(status => [status, subcases.filter(row => row.status === status).length])), operatorMutationRequests: rows.filter(row => row.kind === 'mutation').length, appliedSyntheticMutations: rows.filter(row => row.kind === 'mutation' && row.status < 400).map(row => ({ line: row.line, path: row.path, status: row.status })), forcedRejectedMutations: rows.filter(row => row.kind === 'mutation' && row.status >= 400).map(row => ({ line: row.line, path: row.path, status: row.status })), mainViewsObserved: views.filter(row => row.status === 'PASS').length },
  limitations: ['One local session; repeated Cancel acceptance belongs to subsequent separately identified sessions.', 'Static screenshots or polling booleans do not prove polling progress/cardinality.', 'Diagnostic full snapshot text in raw JSONL contains task-local configuration; this receipt intentionally retains only bounded excerpts and hashes.', 'No inference of external-service, production, cross-browser, accessibility-audit, or release authorization.']
};
await writeFile(path.join(browser, 'local01-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ session: receipt.session, status: receipt.status, logLines: rows.length, totals: receipt.totals, remaining: subcases.filter(row => ['BLOCKED', 'UNRUN'].includes(row.status)).map(row => row.id) }));
