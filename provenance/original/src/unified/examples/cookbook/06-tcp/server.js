'use strict';

import Unified from '#unified';

const app = Unified({
  profile: 'enterprise',
  tcp: {
    heartbeat: { enabled: true, intervalMs: 25_000, timeoutMs: 60_000 },
    protocol: {
      maxPendingAcks: 10_000,
      maxRoomsPerSocket: 64,
      maxEventsPerSecond: 1_000,
      maxBytesPerSecond: 2 * 1024 * 1024,
      handlerMode: 'serial',
      maxConcurrentHandlers: 1,
      onViolation: 'disconnect',
    },
    observability: { enabled: true, metricsPrefix: 'rawnode_tcp_' },
  },
});

app.tcp.use(async (socket) => {
  socket.data.connectedAt = Date.now();
  socket.data.role = 'client';
});

app.tcp.on('connection', (socket) => {
  socket.emit('server:welcome', {
    socketId: socket.id,
    ip: socket.ip,
    connectedAt: socket.data.connectedAt,
  });
});

app.tcp.schema('math:add', { a: 'number', b: 'number' });
app.tcp.handle('math:add', async (_socket, payload, ack) => {
  await ack?.({ result: payload.a + payload.b });
}, { timeoutMs: 2_000 });

app.tcp.handle('room:join', async (socket, payload, ack) => {
  const room = String(payload?.room || 'general');
  await socket.joinAsync(room);
  await ack?.({ joined: room });
});

app.tcp.handle('chat:message', async (socket, payload, ack) => {
  const room = String(payload?.room || 'general');
  socket.to(room).emit('chat:message', {
    from: socket.id,
    room,
    text: String(payload?.text || ''),
    at: Date.now(),
  });
  await ack?.({ accepted: true });
});

app.tcp.group('user:', (group) => {
  group.schema('find', { id: 'string' });
  group.handle('find', async (_socket, payload, ack) => {
    await ack?.({ id: payload.id, name: 'RawNode User' });
  });
});

app.manageSignals({ signals: ['SIGINT', 'SIGTERM'], timeoutMs: 15_000 });

await app.start({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  protocols: { http: false, websocket: false, tcp: true, udp: false },
});
