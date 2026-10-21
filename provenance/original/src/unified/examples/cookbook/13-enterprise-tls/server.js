'use strict';

import { readFile } from 'node:fs/promises';
import Unified, { secureHeaders } from '#unified';

const [key, cert, ca] = await Promise.all([
  readFile(process.env.UNIFIED_TLS_KEY_PATH || './storage/certs/server.key'),
  readFile(process.env.UNIFIED_TLS_CERT_PATH || './storage/certs/server.crt'),
  readFile(process.env.UNIFIED_TLS_CA_PATH || './storage/certs/ca.crt'),
]);

const udpSecret = process.env.UNIFIED_UDP_HANDSHAKE_SECRET || process.env.APP_KEY;
if (!udpSecret) throw new Error('A shared UDP handshake secret is required.');

const app = Unified({
  profile: 'enterprise',
  tls: {
    enabled: true,
    options: {
      key,
      cert,
      ca,
      minVersion: 'TLSv1.2',
      honorCipherOrder: true,
      requestCert: false,
      rejectUnauthorized: false,
    },
    alpnProtocols: ['http/1.1', 'rawnode-tcp/1'],
    unknownAlpn: 'reject',
  },
  websocket: {
    path: '/realtime',
    allowedOrigins: ['https://app.example.com'],
  },
  udp: {
    handshake: { mode: 'required', secret: udpSecret },
    // UDP is not protected by TLS. Configure RawNode UDP codec encryption here
    // when confidentiality is required for UDP payloads.
    codec: {
      mode: 'json',
      encryption: {
        enabled: process.env.UNIFIED_UDP_ENCRYPTION === 'true',
        required: process.env.UNIFIED_UDP_ENCRYPTION === 'true',
        secrets: process.env.UNIFIED_UDP_ENCRYPTION_KEY
          ? [process.env.UNIFIED_UDP_ENCRYPTION_KEY]
          : undefined,
        activeKeyId: 0,
        bindHandshake: 'required',
        requireValidated: true,
      },
    },
  },
});

app.use(secureHeaders({ hsts: { maxAge: 15_552_000, includeSubDomains: true } }));
app.get('/', (_req, res) => res.json({ secure: true, alpn: ['http/1.1', 'rawnode-tcp/1'] }));
app.ws.on('connection', (socket) => {
  socket.on('secure:echo', async (payload, ack) => ack?.({ payload, secure: true }));
});
app.tcp.handle('secure:echo', async (_socket, payload, ack) => {
  await ack?.({ payload, secure: true });
});
app.udp.on('secure:echo', (body, response) => response.reply({ payload: body }));

app.manageSignals({ signals: ['SIGINT', 'SIGTERM'], timeoutMs: 30_000 });

const server = await app.start({
  host: process.env.UNIFIED_HOST || '0.0.0.0',
  port: Number(process.env.UNIFIED_PORT || 3443),
  protocols: { http: true, websocket: true, tcp: true, udp: true },
});

console.log('HTTPS/WSS/secure TCP + UDP:', server.addresses());
