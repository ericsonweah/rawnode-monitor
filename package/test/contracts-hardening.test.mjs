import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  MetricRegistry, MonitorContextManager, MonitorRuntime, RedisMonitorBridge,
  ResourceRegistry, SamplingDecision, TraceContext, TraceIdRatioSampler, Tracer,
  createMonitorClusterEnvelope, createMonitorHttpMiddleware, extractTraceContext,
  injectTraceContext, parseBaggage, verifyMonitorClusterEnvelope,
} from '../src/index.js';

test('ratio sampling uses the full 52-bit suffix range at deterministic boundaries', () => {
  const context = suffix => ({ traceId: suffix.padStart(32, '0') });
  for (const [ratio, below, at] of [[0.25, '3ffffffffffff', '4000000000000'], [0.5, '7ffffffffffff', '8000000000000'], [0.75, 'bffffffffffff', 'c000000000000']]) {
    const sampler = new TraceIdRatioSampler(ratio);
    assert.equal(sampler.shouldSample(context(below)).decision, SamplingDecision.RECORD_AND_SAMPLE);
    assert.equal(sampler.shouldSample(context(at)).decision, SamplingDecision.DROP);
    assert.equal(sampler.shouldSample(context('fffffffffffff')).decision, SamplingDecision.DROP);
  }
  assert.equal(new TraceIdRatioSampler(0).shouldSample(context('1')).decision, SamplingDecision.DROP);
  assert.equal(new TraceIdRatioSampler(1).shouldSample(context('fffffffffffff')).decision, SamplingDecision.RECORD_AND_SAMPLE);
});

test('bound context overrides its creation scope and preserves receiver, arguments and async propagation', async () => {
  const manager = new MonitorContextManager();
  const owner = { fixture: true };
  const callback = manager.run({ requestId: 'creation' }, () => manager.bind(async function (value) {
    await Promise.resolve();
    return { receiver: this, value, active: manager.active().requestId };
  }, { requestId: 'bound' }));
  const result = await manager.run({ requestId: 'caller' }, () => callback.call(owner, 7));
  assert.deepEqual(result, { receiver: owner, value: 7, active: 'bound' });
  assert.equal(manager.active().requestId, undefined);
  manager.disable();
});

test('remote context parsing ignores malformed baggage keys and preserves valid propagation and parent sampling', async () => {
  assert.deepEqual({ ...parseBaggage('%E0%A4%A=bad,valid=works') }, { valid: 'works' });
  const original = new TraceContext({ sampled: false, baggage: { valid: 'works' } });
  const carrier = injectTraceContext(original, {});
  carrier.baggage = '%E0%A4%A=bad,' + carrier.baggage;
  const remote = extractTraceContext(carrier);
  assert.equal(remote.traceId, original.traceId);
  assert.equal(remote.sampled, false);
  assert.equal(remote.baggage.valid, 'works');
  const manager = new MonitorContextManager();
  const tracer = new Tracer({ sampleRate: 1, contextManager: manager });
  const child = manager.run({ traceContext: remote }, () => tracer.startSpan('child'));
  assert.equal(child.traceId, remote.traceId);
  assert.equal(child.isRecording(), false);
  await tracer.close();
  manager.disable();
});

test('HTTP middleware uses route templates and a single unmatched label for request-specific paths', async () => {
  const monitor = new MonitorRuntime({ profile: 'test' });
  try {
    const middleware = createMonitorHttpMiddleware(monitor);
    for (const [url, route] of [['/users/1', null], ['/users/2', null], ['/users/3', { path: '/users/:id' }]]) {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.setHeader = () => {};
      await middleware({ url, method: 'GET', headers: {}, route }, res, () => {});
      res.emit('finish');
      res.emit('close');
    }
    const series = monitor.metrics.get('http_server_requests_total').snapshot().series;
    assert.deepEqual(series.map(row => [row.labels.route, row.value]), [['unmatched', 2], ['/users/:id', 1]]);
    assert.equal(monitor.metrics.get('http_server_active_requests').snapshot().series.every(row => row.value === 0), true);
    assert.equal(monitor.metrics.get('http_server_request_duration_seconds').snapshot().unit, 'seconds');
  } finally { await monitor.close(); }
});

test('timer and span elapsed duration stay monotonic when the wall clock moves backwards', async () => {
  const metrics = new MetricRegistry();
  const timer = metrics.timer('operation');
  const stop = timer.start();
  const tracer = new Tracer({ sampleRate: 1 });
  const span = tracer.startSpan('operation');
  span.startHrtime -= 2_000_000n;
  const wallClock = Date.now;
  try {
    Date.now = () => wallClock() - 60_000;
    assert.ok(stop() >= 0);
    assert.equal(stop(), 0);
    span.end();
    assert.ok(span.toJSON().durationMs >= 2);
    assert.ok(BigInt(span.toJSON().endTimeUnixNano) < BigInt(span.toJSON().startTimeUnixNano));
  } finally { Date.now = wallClock; await tracer.close(); }
  assert.equal(timer.snapshot().unit, 'seconds');
  assert.equal(timer.snapshot().series[0].count, 1);
});

test('resource replacement invalidates cached state and suppresses retired collection events', async () => {
  const registry = new ResourceRegistry();
  registry.register('db', { metrics: () => ({ generation: 'old' }) });
  await registry.collectOne('db');
  let release;
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  registry.register('db', { metrics: async () => { entered(); return new Promise(resolve => { release = resolve; }); } }, { replace: true });
  assert.equal(registry.latestSnapshot('db'), null);
  const events = [];
  registry.on('snapshot', snapshot => events.push(snapshot));
  const pending = registry.collectOne('db');
  await began;
  registry.register('db', { metrics: () => ({ generation: 'current' }) }, { replace: true });
  await registry.collectOne('db');
  release({ generation: 'retired' });
  await pending;
  assert.equal(registry.latestSnapshot('db').metrics.generation, 'current');
  assert.deepEqual(events.map(snapshot => snapshot.metrics.generation), ['current']);
  registry.unregister('db');
});

test('late Redis subscribe and ready completion cannot resurrect a closed bridge', async () => {
  for (const barrier of ['subscribe', 'ready']) {
    let release;
    let entered;
    let subscriptions = 0;
    let disposals = 0;
    let handler;
    const gate = new Promise(resolve => { release = resolve; });
    const began = new Promise(resolve => { entered = resolve; });
    const subscription = { ready: async () => { if (barrier === 'ready') { entered(); await gate; } }, unsubscribe: () => { disposals++; } };
    const redis = { async subscribe(_channel, listener) { subscriptions++; handler = listener; if (barrier === 'subscribe') { entered(); await gate; } return subscription; } };
    const bridge = new RedisMonitorBridge(redis, { source: 'local' });
    let started = 0;
    let messages = 0;
    bridge.on('started', () => { started++; });
    bridge.on('message', () => { messages++; });
    const starts = [bridge.start(), bridge.start()];
    await began;
    await bridge.close();
    handler(JSON.stringify(createMonitorClusterEnvelope('signal', {}, { source: 'remote' })));
    release();
    await Promise.all(starts);
    await bridge.close();
    assert.equal(subscriptions, 1);
    assert.equal(disposals, 1);
    assert.equal(started, 0);
    assert.equal(messages, 0);
    assert.equal(bridge.started, false);
    assert.equal(bridge.closed, true);
    assert.equal(bridge.subscription, null);
  }
});

test('cluster envelopes reject invalid, expired, wrong-namespace and tampered authentication fields', () => {
  const envelope = createMonitorClusterEnvelope('signal', { fixture: true }, { source: 'remote', namespace: 'typed', secret: 'synthetic-only' });
  assert.equal(verifyMonitorClusterEnvelope(envelope, { namespace: 'typed', secret: 'synthetic-only' }).ok, true);
  for (const field of ['timestamp', 'expiresAt']) {
    for (const value of ['invalid', null, undefined, Infinity]) {
      assert.equal(verifyMonitorClusterEnvelope({ ...envelope, [field]: value }).ok, false);
    }
  }
  assert.equal(verifyMonitorClusterEnvelope({ ...envelope, expiresAt: Date.now() - 1 }).reason, 'expired');
  assert.equal(verifyMonitorClusterEnvelope(envelope, { namespace: 'other' }).reason, 'namespace');
  assert.equal(verifyMonitorClusterEnvelope({ ...envelope, payload: { fixture: false } }, { secret: 'synthetic-only' }).reason, 'signature-invalid');
});
