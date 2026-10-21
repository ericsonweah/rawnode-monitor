'use strict';

import http from 'node:http';
import crypto from 'node:crypto';
import { URL } from 'node:url';

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function frame(payload) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  let header;
  if (data.length < 126) {
    header = Buffer.allocUnsafe(2);
    header[1] = data.length;
  } else if (data.length <= 0xffff) {
    header = Buffer.allocUnsafe(4);
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  header[0] = 0x81;
  return Buffer.concat([header, data]);
}

function authorized(req, options) {
  if (!options.token) return true;
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const supplied = url.searchParams.get('token') || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!supplied) return false;
    const left = Buffer.from(String(supplied));
    const right = Buffer.from(String(options.token));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch { return false; }
}

function originAllowed(req, origins) {
  if (!origins || origins === '*') return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  return origins.includes(origin);
}

export class InspectorServer {
  constructor(transport, portOrOptions = 9988) {
    if (!transport) throw new TypeError('InspectorServer requires an InspectorTransport.');
    const options = typeof portOrOptions === 'number' ? { port: portOrOptions } : (portOrOptions || {});
    this.transport = transport;
    this.options = {
      host: options.host || '127.0.0.1',
      port: Number.isInteger(Number(options.port)) && Number(options.port) >= 0 ? Number(options.port) : 9988,
      path: options.path || '/',
      token: options.token || null,
      origins: options.origins === '*' ? '*' : (Array.isArray(options.origins) ? options.origins : null),
      maxClientBufferBytes: Math.max(1024, Number(options.maxClientBufferBytes) || 4 * 1024 * 1024),
      maxClients: Math.max(1, Number(options.maxClients) || 100),
    };
    this.clients = new Set();
    this.server = http.createServer((req, res) => {
      res.statusCode = 404;
      res.end('RawNode Logger Inspector');
    });
    this._onRecord = (entry) => this.broadcast(entry);
    this.transport.on(this.transport.channel, this._onRecord);
    this.server.on('upgrade', (req, socket) => this._upgrade(req, socket));
  }

  _upgrade(req, socket) {
    let pathname = '/';
    try { pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname; } catch {}
    if (pathname !== this.options.path) return this._reject(socket, 404, 'Not Found');
    if (this.clients.size >= this.options.maxClients) return this._reject(socket, 429, 'Too Many Requests');
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') return this._reject(socket, 400, 'Bad Request');
    if (!authorized(req, this.options)) return this._reject(socket, 401, 'Unauthorized');
    if (!originAllowed(req, this.options.origins)) return this._reject(socket, 403, 'Forbidden');
    const key = req.headers['sec-websocket-key'];
    if (!key) return this._reject(socket, 400, 'Bad Request');
    const accept = crypto.createHash('sha1').update(`${key}${MAGIC}`).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ].join('\r\n'));
    socket.setNoDelay(true);
    socket._rawnodeInspectorQueuedBytes = 0;
    this.clients.add(socket);
    const cleanup = () => this.clients.delete(socket);
    socket.on('close', cleanup);
    socket.on('error', cleanup);
    socket.on('data', (chunk) => {
      if ((chunk[0] & 0x0f) === 0x8) socket.end();
      if ((chunk[0] & 0x0f) === 0x9) {
        try { socket.write(Buffer.from([0x8a, 0x00])); } catch {}
      }
    });
    const history = this.transport.getBufferedLogs({ limit: 100 });
    for (const record of history) this._send(socket, { type: 'history', record });
  }

  _reject(socket, status, reason) {
    try { socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`); } catch {}
  }

  _send(socket, value) {
    if (socket.destroyed || !socket.writable) return false;
    const output = frame(JSON.stringify(value));
    const queued = socket.writableLength + output.length;
    if (queued > this.options.maxClientBufferBytes) {
      socket.destroy(new Error('Inspector client exceeded backpressure limit.'));
      return false;
    }
    return socket.write(output);
  }

  broadcast(entry) {
    for (const client of this.clients) this._send(client, { type: 'record', record: entry });
  }

  buildFrame(payload) { return frame(payload); }

  async start() {
    if (this.server.listening) return this.address();
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.port, this.options.host, resolve);
    });
    return this.address();
  }

  address() { return this.server.address(); }

  async close() {
    this.transport.off?.(this.transport.channel, this._onRecord);
    for (const client of this.clients) client.destroy();
    this.clients.clear();
    if (this.server.listening) await new Promise((resolve) => this.server.close(resolve));
  }
}

export default InspectorServer;
