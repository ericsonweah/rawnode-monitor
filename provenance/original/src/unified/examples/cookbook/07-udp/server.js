'use strict';

import Unified from '#unified';

const udpSecret = process.env.UNIFIED_UDP_HANDSHAKE_SECRET || process.env.APP_KEY;
if (!udpSecret) throw new Error('UNIFIED_UDP_HANDSHAKE_SECRET or APP_KEY is required.');

const app = Unified({
  profile: 'enterprise',
  udp: {
    maxPacketSize: 8_192,
    limits: { maxJsonBytes: 64 * 1024, maxPayloadBytes: 256 * 1024 },
    handshake: {
      mode: 'required',
      secret: udpSecret,
      rateLimit: { windowMs: 1_000, maxAttempts: 20, maxEntries: 65_536 },
      amp: { maxFactor: 3, maxBytes: 65_536 },
    },
    admission: {
      maxEntries: 65_536,
      ttlMs: 60_000,
      ratePerSecond: 200,
      burst: 400,
      cleanupBudget: 16,
    },
    peer: {
      maxMessageSize: 256 * 1024,
      maxPending: 1_024,
      maxQueue: 4_096,
      maxRetries: 8,
    },
  },
});

app.udp.use((request, _response, next) => {
  if (!request.rinfo?.address) return;
  return next();
});

app.udp.on('ping', (_body, response, request) => {
  response.reply({
    pong: true,
    requestId: request.id,
    remote: `${request.rinfo.address}:${request.rinfo.port}`,
    at: Date.now(),
  });
});

app.udp.on('telemetry:ingest', async (body, response) => {
  // Persist or enqueue asynchronously in a real application.
  await Promise.resolve();
  response.reply({ accepted: true, samples: Array.isArray(body?.samples) ? body.samples.length : 0 });
});

app.udp.onLifecycle('peerValidated', (_peer, rinfo) => {
  console.log('UDP peer validated:', rinfo.address, rinfo.port);
});

app.manageSignals({ signals: ['SIGINT', 'SIGTERM'], timeoutMs: 15_000 });

await app.start({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  protocols: { http: false, websocket: false, tcp: false, udp: true },
});
