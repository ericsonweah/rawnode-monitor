'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, stat, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLogger, EnterpriseFileTransport, AuditFileTransport } from '../../index.js';

test('file transport is lazy, asynchronous, rotatable, compressible, reopenable, and closeable', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rawnode-logger-file-'));
  const transport = new EnterpriseFileTransport({
    logDirectory: directory,
    fileName: 'app.log',
    rotateInterval: 0,
    maxSize: 1024 * 1024,
    compressOnRotate: true,
  });
  assert.equal(transport.stream, null);
  const logger = createLogger({ level: 'debug', transports: [transport] });
  logger.info('first', { value: 1 });
  logger.error('second', { value: 2 });
  await logger.flush();
  const content = await readFile(path.join(directory, 'app.log'), 'utf8');
  assert.match(content, /first/);
  assert.match(content, /second/);
  const rotation = await transport.rotate();
  assert.ok(rotation.archive.endsWith('.gz'));
  assert.ok((await stat(rotation.archive)).size > 0);
  await transport.reopen();
  logger.info('after-reopen');
  await logger.flush();
  assert.match(await readFile(path.join(directory, 'app.log'), 'utf8'), /after-reopen/);
  await logger.close();
  const files = await readdir(directory);
  assert.ok(files.includes('app.log'));
  assert.ok(files.some((name) => name.endsWith('.gz')));
  assert.equal(transport.health().closed, true);
});

test('file retention limits archive count', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rawnode-logger-retention-'));
  const transport = new EnterpriseFileTransport({
    logDirectory: directory,
    fileName: 'app.log',
    rotateInterval: 0,
    maxSize: 1024 * 1024,
    retention: { maxFiles: 2 },
  });
  const logger = createLogger({ level: 'debug', transports: [transport] });
  for (let index = 0; index < 4; index++) {
    logger.info(`rotation-${index}`);
    await logger.flush();
    await transport.rotate();
  }
  await logger.close();
  const files = (await readdir(directory)).filter((name) => name.startsWith('app-'));
  assert.ok(files.length <= 2, `expected <=2 archives, got ${files.length}`);
});

test('file transport refuses symbolic-link targets by default', async (t) => {
  if (process.platform === 'win32') return t.skip('symlink privileges vary on Windows');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rawnode-logger-symlink-'));
  const target = path.join(directory, 'target.log');
  const link = path.join(directory, 'app.log');
  await writeFile(target, '');
  await symlink(target, link);
  const transport = new EnterpriseFileTransport({ logDirectory: directory, fileName: 'app.log', rotateInterval: 0 });
  await assert.rejects(() => transport.ready(), (error) => error.code === 'LOGGER_FILE_SYMLINK_DENIED');
  await transport.close().catch(() => {});
});

test('audit transport creates, resumes, verifies, and detects tampering in its HMAC chain', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rawnode-logger-audit-'));
  const secret = 'audit-test-secret';
  const file = path.join(directory, 'audit.log');

  const firstTransport = new AuditFileTransport({ secret, logDirectory: directory, fileName: 'audit.log', rotateInterval: 0 });
  const firstLogger = createLogger({ level: 'debug', transports: [firstTransport] });
  firstLogger.notice('role assigned', { userId: 1, role: 'admin' });
  firstLogger.warn('policy changed', { policy: 'billing' });
  await firstLogger.close();

  const secondTransport = new AuditFileTransport({ secret, logDirectory: directory, fileName: 'audit.log', rotateInterval: 0 });
  const secondLogger = createLogger({ level: 'debug', transports: [secondTransport] });
  secondLogger.error('access denied', { userId: 2 });
  await secondLogger.close();

  const valid = await AuditFileTransport.verifyFile(file, { secret });
  assert.equal(valid.valid, true);
  assert.equal(valid.lines, 3);
  assert.equal(valid.sequence, 3);

  const content = await readFile(file, 'utf8');
  await writeFile(file, content.replace('role assigned', 'role removed'));
  const invalid = await AuditFileTransport.verifyFile(file, { secret });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.failures.length >= 1);
});
