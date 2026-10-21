'use strict';

import Unified from '#unified';

const app = Unified({
  profile: 'enterprise',
  proxyProtocol: {
    enabled: true,
    required: true,
    // Only infrastructure addresses that actually originate Proxy Protocol.
    trusted: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
    maxHeaderBytes: 536,
  },
  classification: { maxBytes: 64, timeoutMs: 300, ambiguous: 'reject' },
});

app.get('/client', (req, res) => {
  res.json({ ip: req.ip, clientIp: req.clientIp, requestId: req.id });
});
app.tcp.handle('client:identity', async (socket, _payload, ack) => {
  await ack?.({ ip: socket.ip, context: socket.context?.metadata || null });
});

app.manageSignals({ signals: ['SIGINT', 'SIGTERM'], timeoutMs: 15_000 });
await app.start({
  host: '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  protocols: { http: true, websocket: true, tcp: true, udp: false },
});
