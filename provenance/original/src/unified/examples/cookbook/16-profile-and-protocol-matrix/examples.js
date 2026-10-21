'use strict';

import Unified from '#unified';

// HTTP-only ultra profile.
export const httpOnly = Unified({ profile: 'ultra' });
await httpOnly.start({
  host: '127.0.0.1',
  port: 0,
  protocols: { http: true, websocket: false, tcp: false, udp: false },
});
await httpOnly.close();

// HTTP + WebSocket.
export const realtimeWeb = Unified({ profile: 'enterprise' });
await realtimeWeb.start({
  host: '127.0.0.1',
  port: 0,
  protocols: { http: true, websocket: true, tcp: false, udp: false },
});
await realtimeWeb.close();

// RawNode TCP only.
export const tcpOnly = Unified({ profile: 'enterprise' });
await tcpOnly.start({
  host: '127.0.0.1',
  port: 0,
  protocols: { http: false, websocket: false, tcp: true, udp: false },
});
await tcpOnly.close();

// UDP/RUDP only.
export const udpOnly = Unified({ profile: 'enterprise' });
await udpOnly.start({
  host: '127.0.0.1',
  port: 0,
  protocols: { http: false, websocket: false, tcp: false, udp: true },
});
await udpOnly.close();
