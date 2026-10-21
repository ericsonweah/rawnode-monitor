'use strict';

import { TcpClient } from '#tcp';

const client = new TcpClient(
  process.env.HOST || '127.0.0.1',
  Number(process.env.PORT || 3000),
  { ackTimeoutMs: 5_000 },
);

await client.connect();
console.log(await client.request('echo', { hello: 'tcp' }));
await client.close();
