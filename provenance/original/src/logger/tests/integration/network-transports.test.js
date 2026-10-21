'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
import http from 'node:http';
import {
  createLogger,
  TcpTransport,
  UdpTransport,
  HttpBatchTransport,
  RedisStreamTransport,
} from '../../index.js';

async function listen(server, ...args) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(...args, resolve);
  });
  return server.address();
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

test('TCP transport sends newline-delimited structured records with backpressure support', async () => {
  const received = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line) received.push(JSON.parse(line));
      }
    });
  });
  const address = await listen(server, 0, '127.0.0.1');
  const transport = new TcpTransport({ host: '127.0.0.1', port: address.port });
  const logger = createLogger({ level: 'debug', transports: [transport] });
  try {
    logger.info('tcp-one');
    logger.warn('tcp-two');
    await logger.flush();
    const deadline = Date.now() + 500;
    while (received.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.deepEqual(received.map((record) => record.message), ['tcp-one', 'tcp-two']);
  } finally {
    await logger.close();
    await closeServer(server);
  }
});

test('UDP transport sends bounded datagrams and truncates oversized records', async () => {
  const socket = dgram.createSocket('udp4');
  const messages = [];
  socket.on('message', (message) => messages.push(message));
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
  const address = socket.address();
  const transport = new UdpTransport({ host: '127.0.0.1', port: address.port, maxPacketBytes: 512, oversize: 'truncate' });
  const logger = createLogger({ level: 'debug', transports: [transport] });
  try {
    logger.info('udp-one');
    logger.warn('x'.repeat(4000));
    await logger.flush();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(messages.length, 2);
    assert.ok(messages.every((message) => message.length <= 512));
    assert.equal(JSON.parse(messages[0]).message, 'udp-one');
    assert.equal(JSON.parse(messages[1]).truncated, true);
  } finally {
    await logger.close();
    await new Promise((resolve) => socket.close(resolve));
  }
});

test('HTTP batch transport batches records and retries transient responses', async () => {
  const bodies = [];
  let requests = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      requests++;
      bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (requests === 1) { res.statusCode = 503; res.end('retry'); }
      else { res.statusCode = 202; res.end('accepted'); }
    });
  });
  const address = await listen(server, 0, '127.0.0.1');
  const transport = new HttpBatchTransport({
    url: `http://127.0.0.1:${address.port}/logs`,
    batchSize: 3,
    maxRetries: 1,
    retryDelayMs: 1,
  });
  const logger = createLogger({
    level: 'debug',
    transports: [{ transport, options: { batchSize: 3 } }],
  });
  try {
    logger.info('one');
    logger.info('two');
    logger.info('three');
    await logger.flush();
    assert.equal(requests, 2);
    assert.equal(bodies.at(-1).records.length, 3);
    assert.deepEqual(bodies.at(-1).records.map((record) => record.message), ['one', 'two', 'three']);
  } finally {
    await logger.close();
    await closeServer(server);
  }
});

test('Redis Streams transport uses native XADD-compatible client methods', async () => {
  const calls = [];
  const client = { async xadd(...args) { calls.push(args); return '1-0'; } };
  const transport = new RedisStreamTransport(client, { stream: 'rawnode:test:logs', maxLength: 1000 });
  const logger = createLogger({ level: 'debug', transports: [transport] });
  try {
    logger.info('redis-one', { tenantId: 'tenant-1' });
    await logger.flush();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'rawnode:test:logs');
    assert.ok(calls[0].includes('MAXLEN'));
    assert.ok(calls[0].includes('payload'));
  } finally { await logger.close(); }
});
