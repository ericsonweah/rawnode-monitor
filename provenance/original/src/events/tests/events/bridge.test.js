'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as immediate } from 'node:timers/promises';
import {
  AdvancedEventDispatcher,
  RedisEventBridge,
  RedisStreamTransport,
  SafeJsonCodec,
  createEventEnvelope,
  validateEventEnvelope,
} from '../../src/events/index.js';
import { SeenMessageWindow } from '../../src/events/bridge/SeenMessageWindow.js';
import { createClient, FakeRedisClient, resetRedisStub } from '../fixtures/redis-stub.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function appFor(events, values = {}) {
  const config = {
    get(path, fallback) {
      const parts = String(path).split('.');
      let current = values;
      for (const part of parts) {
        if (!current || typeof current !== 'object' || !(part in current)) return fallback;
        current = current[part];
      }
      return current;
    },
  };
  return {
    resolve(key) {
      if (key === 'events') return events;
      if (key === 'config') return config;
      if (key === 'logger') return silentLogger;
      return null;
    },
  };
}

function bridgeOptions(nodeId, channel = 'test:events') {
  return {
    enabled: true,
    profile: 'production',
    nodeId,
    channel,
    namespace: 'tests',
    allow: ['domain:**'],
    deny: [],
    secret: 'cluster-secret',
    clientFactory: createClient,
    connectTimeoutMs: 1000,
    publishTimeoutMs: 1000,
    maxPublishRetries: 0,
    queue: { maxItems: 100, maxBytes: 1024 * 1024, overflow: 'reject' },
  };
}

test('Redis bridge propagates typed events with context and prevents async echo loops', async () => {
  resetRedisStub();
  const busA = new AdvancedEventDispatcher({ logger: silentLogger });
  const busB = new AdvancedEventDispatcher({ logger: silentLogger });
  const bridgeA = new RedisEventBridge(appFor(busA));
  const bridgeB = new RedisEventBridge(appFor(busB));
  await bridgeA.start(bridgeOptions('node-a'));
  await bridgeB.start(bridgeOptions('node-b'));

  let received = null;
  let remoteContext = null;
  busB.on('domain:typed', (payload) => {
    received = payload;
    remoteContext = busB.getContext();
    busB.dispatchDeferred('domain:echo', { source: payload.big });
  });

  const sourceContext = busA.createContext({ transport: 'http', tenantId: 'acme', actorId: 'u-1', traceId: 'trace-9' });
  busA.run(sourceContext, () => {
    busA.dispatch('domain:typed', {
      big: 42n,
      bytes: Buffer.from('rawnode'),
      error: Object.assign(new Error('typed'), { code: 'E_TYPED' }),
    });
  });

  await bridgeA.flush();
  await immediate();
  await busB.flush();
  await bridgeB.flush();

  assert.equal(received.big, 42n);
  assert.equal(Buffer.isBuffer(received.bytes), true);
  assert.equal(received.bytes.toString(), 'rawnode');
  assert.equal(received.error instanceof Error, true);
  assert.equal(remoteContext.originTransport, 'redis');
  assert.equal(remoteContext.originNode, 'node-a');
  assert.equal(remoteContext.tenantId, 'acme');
  assert.equal(bridgeB.stats.published, 0, 'deferred child dispatch keeps remote-origin suppression');
  assert.ok(bridgeB.stats.loopPrevented >= 1);

  await bridgeA.close();
  await bridgeB.close();
  await busA.close();
  await busB.close();
});

test('bridge accepts version-1 envelopes and deduplicates repeated packets', async () => {
  resetRedisStub();
  const bus = new AdvancedEventDispatcher({ logger: silentLogger });
  const bridge = new RedisEventBridge(appFor(bus));
  await bridge.start({ ...bridgeOptions('node-b', 'test:v1'), secret: null });
  let count = 0;
  bus.on('domain:legacy', () => count++);

  const external = createClient();
  await external.connectAsync();
  const packet = JSON.stringify({
    v: 1,
    id: 'legacy-id-1',
    node: 'legacy-node',
    ts: Date.now(),
    event: 'domain:legacy',
    args: [{ ok: true }],
    ctx: { id: 'legacy-context', transport: 'internal' },
  });
  await external.publish('test:v1', packet);
  await external.publish('test:v1', packet);
  await immediate();

  assert.equal(count, 1);
  assert.equal(bridge.stats.duplicates, 1);
  await external.quit();
  await bridge.close();
  await bus.close();
});

test('bridge startup rolls back partial resources and supports a clean retry', async () => {
  resetRedisStub();
  const bus = new AdvancedEventDispatcher({ logger: silentLogger });
  const bridge = new RedisEventBridge(appFor(bus));
  let calls = 0;
  const failingFactory = () => {
    calls++;
    if (calls === 1) return new FakeRedisClient();
    const client = new FakeRedisClient();
    client.connectAsync = async () => { throw new Error('subscriber unavailable'); };
    return client;
  };

  await assert.rejects(
    bridge.start({ ...bridgeOptions('node-fail', 'test:rollback'), clientFactory: failingFactory }),
    /subscriber unavailable/,
  );
  assert.equal(bridge.state, 'failed');
  assert.equal(bridge.enabled, false);
  assert.equal(bridge.redis, null);
  assert.equal(bridge.subscriber, null);

  await bridge.start({ ...bridgeOptions('node-retry', 'test:rollback'), clientFactory: createClient });
  assert.equal(bridge.state, 'ready');
  await bridge.close();
  await bus.close();
});

test('bridge exposes circuit and publish failure metrics without leaking rejections', async () => {
  resetRedisStub();
  const bus = new AdvancedEventDispatcher({ logger: silentLogger });
  const publisher = new FakeRedisClient({ failPublish: true });
  const subscriber = new FakeRedisClient();
  const bridge = new RedisEventBridge(appFor(bus));
  await bridge.start({
    ...bridgeOptions('node-failing', 'test:circuit'),
    publisherClient: publisher,
    subscriberClient: subscriber,
    closeInjectedClients: true,
    circuit: { failureThreshold: 1, openMs: 20 },
    maxPublishRetries: 0,
  });
  bus.dispatch('domain:write', { id: 1 });
  await bridge.flush();
  assert.equal(bridge.stats.publishFailures, 1);
  assert.equal(bridge.stats.circuitOpened, 1);
  assert.ok(bridge.snapshot().circuitOpenUntil > 0);
  await bridge.close({ force: true });
  await bus.close();
});

test('seen-message window expires IDs on lookup even below capacity', () => {
  const seen = new SeenMessageWindow({ maxItems: 100, ttlMs: 10 });
  seen.remember('id-1', 0);
  assert.equal(seen.has('id-1', 5), true);
  assert.equal(seen.has('id-1', 11), false);
  assert.equal(seen.map.has('id-1'), false);
});

test('safe codec preserves common Node types, redacts secrets and bounds packets', () => {
  const codec = new SafeJsonCodec({ maxBytes: 4096 });
  const circular = { token: 'secret', value: 1n, bytes: Buffer.from('x'), error: new Error('boom') };
  circular.self = circular;
  const encoded = codec.encode(circular);
  const decoded = codec.parse(encoded.text);
  assert.equal(decoded.token, '[redacted]');
  assert.equal(decoded.value, 1n);
  assert.equal(Buffer.isBuffer(decoded.bytes), true);
  assert.equal(decoded.error instanceof Error, true);
  assert.match(decoded.self, /Circular/);
  assert.throws(() => new SafeJsonCodec({ maxBytes: 16 }).encode({ value: 'x'.repeat(100) }), /exceeds/);
});

test('event envelopes validate HMAC signatures, expiry, namespace and hop limits', () => {
  const envelope = createEventEnvelope('domain:signed', [1], {
    nodeId: 'node-a',
    namespace: 'tenant-a',
    secret: 'secret',
    ttlMs: 1000,
  });
  assert.equal(validateEventEnvelope(envelope, { namespace: 'tenant-a', secret: 'secret' }).ok, true);
  assert.equal(validateEventEnvelope({ ...envelope, event: 'domain:tampered' }, { namespace: 'tenant-a', secret: 'secret' }).ok, false);
  assert.equal(validateEventEnvelope(envelope, { namespace: 'tenant-b', secret: 'secret' }).code, 'EVENT_ENVELOPE_NAMESPACE');
  assert.equal(validateEventEnvelope({ ...envelope, hop: 10 }, { namespace: 'tenant-a', secret: 'secret', maxHops: 4 }).code, 'EVENT_ENVELOPE_HOPS');
});

test('durable Redis Stream transport publishes, reads, decodes and acknowledges envelopes', async () => {
  resetRedisStub();
  const client = createClient();
  await client.connectAsync();
  const transport = new RedisStreamTransport(client, {
    stream: 'test:stream',
    group: 'test-group',
    consumer: 'consumer-1',
    nodeId: 'node-a',
    namespace: 'tests',
    secret: 'secret',
  });
  await transport.ensureGroup();
  const published = await transport.publish('domain:durable', [{ id: 1 }]);
  assert.equal(published.persisted, true);
  const messages = await transport.read({ blockMs: 0 });
  assert.equal(messages.length, 1);
  const decoded = transport.decode(messages[0]);
  assert.equal(decoded.ok, true);
  assert.equal(decoded.envelope.event, 'domain:durable');
  assert.equal(await transport.ack(messages[0].id), 1);
  await client.quit();
});
