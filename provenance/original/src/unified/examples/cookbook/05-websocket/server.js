'use strict';

// 

import Unified from '#unified';

const app = Unified({
  profile: 'enterprise',
  websocket: {
    path: '/realtime',
    allowedOrigins: ['http://127.0.0.1:3000', 'https://app.example.test'],
    maxConnections: 25_000,
    middlewareTimeoutMs: 5_000,
    upgradeRateLimit: { limit: 100, windowMs: 1_000 },
    eventSocket: {
      ackTimeoutMs: 5_000,
      maxPacketBytes: 256 * 1024,
      maxBufferBytes: 2 * 1024 * 1024,
      maxBufferMessages: 2_048,
      maxInboundPerWindow: 1_000,
      inboundWindowMs: 1_000,
    },
  },
});

app.get('/', (_req, res) => res.json({ websocket: '/realtime', namespace: '/chat' }));

// Global WebSocket handshake middleware. A thrown error rejects the upgrade.
app.ws.use(async (socket) => {
  const token = socket.handshake.query.token;
  if (token !== 'dev-token') {
    const error = new Error('Unauthorized WebSocket connection');
    error.code = 'WS_UNAUTHORIZED';
    throw error;
  }
  socket.data.userId = socket.handshake.query.userId || socket.id;
});

const chat = app.ws.of('/chat');

chat.on('connection', (socket) => {
  socket.emit('chat:ready', { socketId: socket.id, userId: socket.data.userId });

  socket.on('room:join', async (room, ack) => {
    socket.join(room);
    await ack?.({ joined: room, rooms: socket.joinedRooms });
  });

  socket.on('chat:message', async (payload, ack) => {
    const room = String(payload?.room || 'general');
    const message = {
      id: `${Date.now()}:${socket.id}`,
      room,
      text: String(payload?.text || ''),
      userId: socket.data.userId,
      at: Date.now(),
    };

    socket.to(room).emit('chat:message', message);
    await ack?.({ accepted: true, message });
  });

  socket.on('server:probe', async (_payload, ack) => {
    await ack?.({ ok: true, at: Date.now() });
  });
});

app.manageSignals({ signals: ['SIGINT', 'SIGTERM'], timeoutMs: 15_000 });

await app.start({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  protocols: { http: true, websocket: true, tcp: false, udp: false },
});
