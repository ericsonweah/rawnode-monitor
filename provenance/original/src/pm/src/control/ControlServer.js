'use strict';

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { chmod } from 'node:fs/promises';
import { CONTROL_PROTOCOL_VERSION, DEFAULTS } from '../constants.js';
import { controlResponse, controlEvent } from './ControlProtocol.js';
import { serializeError } from '../errors.js';
import { removeIfExists } from '../support/fs.js';
import { safeJsonLine } from '../support/json.js';

export class ControlServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.socketPath = options.socketPath;
    this.authenticator = options.authenticator;
    this.handler = options.handler;
    this.maxFrameBytes = Math.max(4_096, Number(options.maxFrameBytes) || DEFAULTS.controlMaxFrameBytes);
    this.maxSubscriberBytes = Math.max(64 * 1024, Number(options.maxSubscriberBytes) || 4 * 1024 * 1024);
    this.server = null;
    this._serverErrorHandler = (error) => {
      if (this.listenerCount('error') > 0) this.emit('error', error);
      else this.emit('serverError', error);
    };
    this.connections = new Set();
    this.subscribers = new Map();
  }

  async start() {
    if (this.server) return this;
    if (!this.socketPath) throw new Error('ControlServer requires socketPath.');
    if (process.platform !== 'win32') await removeIfExists(this.socketPath);
    this.server = net.createServer((socket) => this._onConnection(socket));
    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => { cleanup(); reject(error); };
        const onListening = () => { cleanup(); resolve(); };
        const cleanup = () => {
          this.server.off('error', onError);
          this.server.off('listening', onListening);
        };
        this.server.once('error', onError);
        this.server.once('listening', onListening);
        this.server.listen(this.socketPath);
      });
    } catch (error) {
      this.server?.close?.();
      this.server = null;
      if (process.platform !== 'win32') await removeIfExists(this.socketPath);
      throw error;
    }
    this.server.on('error', this._serverErrorHandler);
    if (process.platform !== 'win32') {
      try { await chmod(this.socketPath, 0o600); } catch {}
    }
    this.emit('listening', this.socketPath);
    return this;
  }

  _onConnection(socket) {
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 30_000);
    socket._rnBuffer = '';
    socket._rnAuthorized = false;
    this.connections.add(socket);
    socket.on('data', (chunk) => this._onData(socket, chunk));
    socket.on('error', (error) => this.emit('clientError', error));
    socket.on('close', () => {
      this.connections.delete(socket);
      this.subscribers.delete(socket);
    });
  }

  _onData(socket, chunk) {
    socket._rnBuffer += chunk.toString('utf8');
    if (Buffer.byteLength(socket._rnBuffer) > this.maxFrameBytes) {
      this._write(socket, controlResponse(null, null, { code: 'RNPM_FRAME_TOO_LARGE', message: 'Control frame exceeds limit.' }));
      socket.destroy();
      return;
    }
    let index;
    while ((index = socket._rnBuffer.indexOf('\n')) !== -1) {
      const line = socket._rnBuffer.slice(0, index);
      socket._rnBuffer = socket._rnBuffer.slice(index + 1);
      if (!line.trim()) continue;
      this._handleLine(socket, line).catch((error) => {
        this._write(socket, controlResponse(null, null, serializeError(error)));
      });
    }
  }

  async _handleLine(socket, line) {
    let request;
    try { request = JSON.parse(line); }
    catch {
      this._write(socket, controlResponse(null, null, { code: 'RNPM_BAD_JSON', message: 'Invalid JSON control frame.' }));
      return;
    }
    if (request.protocol !== CONTROL_PROTOCOL_VERSION) {
      this._write(socket, controlResponse(request, null, { code: 'RNPM_PROTOCOL_MISMATCH', message: `Expected protocol ${CONTROL_PROTOCOL_VERSION}.` }));
      return;
    }
    if (!this.authenticator?.verify?.(request.token)) {
      this._write(socket, controlResponse(request, null, { code: 'RNPM_UNAUTHORIZED', message: 'Invalid control token.', status: 401 }));
      socket.end();
      return;
    }
    socket._rnAuthorized = true;

    if (request.command === 'subscribe') {
      this.subscribers.set(socket, {
        events: new Set(Array.isArray(request.params?.events) ? request.params.events.map(String) : ['*']),
        app: request.params?.app || null,
      });
      this._write(socket, controlResponse(request, { subscribed: true }));
      return;
    }

    try {
      const result = await this.handler(request.command, request.params || {}, {
        requestId: request.id,
        socket,
      });
      this._write(socket, controlResponse(request, result));
    } catch (error) {
      this._write(socket, controlResponse(request, null, serializeError(error, { stack: false })));
    }
  }

  _write(socket, value) {
    if (!socket.writable || socket.destroyed) return false;
    if (socket.writableLength > this.maxSubscriberBytes) {
      socket.destroy(new Error('Slow control client exceeded buffer limit.'));
      return false;
    }
    return socket.write(safeJsonLine(value));
  }

  broadcast(event, payload = {}) {
    const packet = controlEvent(event, payload);
    for (const [socket, filter] of this.subscribers) {
      if (socket.destroyed) { this.subscribers.delete(socket); continue; }
      const acceptsEvent = filter.events.has('*') || filter.events.has(event);
      const acceptsApp = !filter.app || payload?.name === filter.app || payload?.record?.name === filter.app;
      if (acceptsEvent && acceptsApp) this._write(socket, packet);
    }
    this.emit('broadcast', event, payload);
  }

  async close() {
    for (const socket of this.connections) socket.destroy();
    this.connections.clear();
    this.subscribers.clear();
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise((resolve) => server.close(resolve));
    }
    if (process.platform !== 'win32') await removeIfExists(this.socketPath);
  }
}

export default ControlServer;
