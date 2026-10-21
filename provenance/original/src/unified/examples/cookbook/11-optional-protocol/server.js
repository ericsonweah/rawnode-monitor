'use strict';

import Unified from '#unified';

const app = Unified({ profile: 'production' });

app.get('/', (_req, res) => res.json({ ok: true, degraded: app.health().degraded }));
app.tcp.handle('echo', async (_socket, payload, ack) => ack?.(payload));
app.udp.on('ping', (_body, response) => response.reply({ pong: true }));

app.manageSignals({ signals: ['SIGINT', 'SIGTERM'], timeoutMs: 15_000 });

const server = await app.start({
  host: '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  protocols: { http: true, websocket: true, tcp: true, udp: true },
  startup: {
    atomic: true,
    maxPortAttempts: 10,
    rollbackTimeoutMs: 2_000,
    // A UDP bind/boot failure may degrade the endpoint instead of aborting it.
    optionalProtocols: ['udp'],
  },
});

const health = server.health();
console.log({
  ready: health.ready,
  degraded: health.degraded,
  protocolFailures: health.protocolFailures,
  addresses: server.addresses(),
});

