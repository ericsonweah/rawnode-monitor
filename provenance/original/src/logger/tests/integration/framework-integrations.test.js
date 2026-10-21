'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createLogger,
  MemoryTransport,
  LoggerServiceProvider,
  createHttpLoggingMiddleware,
  EventLoggingBridge,
  ChannelManager,
} from '../../index.js';

class FakeApplication {
  constructor(configuration) {
    this.bindings = new Map();
    this.configuration = configuration;
    this.instance('config', {
      get: (key) => {
        if (key === 'logger') return this.configuration.logger;
        if (key === 'app.name') return 'integration-app';
        if (key === 'app.env') return 'test';
        return undefined;
      },
    });
  }
  instance(key, value) { this.bindings.set(key, value); return value; }
  resolve(key) { return this.bindings.get(key); }
}

test('LoggerServiceProvider builds stack channels, aliases bindings, and tears down cleanly', async () => {
  const app = new FakeApplication({
    logger: {
      profile: 'production',
      level: 'debug',
      channel: 'stack',
      channels: {
        stack: { driver: 'stack', channels: ['memory'] },
        memory: { driver: 'memory', maxItems: 100 },
      },
      processErrors: { enabled: false },
    },
  });
  const provider = new LoggerServiceProvider(app);
  const logger = await provider.register();
  await provider.boot();
  try {
    assert.equal(app.resolve('logger'), logger);
    assert.equal(app.resolve('log'), logger);
    assert.equal(app.resolve('Logger'), logger);
    const manager = app.resolve('logger.channels');
    assert.ok(manager instanceof ChannelManager);

    logger.info('provider-log', { tenantId: 'tenant-1' });
    await logger.flush();
    const memoryLogger = manager.channel('memory');
    await memoryLogger.flush();
    const transport = memoryLogger.runtime.dispatcher.adapters[0].transport;
    assert.equal(transport.all()[0].message, 'provider-log');
    assert.equal(transport.all()[0].service, 'integration-app');
  } finally {
    await provider.tearDown();
  }
  assert.equal(app.resolve('logger.channels').snapshot().closed, true);
});

test('HTTP logging middleware propagates request context and completion timing', async () => {
  const memory = new MemoryTransport();
  const logger = createLogger({ level: 'debug', transports: [memory] });
  const middleware = createHttpLoggingMiddleware(logger, { requestIdFactory: () => 'generated-request-id' });
  const req = {
    method: 'POST',
    url: '/orders',
    headers: { 'user-agent': 'rawnode-test' },
    socket: { remoteAddress: '127.0.0.1' },
    tenantId: 'tenant-7',
    user: { id: 'user-3' },
  };
  const res = new EventEmitter();
  res.statusCode = 201;
  res.headers = new Map();
  res.setHeader = (name, value) => res.headers.set(String(name).toLowerCase(), value);

  try {
    const result = await middleware(req, res, async () => {
      assert.equal(logger.getContext().requestId, 'generated-request-id');
      res.emit('finish');
      return 'done';
    });
    assert.equal(result, 'done');
    await logger.flush();
    assert.equal(res.headers.get('x-request-id'), 'generated-request-id');
    const [received, completed] = memory.all();
    assert.equal(received.message, 'HTTP request received');
    assert.equal(completed.message, 'HTTP request completed');
    assert.equal(received.requestId, 'generated-request-id');
    assert.equal(received.tenantId, 'tenant-7');
    assert.equal(received.userId, 'user-3');
    assert.equal(completed.data.statusCode, 201);
    assert.equal(typeof completed.data.durationMs, 'number');
  } finally { await logger.close(); }
});

test('EventLoggingBridge attaches, maps, and detaches without leaking listeners', async () => {
  const events = new EventEmitter();
  const memory = new MemoryTransport();
  const logger = createLogger({ level: 'debug', transports: [memory] });
  const bridge = new EventLoggingBridge(events, logger, { channel: 'events' });
  try {
    bridge.listen('order:paid', 'notice', (order) => ({ orderId: order.id, amount: order.amount }));
    events.emit('order:paid', { id: 'ord-1', amount: 42 });
    await logger.flush();
    assert.equal(memory.all()[0].channel, 'events');
    assert.equal(memory.all()[0].data.orderId, 'ord-1');
    bridge.close();
    assert.equal(events.listenerCount('order:paid'), 0);
  } finally { bridge.close(); await logger.close(); }
});
