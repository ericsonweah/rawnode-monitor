'use strict';

import { readFile } from 'node:fs/promises';
import { SecureTcpClient } from '#tcp';

const ca = await readFile(process.env.UNIFIED_TLS_CA_PATH || './storage/certs/ca.crt');
const client = new SecureTcpClient(
  process.env.UNIFIED_HOST || '127.0.0.1',
  Number(process.env.UNIFIED_PORT || 3443),
  {
    ackTimeoutMs: 5_000,
    tls: {
      ca,
      servername: process.env.UNIFIED_TLS_SERVERNAME || 'api.example.com',
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      ALPNProtocols: ['rawnode-tcp/1'],
    },
  },
);

await client.connect();
console.log(await client.request('secure:echo', { hello: 'secure RawNode TCP' }));
await client.close();
