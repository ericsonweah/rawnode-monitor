'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { createLogger, InspectorTransport, InspectorServer } from '../../index.js';

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + length) return null;
  return {
    value: JSON.parse(buffer.subarray(offset, offset + length).toString('utf8')),
    rest: buffer.subarray(offset + length),
  };
}

function connect(address, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: address.address, port: address.port });
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => reject(new Error('inspector handshake timed out')), 1000);
    socket.once('error', reject);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const marker = buffer.indexOf('\r\n\r\n');
      if (marker === -1) return;
      clearTimeout(timer);
      const headers = buffer.subarray(0, marker + 4).toString('utf8');
      const rest = buffer.subarray(marker + 4);
      socket.removeAllListeners('data');
      resolve({ socket, headers, rest });
    });
    socket.once('connect', () => socket.write(request));
  });
}

test('inspector enforces path/token/origin and broadcasts redacted structured records', async () => {
  const transport = new InspectorTransport({ maxBuffer: 10 });
  const server = new InspectorServer(transport, {
    host: '127.0.0.1',
    port: 0,
    path: '/inspect',
    token: 'inspector-secret',
    origins: ['https://console.example'],
  });
  const address = await server.start();
  const key = randomBytes(16).toString('base64');
  const baseHeaders = [
    `Host: ${address.address}:${address.port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    'Origin: https://console.example',
  ];

  const denied = await connect(address, [`GET /inspect HTTP/1.1`, ...baseHeaders, '', ''].join('\r\n'));
  assert.match(denied.headers, /401 Unauthorized/);
  denied.socket.destroy();

  const accepted = await connect(address, [`GET /inspect?token=inspector-secret HTTP/1.1`, ...baseHeaders, '', ''].join('\r\n'));
  assert.match(accepted.headers, /101 Switching Protocols/);

  const logger = createLogger({ level: 'debug', transports: [{ transport, options: { owned: false } }] });
  try {
    let buffered = accepted.rest;
    const recordPromise = new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('inspector record timed out')), 1000);
      const consume = () => {
        const frame = decodeFrame(buffered);
        if (!frame) return false;
        buffered = frame.rest;
        if (frame.value.type === 'record') {
          clearTimeout(deadline);
          resolve(frame.value.record);
          return true;
        }
        return consume();
      };
      if (!consume()) accepted.socket.on('data', (chunk) => { buffered = Buffer.concat([buffered, chunk]); consume(); });
    });

    logger.info('inspected', { password: 'must-not-leak', ok: true });
    await logger.flush();
    const record = await recordPromise;
    assert.equal(record.message, 'inspected');
    assert.equal(record.data.password, '[REDACTED]');
    assert.equal(record.data.ok, true);
    assert.equal(transport.getBufferedLogs().length, 1);
  } finally {
    accepted.socket.destroy();
    await logger.close();
    await server.close();
    await transport.close();
  }
});

test('inspector history is bounded by both item count and bytes and returns defensive clones', async () => {
  const transport = new InspectorTransport({ maxBuffer: 10, maxBufferBytes: 1400 });
  const logger = createLogger({ transports: [{ transport, options: { owned: false } }] });
  try {
    for (let index = 0; index < 20; index++) logger.info(`record-${index}`, { payload: 'x'.repeat(80) });
    await logger.flush();
    const records = transport.getBufferedLogs();
    assert.ok(records.length < 20);
    assert.ok(transport.bufferBytes <= transport.maxBufferBytes);
    if (records.length) {
      const original = transport.getBufferedLogs({ clone: false })[0].message;
      records[0].message = 'mutated';
      assert.equal(transport.getBufferedLogs({ clone: false })[0].message, original);
    }
    assert.ok(transport.health().stats.dropped > 0);
  } finally {
    await logger.close();
    await transport.close();
  }
});
