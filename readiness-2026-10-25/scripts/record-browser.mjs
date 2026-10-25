import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Consolidates observed native UI results and saved task-server records.
// It does not automate a browser or infer acceptance from asset requests.
const task = 'readiness-2026-10-25';
const distribution = JSON.parse(await readFile(`${task}/distribution.json`));
const requests = (await readFile(`${task}/browser-requests.jsonl`, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const prompts = (await readFile(`${task}/browser-requests.jsonl.prompts.jsonl`, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const firstCancel = prompts.find(row => row.sequence === 1 && row.result === null);
const nextPrompt = prompts.find(row => row.sequence === 2);
const mutations = requests.filter(row => ['POST', 'DELETE'].includes(row.method) && row.path.startsWith('/monitor/api/'));
const artifactHash = createHash('sha256').update(await readFile(distribution.archive)).digest('hex');
if (artifactHash !== distribution.sha256) throw Error('Archive changed');
const receipt = {
  recordedAt: new Date().toISOString(),
  archive: distribution.archive, sha256: distribution.sha256, bytes: distribution.bytes,
  fixture: `${distribution.installed.package}/examples/studio-fixture.mjs`,
  scope: 'Actual native Chrome/Safari UI through cua_repl, exact offline-installed package. External wrapper preserves native prompt returns and original authorization/CSP; only synthetic fixture controls/metadata are added.',
  status: 'partial; full real-browser acceptance remains unverified',
  availability: { nativeApps: ['Google Chrome', 'Safari'], browserConnectors: [], chrome: { version: '155.0.8059.85', source: 'installed bundle plist', reducedUserAgent: '155.0.0.0' }, safari: { version: '27.0', build: '20625.1.29.18.28', source: '/System/Volumes/Preboot/Cryptexes/App/System/Applications/Safari.app/Contents/Info.plist' } },
  verifiedObservations: [
    'Safari rendered packaged Overview and Alerts, including synthetic service/rule markup as literal text, live healthy state, firing alert and Create silence.',
    'Safari first rule-ID prompt was explicitly cancelled. Native prompt instrumentation returned null, the alert remained firing with no silence listed, and no operator mutation was logged before the next prompt sequence.',
    'Chrome initially exposed a blank native view; selecting the task window later exposed the rendered packaged Overview with healthy state and synthetic identity.',
    'After deliberate fixture shutdown Chrome showed Polling, Unable to load overview, Failed to fetch and Retry. This is only an observed failure state, not a recovery/reconnection test.'
  ],
  firstCancel: { prompt: firstCancel, mutationCountBeforeNextPrompt: mutations.filter(row => firstCancel && nextPrompt && row.at >= firstCancel.receivedAt && row.at < nextPrompt.receivedAt).length },
  ambiguousDialogSequence: { prompts: prompts.filter(row => row.sequence > 1), operatorMutations: mutations, disposition: 'Not a passing duration/reason Cancel or intentional-success test. Native control reported user-changed surface while subsequent prompt instrumentation recorded default acceptances and one synthetic silence POST.' },
  blockers: [
    'Native automation repeatedly reported user-changed Chrome/Safari surfaces; re-querying Chrome selected another ongoing local validation window. The task window was selected through the Window menu without editing other work, but it did not stay reliably selected through subsequent actions.',
    'Safari native-dialog cancellation attempt became ambiguous; subsequent state/getApp calls failed with timeoutReached. Chrome also returned initially blank/stale accessibility and screenshot state.',
    'A fresh fixture with interactive stdin and guarded task-window selection was attempted; native control again reported user-changed surface before dependable further acceptance. No browser-security setting was weakened.'
  ],
  notVerifiedFresh: [
    'All eleven navigation views, trace details and redaction, retained inspection/filter/focus across polling',
    'Duration/reason/incident-resolution native Cancel, intentional operator actions/removal, validation and mutation error feedback',
    'Loading/empty/recovery, rapid pending navigation/actions, repeated mount/destroy, one polling/stream owner, native SSE reconnection and polling fallback',
    'Narrow layout, keyboard/focus, accessible status/labels, console/CSP audit and assistive technologies'
  ],
  separateEvidence: {
    automated: '97-test final native/extracted/installed suites include modeled DOM/action/security regressions; HTTP/SSE 33 checks and HMAC/token 19 checks are separate protocol results.',
    historical: 'readiness-2026-10-24/final/browser.json and studio-inspection.jpg remain unchanged observations for archive218b62b5…. Their broader Chrome observations are not relabeled as fresh final-archive acceptance.',
    files: ['browser-requests.jsonl', 'browser-requests.jsonl.prompts.jsonl', 'scripts/studio-browser-fixture.mjs'],
    screenshots: 'Native screenshots/accessibility states were inspected in the tool transcript. No new successful acceptance screenshot was saved; the prior dated inspection screenshot remains historical.'
  },
  cleanup: {
    firstFixture: 'Original non-TTY exec session could not receive close because stdin was closed. Verified lsof listener51393 and ps command identified only task-created PID39319; authorized SIGTERM exited143. Subsequent lsof found no listener.',
    retryFixture: 'Interactive session23756 received close on stdin and exited0; port52995 has no listener. Native control failed before navigation, so no retry request log was created.',
    browserWindows: 'Task-created Monitor windows/DevTools may remain open because native control could not reliably retain the selected window. No other window was edited or closed. Both fixture servers are stopped.',
    productionProcessesSignalled: false
  }
};
await writeFile(`${task}/browser.json`, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ status: receipt.status, sha256: receipt.sha256, firstCancel: receipt.firstCancel, requests: requests.length, mutations: mutations.length }));
