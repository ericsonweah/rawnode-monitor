'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, MemoryTransport } from '../../index.js';

async function withLogger(options, callback) {
  const memory = options.memory || new MemoryTransport({ maxItems: 10_000 });
  const logger = createLogger({ level: 'debug', transports: [memory], ...options });
  try { return await callback(logger, memory); }
  finally { await logger.close(); }
}

test('structured records include context, correlation, metadata, and child fields', async () => {
  await withLogger({ service: 'orders', environment: 'test' }, async (logger, memory) => {
    await logger.runWithContext({ requestId: 'req-1', traceId: 'trace-1' }, async () => {
      logger.child({ orderId: 'ord-1' }).info('created', { total: 42 });
    });
    await logger.flush();
    const record = memory.all()[0];
    assert.equal(record.service, 'orders');
    assert.equal(record.environment, 'test');
    assert.equal(record.requestId, 'req-1');
    assert.equal(record.traceId, 'trace-1');
    assert.equal(record.context.orderId, 'ord-1');
    assert.equal(record.data.total, 42);
    assert.equal(record.droppable, true);
    assert.equal(typeof record.id, 'string');
    assert.equal(typeof record.sequence, 'number');
    assert.match(logger.prometheus(), /rawnode_logger/);
  });
});

test('disabled lazy values are not evaluated', async () => {
  await withLogger({ level: 'info' }, async (logger, memory) => {
    let messageEvaluated = false;
    let dataEvaluated = false;
    logger.debug(() => { messageEvaluated = true; return 'expensive'; }, () => { dataEvaluated = true; return { expensive: true }; });
    await logger.flush();
    assert.equal(messageEvaluated, false);
    assert.equal(dataEvaluated, false);
    assert.equal(memory.all().length, 0);
  });
});

test('asynchronous processors preserve global record order', async () => {
  await withLogger({}, async (logger, memory) => {
    logger.use(async (record) => {
      if (record.message === 'one') await new Promise((resolve) => setTimeout(resolve, 15));
      record.context.processed = true;
      return record;
    });
    logger.info('one');
    logger.child({ child: true }).info('two');
    logger.info('three');
    await logger.flush();
    assert.deepEqual(memory.all().map((record) => record.message), ['one', 'two', 'three']);
    assert.ok(memory.all().every((record) => record.context.processed));
  });
});

test('processor phases protect secrets and can enrich after redaction', async () => {
  await withLogger({}, async (logger, memory) => {
    let trustedSawSecret = false;
    let untrustedSawSecret = false;
    logger.processor((record) => {
      trustedSawSecret = record.data.password === 'super-secret';
      return record;
    }, { name: 'trusted', phase: 'before-redaction', trusted: true });
    logger.processor((record) => {
      untrustedSawSecret = record.data.password === 'super-secret';
      record.context.postProcessed = true;
      return record;
    }, { name: 'untrusted', phase: 'after-redaction', trusted: false });
    logger.info('login', { password: 'super-secret' });
    await logger.flush();
    assert.equal(trustedSawSecret, true);
    assert.equal(untrustedSawSecret, false);
    assert.equal(memory.all()[0].data.password, '[REDACTED]');
    assert.equal(memory.all()[0].context.postProcessed, true);
  });
});

test('custom levels are additive and retain delivery policy', async () => {
  await withLogger({}, async (logger, memory) => {
    logger.registerLevel({ name: 'audit', rank: 5.5, severity: 52, syslog: 5, droppable: false });
    logger.setLevel('debug');
    await logger.logAsync('audit', 'permission changed', { role: 'admin' });
    const record = memory.all()[0];
    assert.equal(record.level, 'audit');
    assert.equal(record.droppable, false);
    assert.equal(record.syslog, 5);
  });
});

test('timers, measure, once, at, when, sampling, and rate limiting are fluent', async () => {
  await withLogger({ random: () => 0.99 }, async (logger, memory) => {
    const timer = logger.time('operation');
    timer.stop('info', { ok: true });
    logger.once('boot').notice('booted');
    logger.once('boot').notice('booted again');
    logger.rateLimit('burst', { limit: 1, intervalMs: 1000 }).info('first');
    logger.rateLimit('burst', { limit: 1, intervalMs: 1000 }).info('second');
    logger.at('warn').log('fixed-level');
    logger.when(false).critical('disabled-critical');
    logger.sample(0).debug('sampled-out');
    await logger.measure('measured', async () => 42);
    await logger.flush();
    const messages = memory.all().map((record) => record.message);
    assert.equal(messages.filter((message) => message === 'booted').length, 1);
    assert.equal(messages.includes('booted again'), false);
    assert.equal(messages.filter((message) => message === 'first').length, 1);
    assert.equal(messages.includes('second'), false);
    assert.equal(messages.includes('fixed-level'), true);
    assert.equal(messages.includes('disabled-critical'), false);
    assert.equal(messages.includes('sampled-out'), false);
    assert.equal(messages.includes('operation'), true);
    assert.equal(messages.includes('measured'), true);
  });
});

test('request and job helpers propagate expected fields', async () => {
  await withLogger({}, async (logger, memory) => {
    logger.forRequest({
      id: 'req-7', method: 'POST', url: '/orders', headers: {},
      user: { id: 'user-3' }, tenantId: 'tenant-2', socket: { remoteAddress: '127.0.0.1' },
    }).info('request');
    logger.forJob({ id: 'job-1', queue: 'emails', attempt: 2, tenantId: 'tenant-2' }).info('job');
    await logger.flush();
    const [request, job] = memory.all();
    assert.equal(request.requestId, 'req-7');
    assert.equal(request.userId, 'user-3');
    assert.equal(request.context.method, 'POST');
    assert.equal(job.context.jobId, 'job-1');
    assert.equal(job.context.queue, 'emails');
  });
});

test('errors are normalized with causes and structured context', async () => {
  await withLogger({}, async (logger, memory) => {
    const cause = Object.assign(new Error('database offline'), { code: 'DB_DOWN' });
    const error = new Error('request failed', { cause });
    logger.error(error, { operation: 'checkout' });
    await logger.flush();
    const record = memory.all()[0];
    assert.equal(record.message, 'request failed');
    assert.equal(record.error.message, 'request failed');
    assert.equal(record.error.cause.message, 'database offline');
    assert.equal(record.error.cause.code, 'DB_DOWN');
    assert.equal(record.data.operation, 'checkout');
  });
});

test('plugin failures are isolated in production while valid hooks continue', async () => {
  await withLogger({}, async (logger, memory) => {
    logger.plugin({ name: 'broken', hooks: { beforeWrite() { throw new Error('plugin failed'); } } });
    logger.plugin({ name: 'good', priority: 20, hooks: { beforeWrite(record) { record.context.plugin = true; return record; } } });
    logger.info('plugin-test');
    await logger.flush();
    assert.equal(memory.all()[0].context.plugin, true);
    assert.ok(logger.diagnosticsSnapshot().some((entry) => entry.code === 'LOGGER_PLUGIN_ERROR'));
  });
});

test('metrics and health expose queue and transport state', async () => {
  await withLogger({}, async (logger) => {
    logger.info('health');
    await logger.flush();
    const stats = logger.stats();
    const health = logger.health();
    assert.ok(stats.counters.records_accepted_total >= 1);
    assert.equal(health.status, 'healthy');
    assert.equal(Array.isArray(health.transports), true);
    assert.equal(typeof stats.pipeline.queuedItems, 'number');
  });
});


test('metrics remains a callable severity while the registry remains observable', async () => {
  const transport = new MemoryTransport();
  const logger = createLogger({ level: 'important', transports: [transport] });
  try {
    assert.equal(typeof logger.metrics, 'function');
    assert.ok(logger.runtime.metricsRegistry);
    logger.metrics('queue depth', { value: 3 });
    await logger.flush();
    const [record] = transport.all();
    assert.equal(record.level, 'metrics');
    assert.equal(record.message, 'queue depth');
    assert.ok(logger.metricsSnapshot().counters.records_accepted >= 1);
  } finally { await logger.close(); }
});

test('long-lived once and rate-limit state remains bounded', async () => {
  const transport = new MemoryTransport();
  const logger = createLogger({
    level: 'debug',
    transports: [transport],
    stateLimits: { maxOnceKeys: 2, maxRateBuckets: 2 },
  });
  try {
    logger.once('a').info('a');
    logger.once('b').info('b');
    logger.once('c').info('c');
    logger.rateLimit('r1', { limit: 10, intervalMs: 60_000 }).info('r1');
    logger.rateLimit('r2', { limit: 10, intervalMs: 60_000 }).info('r2');
    logger.rateLimit('r3', { limit: 10, intervalMs: 60_000 }).info('r3');
    await logger.flush();
    assert.ok(logger.runtime.sharedState.onceKeys.size <= 2);
    assert.ok(logger.runtime.sharedState.rateBuckets.size <= 2);
  } finally { await logger.close(); }
});
