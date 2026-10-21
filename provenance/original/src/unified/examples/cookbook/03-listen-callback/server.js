'use strict';

import Unified from '#unified';

const app = Unified({ profile: 'compat' });

app.get('/', (_req, res) => res.send('Callback-style startup works'));
app.tcp.handle('echo', async (_socket, payload, ack) => ack?.(payload));
app.udp.on('ping', (_body, response) => response.reply({ pong: true }));

app.manageSignals({ signals: ['SIGINT', 'SIGTERM'], timeoutMs: 15_000 });

// listen() returns UnifiedServer immediately. The callback runs after the
// atomic startup transaction has committed.
const server = app.listen(
  {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 3000),
    protocols: { http: true, websocket: true, tcp: true, udp: true },
  },
  () => {
    console.log('RawNode Unified is ready:', server.addresses());
  },
);

server.on('listenError', (error) => {
  console.error('Unified startup failed:', error);
  process.exitCode = 1;
});
