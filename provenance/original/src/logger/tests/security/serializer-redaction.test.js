'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, MemoryTransport, SafeSerializer, Redactor } from '../../index.js';

test('safe serializer handles cycles, BigInt, maps, sets, errors, buffers, and hostile getters', () => {
  let getterInvoked = false;
  const value = {
    id: 1n,
    map: new Map([['a', 1]]),
    set: new Set([1, 2]),
    error: new Error('boom'),
    bytes: Buffer.from('hello'),
  };
  Object.defineProperty(value, 'secretGetter', { enumerable: true, get() { getterInvoked = true; throw new Error('must not run'); } });
  value.self = value;
  const serializer = new SafeSerializer({ getterPolicy: 'describe' });
  const normalized = serializer.normalize(value);
  assert.equal(getterInvoked, false);
  assert.equal(normalized.id, '1n');
  assert.match(normalized.self, /Circular/);
  assert.equal(normalized.map.type, 'Map');
  assert.equal(normalized.set.type, 'Set');
  assert.equal(normalized.error.message, 'boom');
  assert.equal(normalized.bytes.type, 'Buffer');
  assert.equal(normalized.secretGetter, '[Getter]');
  assert.doesNotThrow(() => JSON.parse(serializer.stringify(value)));
});

test('safe serializer enforces depth, key, array, string, and record bounds', () => {
  const serializer = new SafeSerializer({ maxDepth: 2, maxKeys: 5, maxArrayItems: 2, maxStringBytes: 8, maxRecordBytes: 256 });
  const normalized = serializer.normalize({
    text: 'this is a much longer string',
    values: [1, 2, 3, 4],
    deep: { one: { two: { three: true } } },
    extra1: 1,
    extra2: 2,
    extra3: 3,
  });
  assert.match(normalized.text, /truncated/);
  assert.match(normalized.values.at(-1), /more items/);
  assert.doesNotThrow(() => JSON.parse(serializer.stringify(normalized)));
});

test('redactor protects nested fields, bearer tokens, JWTs, URLs, controls, ANSI, and bidi characters', () => {
  const redactor = new Redactor({ enabled: true, sanitizeControls: true, stripAnsi: true });
  const output = redactor.redact({
    password: 'pw',
    nested: { authorization: 'Bearer abc.def.ghi' },
    message: '\u001b[31mhello\u001b[0m\nforged\u202E',
    url: 'https://user:pass@example.com/path?token=secret&safe=1',
    jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
  });
  assert.equal(output.password, '[REDACTED]');
  assert.equal(output.nested.authorization, '[REDACTED]');
  assert.equal(output.message.includes('\u001b'), false);
  assert.equal(output.message.includes('\n'), false);
  assert.equal(output.message.includes('\\n'), true);
  assert.equal(output.message.includes('\u202E'), false);
  assert.match(output.url, /\[REDACTED\]/);
  assert.equal(output.jwt, '[REDACTED]');
});

test('production logging redacts secrets from records and formatted output', async () => {
  const memory = new MemoryTransport();
  const logger = createLogger({ level: 'debug', transports: [memory] });
  try {
    const circular = { password: 'super-secret', nested: { authorization: 'Bearer abc.def.ghi' }, count: 2n };
    circular.self = circular;
    logger.info('login\nforged-line', circular);
    await logger.flush();
    const record = memory.all()[0];
    assert.equal(record.data.password, '[REDACTED]');
    assert.equal(record.data.nested.authorization, '[REDACTED]');
    assert.equal(record.data.count, '2n');
    assert.match(record.data.self, /Circular/);
    assert.equal(record.message.includes('\n'), false);
    assert.equal(record.formatted.includes('super-secret'), false);
    assert.equal(JSON.stringify(record).includes('super-secret'), false);
  } finally { await logger.close(); }
});

test('redaction paths and allow-path exceptions are deterministic', () => {
  const redactor = new Redactor({
    enabled: true,
    paths: ['$.profile.email'],
    allowPaths: ['$.debug.token'],
    sanitizeControls: true,
  });
  const output = redactor.redact({ profile: { email: 'x@example.com' }, debug: { token: 'visible-in-debug' } });
  assert.equal(output.profile.email, '[REDACTED]');
  assert.equal(output.debug.token, 'visible-in-debug');
});
