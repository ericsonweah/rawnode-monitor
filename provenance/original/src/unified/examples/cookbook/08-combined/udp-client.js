'use strict';

import { RawNodeClient } from '#udp';

const client = new RawNodeClient({ reconnect: false, timeout: 5_000 });
await new Promise((resolve, reject) => {
  client.once('validated', resolve);
  client.once('error', reject);
  client.connect(
    process.env.HOST || '127.0.0.1',
    Number(process.env.PORT || 3000),
  );
});

console.log(await client.request('echo', { hello: 'udp' }));
client.disconnect();
