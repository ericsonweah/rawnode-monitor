'use strict';

import Unified from '#unified';

const app = Unified({ profile: 'compat' });

app.get('/', (_req, res) => {
  res.type('text/plain').send('Hello from RawNode Unified HTTP');
});

const server = await app.start({
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 3000),
  protocols: {
    http: true,
    websocket: false,
    tcp: false,
    udp: false,
  },
});

console.log('HTTP address:', server.address());
