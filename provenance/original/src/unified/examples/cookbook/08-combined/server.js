'use strict';

import Unified from '#unified';

const app = Unified({ profile: 'enterprise' });

app.get('/', (_req, res) => res.json({
  name: 'RawNode Unified',
  protocols: ['http', 'websocket', 'tcp', 'udp'],
}));
app.get('/addresses', (_req, res) => res.json(app.addresses()));

app.ws.on('connection', (socket) => {
  socket.on('echo', async (payload, ack) => ack?.({ transport: 'websocket', payload }));
});

app.tcp.handle('echo', async (_socket, payload, ack) => {
  await ack?.({ transport: 'tcp', payload });
});

app.udp.on('echo', (body, response) => {
  response.reply({ transport: 'udp', payload: body });
});

app.manageSignals({ signals: ['SIGINT', 'SIGTERM'], timeoutMs: 15_000 });

const server = await app.start({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  protocols: { http: true, websocket: true, tcp: true, udp: true },
});

const addresses = server.addresses();
if (!addresses.sameNumericPort) throw new Error('TCP and UDP did not bind the same numeric port.');
console.log(addresses);
