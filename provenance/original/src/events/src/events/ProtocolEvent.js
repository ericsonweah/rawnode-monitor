'use strict';

// src/events/ProtocolEvent.js

import { Event } from './Event.js';

function connectionDescriptor(connection) {
  if (!connection || typeof connection !== 'object') return null;
  return {
    id: connection.id ?? connection.connectionId ?? null,
    remoteAddress: connection.remoteAddress ?? connection.socket?.remoteAddress ?? null,
    remotePort: connection.remotePort ?? connection.socket?.remotePort ?? null,
    localAddress: connection.localAddress ?? connection.socket?.localAddress ?? null,
    localPort: connection.localPort ?? connection.socket?.localPort ?? null,
  };
}

export class ProtocolEvent extends Event {
  constructor(payload = {}, meta = {}) {
    super(payload, meta);
    this.protocol = meta.protocol || 'app';
    this.connection = meta.connection || null;
    this.transport = meta.transport || null;
    this.connectionMeta = meta.connectionMeta || connectionDescriptor(this.connection);
  }

  toJSON() {
    return {
      ...super.toJSON(),
      protocol: this.protocol,
      transport: this.transport,
      connection: this.connectionMeta,
    };
  }
}

export default ProtocolEvent;
