import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import MonitorPluginManager from '../src/plugins/MonitorPluginManager.js';

test('close invalidates a pending setup and cannot resurrect plugin start', async () => {
  const manager = new MonitorPluginManager({ callbackTimeoutMs: 50 });
  let release;
  let setupSignal;
  let began;
  const entered = new Promise(resolve => { began = resolve; });
  let starts = 0;
  let closes = 0;
  manager.register({ id: 'race', setup(api) { setupSignal = api.abortSignal; began(); return new Promise(resolve => { release = resolve; }); }, start() { starts++; }, close() { closes++; } });
  const starting = manager.start({});
  const rejected = assert.rejects(starting, { code: 'MONITOR_PLUGIN_CLOSED' });
  await entered;
  await Promise.all([manager.close(), manager.close()]);
  assert.equal(setupSignal.aborted, true);
  release();
  await rejected;
  await delay(1);
  assert.equal(starts, 0);
  assert.equal(closes, 1);
  assert.equal(manager.started, false);
  assert.equal(manager.closed, true);
  assert.equal(manager.get('race').state, 'closed');
  await assert.rejects(manager.start({}), { code: 'MONITOR_PLUGIN_CLOSED' });
});

test('close invalidates a pending start and startup calls are idempotent', async () => {
  const manager = new MonitorPluginManager({ callbackTimeoutMs: 100 });
  let setups = 0;
  let starts = 0;
  let entered;
  let release;
  const began = new Promise(resolve => { entered = resolve; });
  manager.register({ id: 'race', setup() { setups++; }, start() { starts++; entered(); return new Promise(resolve => { release = resolve; }); } });
  const a = manager.start({});
  const b = manager.start({});
  const rejected = Promise.all([assert.rejects(a, { code: 'MONITOR_PLUGIN_CLOSED' }), assert.rejects(b, { code: 'MONITOR_PLUGIN_CLOSED' })]);
  await began;
  await manager.close();
  release();
  await rejected;
  assert.equal(setups, 1);
  assert.equal(starts, 1);
  assert.equal(manager.started, false);
  assert.equal(manager.get('race').state, 'closed');
});

test('plugin callback deadlines isolate failures and repeated hooks cannot accumulate stuck work', async () => {
  const manager = new MonitorPluginManager({ callbackTimeoutMs: 10, maxPendingCallbacks: 2 });
  manager.register({ id: 'slow', setup: () => new Promise(() => {}) });
  manager.register({ id: 'healthy' });
  await manager.start({});
  assert.equal(manager.get('slow').state, 'failed');
  assert.equal(manager.get('slow').error.code, 'MONITOR_TIMEOUT');
  assert.equal(manager.get('healthy').state, 'started');
  let calls = 0;
  let hookSignal;
  manager.hook('sample', (_payload, context) => { calls++; hookSignal = context.signal; return new Promise(() => {}); });
  await manager.invoke('sample', {});
  await manager.invoke('sample', {});
  assert.equal(calls, 1);
  assert.equal(hookSignal.aborted, true);
  assert.equal(manager.pendingCallbacks.size, 2);
  await manager.close();
  assert.equal(manager.closed, true);
});

test('once hooks run once across concurrent invoke calls and hook admission is bounded', async () => {
  const manager = new MonitorPluginManager({ maxHooks: 1 });
  let calls = 0;
  manager.hook('once', async () => { calls++; await delay(1); }, { once: true });
  assert.throws(() => manager.hook('extra', () => {}), { code: 'MONITOR_PLUGIN_HOOK_LIMIT' });
  await Promise.all([manager.invoke('once', {}), manager.invoke('once', {})]);
  assert.equal(calls, 1);
  assert.equal(manager.hookCount, 0);
  await manager.close();
});

test('failed required close still finalizes manager and drops pending notifications', async () => {
  const manager = new MonitorPluginManager({ callbackTimeoutMs: 10 });
  manager.register({ id: 'slow-close', required: true, close: () => new Promise(() => {}) });
  manager.hook('notice', () => {});
  await manager.start({});
  manager.notify('notice', { fixture: 'retained' });
  await assert.rejects(manager.close({ timeoutMs: 20, throwOnError: true }), { code: 'MONITOR_PLUGIN_CLOSE_FAILED' });
  assert.equal(manager.closed, true);
  assert.equal(manager.closing, false);
  assert.equal(manager.notifications.length, 0);
  assert.equal(manager.hooks.size, 0);
  assert.equal(manager.notify('notice', {}), false);
});
