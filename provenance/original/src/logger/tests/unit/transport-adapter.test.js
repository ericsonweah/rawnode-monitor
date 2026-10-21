'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, MemoryTransport } from '../../index.js';

test('transport level and channel filters are enforced before delivery', async () => {
  const memory = new MemoryTransport();
  const logger = createLogger({
    level: 'important',
    transports: [{ transport: memory, options: { level: 'warn', channels: ['security'] } }],
  });
  try {
    logger.info('too-low', null, { channel: 'security' });
    logger.error('wrong-channel', null, { channel: 'application' });
    logger.error('delivered', null, { channel: 'security' });
    await logger.flush();
    assert.deepEqual(memory.all().map((record) => record.message), ['delivered']);
    assert.equal(logger.stats().transports[0].skipped, 2);
  } finally { await logger.close(); }
});

test('retry policy recovers transient failures and resets degraded state', async () => {
  let attempts = 0;
  const records = [];
  const transport = {
    name: 'recovering',
    rawnodeEnterpriseTransport: true,
    async writeRecord(record) {
      attempts++;
      if (attempts < 3) throw Object.assign(new Error('temporarily unavailable'), { code: 'EAGAIN' });
      records.push(record);
    },
    async flush() {},
    async close() {},
  };
  const logger = createLogger({
    transports: [{ transport, options: { maxRetries: 2, retryDelayMs: 1, retryMaxDelayMs: 2 } }],
  });
  try {
    await logger.logAsync('info', 'eventual');
    assert.equal(attempts, 3);
    assert.equal(records[0].message, 'eventual');
    const health = logger.health().transports[0];
    assert.equal(health.status, 'healthy');
    assert.equal(health.stats.retries, 2);
    assert.equal(health.stats.lastError, null);
  } finally { await logger.close(); }
});

test('transport ownership controls lifecycle without affecting flush', async () => {
  let externalClosed = 0;
  let ownedClosed = 0;
  let flushed = 0;
  const external = {
    name: 'external', rawnodeEnterpriseTransport: true,
    async writeRecord() {}, async flush() { flushed++; }, async close() { externalClosed++; },
  };
  const owned = {
    name: 'owned', rawnodeEnterpriseTransport: true,
    async writeRecord() {}, async flush() { flushed++; }, async close() { ownedClosed++; },
  };
  const logger = createLogger({
    transports: [
      { transport: external, options: { owned: false } },
      { transport: owned, options: { owned: true } },
    ],
  });
  logger.info('lifecycle');
  await logger.close();
  assert.ok(flushed >= 2);
  assert.equal(externalClosed, 0);
  assert.equal(ownedClosed, 1);
});
