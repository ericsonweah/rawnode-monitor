'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../index.js';

test('bounded queues shed low-severity overflow while preserving critical records', async () => {
  const delivered = [];
  const slow = {
    name: 'slow',
    rawnodeEnterpriseTransport: true,
    async writeRecord(record) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      delivered.push(record);
    },
    async flush() {},
    async close() {},
  };
  const logger = createLogger({
    level: 'important',
    transports: [{
      transport: slow,
      options: {
        maxItems: 3,
        maxBytes: 1024 * 1024,
        maxOvercommitItems: 2,
        overflow: 'severity-aware',
      },
    }],
    pipelineQueue: { maxItems: 6, maxBytes: 1024 * 1024, overflow: 'severity-aware' },
  });
  try {
    for (let index = 0; index < 40; index++) logger.debug(`debug-${index}`);
    logger.critical('must-survive');
    await logger.flush();
    assert.ok(delivered.some((record) => record.message === 'must-survive'));
    const stats = logger.stats();
    const dropped = stats.pipeline.stats.dropped + stats.transports.reduce((sum, transport) => sum + transport.dropped, 0);
    assert.ok(dropped > 0);
  } finally { await logger.close(); }
});

test('transport failures are isolated and open a circuit breaker', async () => {
  let attempts = 0;
  const broken = {
    name: 'broken',
    rawnodeEnterpriseTransport: true,
    async writeRecord() { attempts++; throw Object.assign(new Error('offline'), { code: 'OFFLINE' }); },
    async flush() {},
    async close() {},
  };
  const logger = createLogger({
    level: 'debug',
    transports: [{ transport: broken, options: { failureThreshold: 2, circuitOpenMs: 10_000, maxRetries: 0 } }],
  });
  try {
    await assert.rejects(() => logger.logAsync('info', 'first'));
    await assert.rejects(() => logger.logAsync('info', 'second'));
    logger.info('third');
    await logger.flush();
    assert.equal(attempts, 2);
    assert.equal(logger.health().transports[0].circuitOpen, true);
    assert.ok(logger.diagnosticsSnapshot().some((entry) => /TRANSPORT/.test(entry.code)));
  } finally { await logger.close(); }
});
