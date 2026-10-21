'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import {
  EventJobQueue,
  EventScheduler,
  WorkflowEngine,
  BroadcastManager,
  Broadcastable,
  Event,
  AdvancedEventDispatcher,
  MemoryEventTransport,
  EventServiceProvider,
  EventsDoctorCommand,
} from '../../src/events/index.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('job queue enforces concurrency, priority, retries, cancellation, and drain', async () => {
  const queue = new EventJobQueue({ concurrency: 2, maxItems: 20, maxBytes: 1024 * 1024, retryBaseMs: 1 });
  const order = [];
  let retryCalls = 0;
  queue.register('work', async (payload) => { order.push(payload); await delay(2); return payload; });
  queue.register('retry', async () => { if (++retryCalls === 1) throw new Error('retry'); return 'done'; });
  const low = queue.enqueue('work', 'low', { priority: 0 });
  const high = queue.enqueue('work', 'high', { priority: 10 });
  const retry = queue.enqueue('retry', null, { attempts: 2 });
  const cancelled = queue.enqueue('work', 'cancelled', { delayMs: 1000 });
  assert.equal(cancelled.cancel(), true);
  assert.equal(await high, 'high');
  assert.equal(await low, 'low');
  assert.equal(await retry, 'done');
  await queue.flush();
  assert.equal(order[0], 'high');
  assert.equal(queue.snapshot().stats.retried, 1);
  await queue.close();
});

test('scheduler fires one-shot and interval tasks without retaining referenced timers', async () => {
  const scheduler = new EventScheduler();
  let fired = 0;
  scheduler.at(Date.now() + 5, () => { fired++; });
  scheduler.every(5, () => { fired++; }, { maxRuns: 2 });
  await delay(35);
  assert.equal(fired, 3);
  scheduler.close();
});

test('workflow engine persists steps and compensates completed work in reverse order', async () => {
  const workflow = new WorkflowEngine();
  const log = [];
  workflow.define('checkout', [
    { name: 'reserve', run: () => { log.push('reserve'); return 'r'; }, compensate: () => log.push('unreserve') },
    { name: 'charge', run: () => { log.push('charge'); throw new Error('declined'); }, compensate: () => log.push('refund') },
  ]);
  const record = await workflow.start('checkout');
  assert.equal(record.status, 'compensated');
  assert.deepEqual(log, ['reserve', 'charge', 'unreserve']);
  assert.equal(workflow.snapshot().stats.compensated, 1);
  await workflow.close();
});

test('broadcast manager fans Broadcastable event objects to registered transports', async () => {
  class Notification extends Broadcastable(Event) {
    static eventName = 'notification:created';
    broadcastChannel() { return ['users', 'admins']; }
    broadcastAs() { return 'notification'; }
  }
  const events = new AdvancedEventDispatcher({ logger: silentLogger });
  const transport = new MemoryEventTransport();
  const manager = new BroadcastManager(events).register('memory', transport);
  events.setBroadcastManager(manager, { auto: true });
  events.dispatch(new Notification({ message: 'hello' }));
  await events.flush();
  const messages = transport.all('notification');
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0].payload.channels, ['users', 'admins']);
  await events.close();
});

class FakeApplication {
  constructor(configuration) {
    this.factories = new Map();
    this.instances = new Map();
    this.tags = new Map();
    this.container = new EventEmitter();
    this.container.has = (key) => this.factories.has(key) || this.instances.has(key);
    this.container.tag = (key, tag) => this.tag(key, tag);
    this.singleton('app', () => this);
    this.singleton('config', () => ({ get: (key) => key === 'events' ? configuration : undefined }));
    this.singleton('logger', () => silentLogger);
  }
  singleton(key, factory) { this.factories.set(key, factory); return this; }
  bind(key, factory) { return this.singleton(key, factory); }
  resolve(key) {
    if (this.instances.has(key)) return this.instances.get(key);
    const factory = this.factories.get(key);
    if (!factory) return null;
    const value = factory(this);
    this.instances.set(key, value);
    return value;
  }
  tag(key, tag) { let set = this.tags.get(tag); if (!set) this.tags.set(tag, set = new Set()); set.add(key); }
  make(Class) { return new Class(); }
  basePath() { return process.cwd(); }
}

test('EventServiceProvider registers config listeners atomically, commands, lifecycle, and teardown', async () => {
  const calls = [];
  const app = new FakeApplication({
    profile: 'production',
    failFast: true,
    freezeListeners: true,
    lifecycle: { enabled: true },
    bus: { metrics: { enabled: true }, history: { maxEntriesPerEvent: 0 } },
    listeners: {
      'domain:created': [
        { listener: (payload) => calls.push(payload.id), priority: 10, tags: ['domain'] },
      ],
      'domain:**': [
        { listener: (eventName) => calls.push(eventName), priority: -10 },
      ],
    },
    bridge: { redis: { enabled: false } },
  });
  const provider = new EventServiceProvider(app);
  provider.register();
  const report = await provider.boot();
  const events = app.resolve('events');
  events.dispatch('domain:created', { id: 'x' });
  assert.deepEqual(calls, ['x', 'domain:created']);
  assert.equal(report.loaded.length, 2);
  assert.equal(events.registrationsFrozen(), true);
  assert.equal(events.schemas(), app.resolve('events.schemas'));
  assert.equal(events.codecs(), app.resolve('events.codecs'));
  assert.equal(events.schemas().frozen, true);
  assert.equal(events.codecs().frozen, true);
  assert.ok(app.tags.get('console.command').has('command.events.doctor'));
  const doctor = new EventsDoctorCommand(app);
  assert.equal((await doctor.handle()).ok, true);
  await provider.teardown();
  assert.equal(events.snapshot().closed, true);
});

test('EventServiceProvider lazily binds and supervises queue, scheduler, workflows, and sourcing subsystems', async () => {
  const app = new FakeApplication({
    profile: 'production',
    bus: { lifecycle: { shutdownTimeoutMs: 100, forceOnTimeout: true } },
    queue: { enabled: true, maxItems: 100, maxBytes: 1024 * 1024, concurrency: 2 },
    scheduler: { enabled: true },
    workflows: { enabled: true, memory: { maxItems: 100 } },
    sourcing: { enabled: true, memory: { maxStreams: 10, maxEvents: 100, maxBytes: 1024 * 1024 } },
    bridge: { redis: { enabled: false } },
  });
  const provider = new EventServiceProvider(app);
  provider.register();
  await provider.boot();

  const events = app.resolve('events');
  const queue = app.resolve('events.queue');
  const scheduler = app.resolve('events.scheduler');
  const workflows = app.resolve('events.workflows');
  const store = app.resolve('events.store');
  const projections = app.resolve('events.projections');

  let queued = 0;
  events.on('provider:queued', (value) => { queued += value; });
  await queue.dispatch('provider:queued', 2);
  assert.equal(queued, 2);
  assert.equal(events.subsystem('queue'), queue);
  assert.equal(events.subsystem('scheduler'), scheduler);
  assert.equal(events.subsystem('workflows'), workflows);
  assert.equal(events.subsystem('event-store'), store);
  assert.equal(events.subsystem('projections'), projections);
  assert.equal(Object.keys(events.subsystems()).length, 5);
  assert.equal(events.health().ok, true);

  await provider.teardown();
  assert.equal(queue.snapshot().closed, true);
  assert.equal(scheduler.snapshot().closed, true);
  assert.equal(store.snapshot().closed, true);
});
