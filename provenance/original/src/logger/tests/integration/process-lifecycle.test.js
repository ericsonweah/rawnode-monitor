'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ProcessErrorHandler } from '../../index.js';

test('ProcessErrorHandler attachment is explicit, idempotent, and reversible', async () => {
  const before = {
    uncaughtException: process.listenerCount('uncaughtException'),
    unhandledRejection: process.listenerCount('unhandledRejection'),
    warning: process.listenerCount('warning'),
  };
  const calls = [];
  const logger = {
    async logAsync(level, message, data, options) { calls.push({ level, message, data, options }); },
    async flush() { calls.push({ flush: true }); },
  };
  const handler = new ProcessErrorHandler(logger, {
    uncaughtException: true,
    unhandledRejection: true,
    warning: true,
    flushTimeoutMs: 100,
  });
  handler.attach().attach();
  assert.equal(process.listenerCount('uncaughtException'), before.uncaughtException + 1);
  assert.equal(process.listenerCount('unhandledRejection'), before.unhandledRejection + 1);
  assert.equal(process.listenerCount('warning'), before.warning + 1);
  await handler._report('error', 'synthetic', new Error('boom'), { source: 'test' });
  assert.equal(calls[0].level, 'error');
  assert.equal(calls.at(-1).flush, true);
  handler.detach();
  assert.equal(process.listenerCount('uncaughtException'), before.uncaughtException);
  assert.equal(process.listenerCount('unhandledRejection'), before.unhandledRejection);
  assert.equal(process.listenerCount('warning'), before.warning);
});

test('import, log, flush, and close leave no refed logger handles', async () => {
  const root = path.resolve(new URL('../..', import.meta.url).pathname);
  const script = `
    import { createLogger, MemoryTransport } from ${JSON.stringify(path.join(root, 'index.js'))};
    const logger = createLogger({ transports: [new MemoryTransport()] });
    logger.info('open-handle-check');
    await logger.close();
    process.stdout.write('closed');
  `;
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`child did not exit: ${stderr}`)); }, 3000);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'closed');
});
