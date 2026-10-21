import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { AlertEngine, NotificationRouter } from '../src/index.js';

test('optional notification failures remain isolated without an error listener and required failures reject', async () => {
  const router = new NotificationRouter();
  router.register('failed', () => { throw new Error('controlled failure'); });
  router.register('healthy', () => true);
  const results = await router.notify({ title: 'synthetic' });
  assert.deepEqual(results.map(result => result.ok), [false, true]);
  router.register('required', () => { throw new Error('required failure'); }, { required: true });
  await assert.rejects(router.notify({}, { channels: ['required'] }), /required failure/);
  await router.close();
});

test('notification deadlines retain stuck callback ownership and close bounds channel cleanup', async () => {
  const router = new NotificationRouter({ callbackTimeoutMs: 10 });
  let calls = 0;
  let closes = 0;
  let signal;
  let release;
  router.register('stalled', {
    send(_notification, options) { calls++; signal = options.signal; return new Promise(resolve => { release = resolve; }); },
    close() { closes++; return new Promise(() => {}); },
  });
  router.register('healthy', () => true);
  assert.deepEqual((await router.notify({})).map(result => result.ok), [false, true]);
  assert.equal(signal.aborted, true);
  assert.equal(router.pending.size, 1);
  assert.deepEqual((await router.notify({})).map(result => result.ok), [false, true]);
  assert.equal(calls, 1);
  await Promise.all([router.close(), router.close()]);
  assert.equal(closes, 1);
  assert.deepEqual(await router.notify({}), []);
  release(true);
  await delay(0);
  assert.equal(router.pending.size, 0);
});

test('closing an active notification aborts its signal and settles the caller before a late result', async () => {
  const router = new NotificationRouter();
  let entered;
  let release;
  let signal;
  const began = new Promise(resolve => { entered = resolve; });
  router.register('active', (_notification, options) => { signal = options.signal; entered(); return new Promise(resolve => { release = resolve; }); });
  const notifying = router.notify({});
  await began;
  await router.close();
  assert.equal(signal.aborted, true);
  assert.equal((await notifying)[0].ok, false);
  release(true);
  await delay(0);
  assert.equal(router.stats.sent, 0);
});

test('caller cancellation cannot skip owned notification or alert cleanup', async () => {
  const cancelled = new AbortController();
  cancelled.abort(new Error('caller cancelled'));
  let channelsClosed = 0;
  const router = new NotificationRouter();
  router.register('owned', { send() {}, close() { channelsClosed++; } });
  await router.close({ signal: cancelled.signal });
  await router.close();
  assert.equal(channelsClosed, 1);
  let notificationsClosed = 0;
  const engine = new AlertEngine({ notifications: { close(options) { assert.equal(options.signal, undefined); notificationsClosed++; } } });
  await engine.close({ signal: cancelled.signal });
  await engine.close();
  assert.equal(notificationsClosed, 1);
});

test('a failed alert context does not strand evaluation ownership', async () => {
  let calls = 0;
  const engine = new AlertEngine({ contextProvider: () => { if (++calls === 1) throw new Error('controlled context'); return {}; } });
  engine.register({ id: 'healthy', evaluate: () => false });
  await assert.rejects(engine.evaluate(), /controlled context/);
  assert.equal(engine.evaluating, false);
  await engine.evaluate();
  assert.equal(engine.stats.evaluations, 1);
  await engine.close();
});

test('alert deadlines avoid overlapping a stalled rule while healthy rules remain usable', async () => {
  const engine = new AlertEngine({ callbackTimeoutMs: 10 });
  let calls = 0;
  let signal;
  let release;
  engine.register({ id: 'stalled', evaluate: context => { calls++; signal = context.signal; return new Promise(resolve => { release = resolve; }); } });
  engine.register({ id: 'healthy', evaluate: () => false });
  await engine.evaluate();
  assert.equal(engine.current().find(row => row.ruleId === 'stalled').error.code, 'MONITOR_TIMEOUT');
  assert.equal(signal.aborted, true);
  await engine.evaluate();
  assert.equal(calls, 1);
  assert.equal(engine.current().find(row => row.ruleId === 'stalled').error.code, 'MONITOR_ALERT_CALLBACK_BUSY');
  assert.equal(engine.current().find(row => row.ruleId === 'healthy').error, null);
  await engine.close();
  release(true);
  await delay(0);
  assert.equal(engine.history.some(event => event.state === 'firing'), false);
});

test('retired or closed alert evaluations cannot notify or open incidents', async () => {
  for (const action of ['replace', 'close']) {
    let entered;
    let release;
    let notices = 0;
    let incidents = 0;
    const began = new Promise(resolve => { entered = resolve; });
    const engine = new AlertEngine({ notifications: { notify() { notices++; }, close() {}, snapshot() { return {}; } }, incidents: { openFromAlert() { incidents++; } } });
    engine.register({ id: 'same', severity: 'critical', evaluate: () => { entered(); return new Promise(resolve => { release = resolve; }); } });
    const evaluating = engine.evaluate();
    await began;
    if (action === 'replace') engine.register({ id: 'same', evaluate: () => false }, { replace: true });
    else await engine.close();
    release(true);
    await evaluating;
    assert.equal(notices, 0);
    assert.equal(incidents, 0);
    assert.equal(engine.history.length, 0);
    if (action === 'replace') {
      await engine.evaluate();
      assert.equal(engine.current()[0].state, 'inactive');
      assert.equal(engine.current()[0].consecutiveFiring, 0);
      await engine.close();
    }
  }
});

test('close during a pending notification does not start a later incident or accept notification accounting', async () => {
  let entered;
  let release;
  let incidents = 0;
  const began = new Promise(resolve => { entered = resolve; });
  const engine = new AlertEngine({ notifications: { notify() { entered(); return new Promise(resolve => { release = resolve; }); }, close() {}, snapshot() { return {}; } }, incidents: { openFromAlert() { incidents++; } } });
  engine.register({ id: 'critical', severity: 'critical', evaluate: () => true });
  const evaluating = engine.evaluate();
  await began;
  await engine.close();
  await evaluating;
  release(true);
  await delay(0);
  assert.equal(incidents, 0);
  assert.equal(engine.stats.notifications, 0);
  assert.equal(engine.current()[0].lastNotifiedAt, null);
  assert.throws(() => engine.register({ id: 'late', evaluate: () => true }), { code: 'MONITOR_CLOSED' });
});
