import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { mountMonitorStudio } from '../resources/assets/js/monitor/studio.js';

// A deliberately small DOM model; real-browser acceptance is a separate gate.
class Element extends EventTarget {
  constructor() { super(); this.dataset = {}; this.attrs = {}; this.elements = new Map(); this.hidden = true; this.disabled = false; this.value = ''; this.open = false; this.textContent = ''; this.classList = { add() {}, remove() {}, toggle() {} }; }
  set innerHTML(value) { this.html = value; this.elements.clear(); }
  get innerHTML() { return this.html || ''; }
  querySelector(selector) { if (!this.elements.has(selector)) this.elements.set(selector, new Element()); return this.elements.get(selector); }
  querySelectorAll(selector) {
    if (/^[a-z, \[\]]+$/.test(selector)) {
      const names = selector.replace('[open]', '').split(', ');
      return [...this.innerHTML.matchAll(/<(input|select|textarea|summary|details)\b([^>]*)>/g)]
        .filter(match => names.includes(match[1]))
        .map((match, index) => this.querySelector(/id="([^"]+)"/.exec(match[2])?.[1] ? `#${/id="([^"]+)"/.exec(match[2])[1]}` : `${match[1]}:${index}`))
        .filter(element => !selector.includes('[open]') || element.open);
    }
    const className = /^\.([\w-]+)$/.exec(selector)?.[1];
    if (!className) return [];
    const matches = [...this.innerHTML.matchAll(/<button\b([^>]*)>/g)].filter(match => new RegExp(`class="[^"]*\\b${className}\\b`).test(match[1]));
    return matches.map((match, index) => { const button = this.querySelector(`${selector}:${index}`); button.dataset.id = /data-id="([^"]*)"/.exec(match[1])?.[1]; button.dataset.trace = /data-trace="([^"]*)"/.exec(match[1])?.[1]; return button; });
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  getAttribute(key) { return this.attrs[key]; }
  focus() {}
}
class Stream extends EventTarget { close() {} }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
async function waitFor(check) { for (let i = 0; i < 200; i++) { if (check()) return; await sleep(1); } assert.fail('Bounded fixture condition was not reached.'); }
function fixture(view = 'alerts') {
  const doc = new Element(); doc.visibilityState = 'visible';
  const win = new EventTarget(); win.location = { hash: `#${view}`, href: 'http://127.0.0.1/monitor' }; doc.defaultView = win;
  const root = new Element(); root.ownerDocument = doc; root.dataset = { prefix: '/monitor', pollIntervalMs: 60_000 };
  const main = new Element(); const chrome = new Map();
  root.querySelector = selector => selector === '#rn-main' ? main : ['#rn-toast', '#rn-auth', '#rn-token', '#rn-state', '#rn-identity', '#rn-live-dot', '#rn-nav', '#rn-refresh', '#rn-auth-form'].includes(selector) ? (chrome.has(selector) ? chrome.get(selector) : (chrome.set(selector, new Element()), chrome.get(selector))) : main.querySelector(selector);
  root.querySelectorAll = selector => main.querySelectorAll(selector);
  const answers = []; let prompts = 0; const mutations = []; const silences = []; const incident = { id: 'fixture-incident', title: '<script>synthetic</script>', severity: 'critical', state: 'open' };
  win.prompt = () => { prompts++; assert.ok(answers.length, 'Every prompt has an explicit fixture answer.'); return answers.shift(); };
  const fetch = async (url, options) => {
    if (options.method && options.method !== 'GET') {
      const body = options.body ? JSON.parse(options.body) : {}; mutations.push({ url, options, body });
      if (options.method === 'POST' && url.endsWith('/api/silences')) silences.push({ ...body, id: 'fixture-silence' });
      if (url.endsWith('/resolve')) incident.state = 'resolved';
      return json({ ok: true, data: body });
    }
    if (url.includes('/api/alerts')) return json({ data: { current: [], history: [], silences: { silences } } });
    if (url.includes('/api/incidents')) return json({ data: { incidents: [incident] } });
    if (url.includes('/api/health')) return json({ data: { ok: true, status: 'healthy', checks: [] } });
    if (url.includes('/api/traces')) return json({ data: [{ traceId: 'fixture-trace', name: 'fixture span', kind: 'internal', durationMs: 1, startTimeUnixNano: '1000000', attributes: { token: '[REDACTED]' } }] });
    if (url.includes('/api/doctor')) return json({ data: { ok: true, checks: [{ name: 'fixture check', ok: true, details: { message: 'inspectable' } }] } });
    if (url.includes('/api/diagnostics')) return json({ data: { state: 'running', synthetic: 'retained snapshot' } });
    throw new Error(`Unexpected fixture request ${url}`);
  };
  return { root, win, answers, mutations, silences, incident, fetch, prompts: () => prompts };
}
async function mount(t, f, fetch = f.fetch) { const handle = mountMonitorStudio(f.root, { fetch, EventSource: Stream }); t.after(() => handle.destroy()); await handle.navigate(f.win.location.hash.replace(/^#/, '')); return handle; }
const click = element => element.dispatchEvent(new Event('click'));
function mockIntervals(t) {
  const nativeClearInterval = globalThis.clearInterval;
  t.mock.timers.enable({ apis: ['setInterval'] });
  const mockedClearInterval = globalThis.clearInterval;
  // Node 22.0.0's experimental mock rejects nullish handles; native/browser
  // clearInterval treats them as a no-op. Preserve that contract in this model.
  globalThis.clearInterval = timer => { if (timer != null) return mockedClearInterval(timer); };
  t.after(() => { t.mock.timers.reset(); globalThis.clearInterval = nativeClearInterval; });
}

test('modeled actions: cancelling each silence prompt or incident resolution sends no mutation', async t => {
  const f = fixture(); const handle = await mount(t, f);
  for (const [answers, count] of [[[null], 1], [['rule', null], 2], [['rule', '60', null], 3]]) {
    const before = f.prompts(); f.answers.push(...answers); const button = f.root.querySelector('#rn-create-silence'); click(button); await waitFor(() => !button.disabled);
    assert.equal(f.prompts() - before, count); assert.equal(f.mutations.length, 0); assert.deepEqual(f.silences, []);
  }
  await handle.navigate('incidents'); f.answers.push(null); const button = f.root.querySelectorAll('.rn-incident-resolve')[0]; click(button); await waitFor(() => !button.disabled);
  assert.equal(f.mutations.length, 0); assert.equal(f.incident.state, 'open');
});

test('modeled actions: deliberate all-rules silence and incident resolution work; invalid duration is visible', async t => {
  const f = fixture(); const handle = await mount(t, f);
  for (const duration of ['', '0', '-1', 'no', 'Infinity', '1e100']) {
    f.answers.push('rule', duration); const button = f.root.querySelector('#rn-create-silence'); click(button); await waitFor(() => !button.disabled);
    assert.match(f.root.querySelector('#rn-toast').textContent, /positive number/); assert.equal(f.mutations.length, 0);
  }
  f.answers.push('', '2.5', 'Planned maintenance'); click(f.root.querySelector('#rn-create-silence')); await waitFor(() => f.silences.length === 1 && f.root.getAttribute('aria-busy') === 'false');
  assert.deepEqual(f.silences[0].ruleIds, []); assert.equal(f.silences[0].durationMs, 150_000); assert.equal(f.silences[0].reason, 'Planned maintenance');
  await handle.navigate('incidents'); f.answers.push('Issue mitigated intentionally'); click(f.root.querySelectorAll('.rn-incident-resolve')[0]); await waitFor(() => f.incident.state === 'resolved');
  assert.equal(f.mutations.at(-1).body.message, 'Issue mitigated intentionally');
});

test('modeled actions: failed mutations are visible and pending navigation/unmount suppress stale feedback', async t => {
  const f = fixture('incidents'); let mode = 'failure'; let release; let active; let admitted = 0;
  const fetch = async (url, options) => {
    if (options.method === 'POST') {
      admitted++; active = options.signal;
      if (mode === 'failure') return json({ ok: false, error: { message: 'Synthetic mutation rejected' } }, 503);
      await new Promise(resolve => { release = resolve; }); // Deliberately ignore abort to exercise the client continuation guard.
      return json({ ok: true, data: {} });
    }
    return f.fetch(url, options);
  };
  const handle = await mount(t, f, fetch); f.answers.push('Failure test'); let button = f.root.querySelectorAll('.rn-incident-resolve')[0]; click(button); await waitFor(() => !button.disabled);
  assert.equal(f.root.querySelector('#rn-toast').textContent, 'Synthetic mutation rejected'); assert.equal(f.incident.state, 'open');
  mode = 'delayed'; f.answers.push('Delayed test'); click(button); click(button); await waitFor(() => !!release); assert.equal(admitted, 2, 'A pending action cannot be submitted twice.');
  await handle.navigate('health'); assert.equal(active.aborted, true); const health = f.root.querySelector('#rn-main').innerHTML; release(); await sleep(2); assert.equal(f.root.querySelector('#rn-main').innerHTML, health); assert.equal(handle.snapshot().view, 'health');
  await handle.navigate('incidents'); release = null; f.answers.push('Unmount test'); button = f.root.querySelectorAll('.rn-incident-resolve')[0]; click(button); await waitFor(() => !!release); handle.destroy(); assert.equal(active.aborted, true); const before = f.root.querySelector('#rn-toast').textContent; release(); await sleep(2); assert.equal(f.root.querySelector('#rn-toast').textContent, before); assert.equal(f.root.getAttribute('aria-busy'), 'false');
});

test('modeled actions: navigation releases polling ownership even when an injected mutation never settles', async t => {
  const f = fixture('incidents'); f.root.dataset.pollIntervalMs = 1000; let admitted = false; let healthReads = 0; let active;
  const fetch = async (url, options) => {
    if (options.method === 'POST') { admitted = true; active = options.signal; return new Promise(() => {}); }
    if (url.includes('/api/health')) healthReads++;
    return f.fetch(url, options);
  };
  const handle = await mount(t, f, fetch); click(f.root.querySelectorAll('.rn-incident-ack')[0]); await waitFor(() => admitted);
  await handle.navigate('health'); assert.equal(active.aborted, true); assert.equal(healthReads, 1);
  await sleep(1100); assert.ok(healthReads >= 2, 'The new view continues polling after the old action is cancelled.');
});

test('modeled inspection: trace, incident and diagnostics details survive polling until explicitly resumed', async t => {
  mockIntervals(t);
  for (const [view, selector, target] of [
    ['traces', '.rn-trace-open', '#rn-trace-detail'],
    ['incidents', '.rn-incident-view', '#rn-incident-detail'],
    ['diagnostics', '#rn-full-diag', '#rn-diagnostics-full'],
  ]) {
    const f = fixture(view); f.root.dataset.pollIntervalMs = 1000; let reads = 0;
    const handle = await mount(t, f, (url, options) => { reads++; return f.fetch(url, options); });
    const button = selector.startsWith('.') ? f.root.querySelectorAll(selector)[0] : f.root.querySelector(selector);
    click(button); await waitFor(() => !button.disabled && f.root.querySelector(target).innerHTML.includes('Live refresh paused'));
    const inspected = f.root.querySelector(target); const before = reads;
    t.mock.timers.tick(10_000); f.root.ownerDocument.dispatchEvent(new Event('visibilitychange'));
    assert.equal(reads, before, `${view} inspection must not be erased by background refresh.`);
    assert.equal(f.root.querySelector(target), inspected);
    click(f.root.querySelector('#rn-resume-live'));
    await waitFor(() => reads === before + 1 && f.root.getAttribute('aria-busy') === 'false');
    assert.notEqual(f.root.querySelector(target), inspected, 'Explicit resume clears the stale inspection.');
    t.mock.timers.tick(1000);
    await waitFor(() => reads === before + 2 && f.root.getAttribute('aria-busy') === 'false');
    handle.destroy();
  }
});

test('modeled inspection: filters, focus and expanded details defer automatic refresh; manual refresh and navigation resume it', async t => {
  mockIntervals(t);
  const f = fixture('traces'); f.root.dataset.pollIntervalMs = 1000; let reads = 0;
  const handle = await mount(t, f, (url, options) => { reads++; return f.fetch(url, options); });
  const filter = f.root.querySelector('#rn-trace-filter'); const before = reads;
  f.root.ownerDocument.activeElement = filter;
  t.mock.timers.tick(1000); assert.equal(reads, before, 'Typing focus survives a polling deadline.');
  filter.value = 'fixture'; filter.dispatchEvent(new Event('input'));
  f.root.ownerDocument.activeElement = null;
  t.mock.timers.tick(1000); assert.equal(reads, before, 'A selected filter survives blur and polling.');
  assert.equal(f.root.querySelector('#rn-trace-filter'), filter);
  await handle.refresh(); assert.equal(reads, before + 1); assert.notEqual(f.root.querySelector('#rn-trace-filter'), filter);
  await handle.navigate('diagnostics');
  const details = f.root.querySelector('#rn-main').querySelectorAll('details')[0]; details.open = true;
  const diagnosticReads = reads;
  t.mock.timers.tick(1000); assert.equal(reads, diagnosticReads, 'Expanded diagnostic details remain readable.');
  details.open = false;
  t.mock.timers.tick(1000); await waitFor(() => reads === diagnosticReads + 1 && f.root.getAttribute('aria-busy') === 'false');
  await handle.navigate('health'); const healthReads = reads;
  t.mock.timers.tick(1000); await waitFor(() => reads === healthReads + 1);
});
