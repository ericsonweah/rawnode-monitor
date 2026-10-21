'use strict';

import Unified from '#unified';

const app = Unified({ profile: 'compat' });

// HTTP
app.get('/', (_req, res) => {
  res.type('text/plain').send('RawNode Unified is online');
});

app.get('/users/:id', (req, res) => {
  res.json({
    id: req.params.id,
    query: req.query,
    requestId: req.id ?? null,
  });
});

app.post('/echo', Unified.json({ limit: '64kb' }), (req, res) => {
  res.status(201).json({ received: req.body });
});

app.onNotFound((req, res) => {
  res.status(404).json({ error: 'Not Found', method: req.method, path: req.path });
});

// WebSocket
app.ws.on('connection', (socket) => {
  socket.emit('server:welcome', { socketId: socket.id });

  socket.on('chat:message', async (message, ack) => {
    socket.broadcast.emit('chat:message', {
      socketId: socket.id,
      message,
      at: Date.now(),
    });
    await ack?.({ received: true, message });
  });
});

// RawNode TCP
app.tcp.on('connection', (socket) => {
  socket.emit('server:welcome', { socketId: socket.id });
});

app.tcp.handle('echo', async (_socket, payload, ack) => {
  await ack?.(payload);
});

// RawNode UDP/RUDP. Handler arguments are: (body, response, request).
app.udp.on('ping', (_body, response) => {
  response.reply({ pong: true, time: Date.now() });
});

app.manageSignals({
  signals: ['SIGINT', 'SIGTERM'],
  timeoutMs: 15_000,
  setExitCode: true,
});

const server = await app.start({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  protocols: { http: true, websocket: true, tcp: true, udp: true },
});

console.log('RawNode Unified is ready:', server.addresses());
