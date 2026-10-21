'use strict';

import { RawNodeClient } from '#udp';

const client = new RawNodeClient({
  timeout: 5_000,
  keepAlive: 2_000,
  reconnect: false,
  maxRetries: 5,
  handshakeRetryMs: 300,
  peer: {
    maxMessageSize: 256 * 1024,
    maxPending: 1_024,
    maxQueue: 4_096,
  },
});

client.on('message', (path, data) => console.log('UDP push:', path, data));
client.on('error', (error) => console.error('UDP error:', error));

await new Promise((resolve, reject) => {
  client.once('validated', resolve);
  client.once('error', reject);
  client.connect(process.env.HOST || '127.0.0.1', Number(process.env.PORT || 3000));
});

console.log('ping:', await client.request('ping', { sequence: 1 }, true));
console.log('telemetry:', await client.request('telemetry:ingest', {
  deviceId: 'sensor-1',
  samples: [{ temperature: 21.5 }, { temperature: 21.7 }],
}, true));

// Fire-and-forget unreliable datagram:
client.send('telemetry:ingest', { deviceId: 'sensor-1', samples: [] }, false);

client.disconnect();
