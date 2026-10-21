'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ChannelManager,
  LoggerConfiguration,
  LoggerConfigurationError,
  LoggerServiceProvider,
  MemoryTransport,
  SwappableLogger,
  createLogger,
} from '../../index.js';

function storedRecords(channel) {
  const logger = channel?.logger || channel;
  const runtime = logger?.runtime || logger;
  return runtime.dispatcher.adapters[0].transport.all();
}

test('LoggerConfiguration produces immutable snapshots and actionable validation', () => {
  const configuration = new LoggerConfiguration({
    profile: 'production',
    level: 'debug',
    channel: 'memory',
    channels: { memory: { driver: 'memory' } },
  });
  assert.equal(configuration.get('profile'), 'production');
  assert.equal(configuration.get('channels.memory.driver'), 'memory');
  assert.equal(Object.isFrozen(configuration.value), true);
  const changed = configuration.with({ level: 'warn' });
  assert.equal(configuration.get('level'), 'debug');
  assert.equal(changed.get('level'), 'warn');

  assert.throws(() => new LoggerConfiguration({
    profile: 'not-real',
    channel: 'missing',
    channels: { console: { driver: 'console' } },
  }), LoggerConfigurationError);
});

test('ChannelManager resolves lazy channels, stacks, custom drivers, and cycle errors', async () => {
  const customMemory = new MemoryTransport();
  const manager = new ChannelManager({
    default: 'stack',
    base: { profile: 'production', level: 'debug' },
    channels: {
      memory: { driver: 'memory', maxItems: 20 },
      custom: { driver: 'custom' },
      stack: { driver: 'stack', channels: ['memory', 'custom'] },
      cycleA: { driver: 'stack', channels: ['cycleB'] },
      cycleB: { driver: 'stack', channels: ['cycleA'] },
    },
  });
  manager.extend('custom', () => customMemory);
  try {
    const stack = manager.channel();
    stack.info('stacked', { value: 1 });
    await stack.flush();
    assert.equal(storedRecords(manager.channel('memory'))[0].message, 'stacked');
    assert.equal(customMemory.all()[0].message, 'stacked');
    assert.throws(() => manager.channel('cycleA'), (error) => error.code === 'LOGGER_CHANNEL_CYCLE');
    assert.ok(manager.snapshot().drivers.includes('custom'));
    assert.equal(manager.health().status, 'healthy');
  } finally { await manager.close(); }
});

test('SwappableLogger keeps stable references while changing targets', async () => {
  const firstMemory = new MemoryTransport();
  const secondMemory = new MemoryTransport();
  const first = createLogger({ transports: [firstMemory] });
  const second = createLogger({ transports: [secondMemory] });
  const proxy = new SwappableLogger(first);
  try {
    proxy.info('first');
    await proxy.flush();
    assert.equal(firstMemory.all()[0].message, 'first');
    assert.equal(proxy.swap(second), first);
    proxy.info('second');
    await proxy.flush();
    assert.equal(secondMemory.all()[0].message, 'second');
  } finally {
    await Promise.allSettled([first.close(), second.close()]);
  }
});

test('LoggerServiceProvider binds a configuration-driven bootstrap-safe logger', async () => {
  const bindings = new Map();
  const app = {
    instance(key, value) { bindings.set(key, value); return value; },
    resolve(key) { return bindings.get(key); },
  };
  bindings.set('config', {
    get(key) {
      if (key === 'logger') return {
        profile: 'production',
        level: 'debug',
        channel: 'stack',
        service: 'provider-test',
        channels: {
          memory: { driver: 'memory', maxItems: 20 },
          stack: { driver: 'stack', channels: ['memory'] },
        },
      };
      if (key === 'app.name') return 'provider-test';
      return undefined;
    },
  });
  const provider = new LoggerServiceProvider(app);
  await provider.register();
  await provider.boot();
  try {
    const logger = app.resolve('logger');
    assert.ok(logger instanceof SwappableLogger);
    logger.info('provider-log');
    await logger.flush();
    const manager = app.resolve('logger.manager');
    assert.equal(storedRecords(manager.channel('memory'))[0].message, 'provider-log');
    assert.equal(app.resolve('logger.health').isHealthy(), true);
    assert.equal(app.resolve('logger.configuration').get('service'), 'provider-test');
  } finally { await provider.tearDown(); }
});
