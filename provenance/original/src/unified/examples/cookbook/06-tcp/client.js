'use strict';

import { TcpClient } from '#tcp';

const client = new TcpClient(
  process.env.HOST || '127.0.0.1',
  Number(process.env.PORT || 3000),
  {
    connectTimeoutMs: 5_000,
    ackTimeoutMs: 5_000,
    reconnect: {
      enabled: true,
      minDelayMs: 250,
      maxDelayMs: 5_000,
      factor: 2,
      jitter: 0.2,
      maxAttempts: 10,
    },
    heartbeat: { enabled: true, intervalMs: 25_000, timeoutMs: 10_000 },
  },
);

client.on('server:welcome', (payload) => console.log('welcome:', payload));
client.on('chat:message', (payload) => console.log('chat:', payload));
client.on('reconnecting', (info) => console.log('reconnecting:', info));
client.on('clientError', (error) => console.error('TCP client error:', error));

await client.connect();

const sum = await client.timeout(5_000).request('math:add', { a: 20, b: 22 });
console.log('sum:', sum);

console.log('join:', await client.request('room:join', { room: 'general' }));
console.log('chat ack:', await client.request('chat:message', {
  room: 'general',
  text: 'Hello over RawNode TCP',
}));
console.log('user:', await client.request('user:find', { id: 'user-1' }));

await client.close({ timeoutMs: 2_000 });
