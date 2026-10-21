'use strict';

import dgram from 'node:dgram';
import BaseTransport from './BaseTransport.js';

export class UdpTransport extends BaseTransport {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'udp' });
    if (options.serializer) this.serializer = options.serializer;
    this.host = options.host || '127.0.0.1';
    this.port = Number(options.port);
    if (!Number.isInteger(this.port) || this.port <= 0) throw new TypeError('UdpTransport requires a valid port.');
    this.type = options.type || 'udp4';
    this.maxPacketBytes = Math.max(256, Number(options.maxPacketBytes) || 8192);
    this.oversize = options.oversize || 'truncate';
    this.socket = dgram.createSocket(this.type);
    this.socket.unref?.();
    this.socket.on('error', (error) => this._failed(error));
  }

  async writeRecord(record) {
    if (this.closed || this.silent) return;
    let payload = Buffer.from(this.serializer.stringify(record));
    if (payload.length > this.maxPacketBytes) {
      if (this.oversize === 'drop') {
        this.emit('drop', { reason: 'oversize', bytes: payload.length, record });
        return { dropped: true };
      }
      payload = Buffer.from(this.serializer.stringify({
        id: record.id,
        timestamp: record.timestamp,
        level: record.level,
        message: String(record.message).slice(0, Math.max(0, this.maxPacketBytes - 256)),
        truncated: true,
        originalBytes: payload.length,
      }));
      if (payload.length > this.maxPacketBytes) payload = payload.subarray(0, this.maxPacketBytes);
    }
    await new Promise((resolve, reject) => this.socket.send(payload, this.port, this.host, (error) => error ? reject(error) : resolve()));
    this._written(payload.length);
    this.emit('written', record);
  }

  async close() {
    if (this.closed) return;
    await new Promise((resolve) => { try { this.socket.close(resolve); } catch { resolve(); } });
    await super.close();
  }
}

export default UdpTransport;
