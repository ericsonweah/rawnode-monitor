'use strict';

import { RawSocketClient } from '#ws';

const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const client = new RawSocketClient(`${scheme}//${window.location.host}/`, {
  autoConnect: false,
});

client.on('connect', async () => {
  console.log(await client.emitWithAck('echo', { hello: 'websocket' }));
});

client.connect();
