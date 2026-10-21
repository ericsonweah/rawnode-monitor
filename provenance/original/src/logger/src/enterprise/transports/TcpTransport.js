'use strict';

import net from 'node:net';
import tls from 'node:tls';
import BaseTransport from './BaseTransport.js';

export class TcpTransport extends BaseTransport {
  constructor(options = {}) {
    super({ ...options, name: options.name || (options.tls ? 'tls' : 'tcp') });
    if (options.serializer) this.serializer = options.serializer;
    this.host = options.host || '127.0.0.1';
    this.port = Number(options.port);
    if (!Number.isInteger(this.port) || this.port <= 0) throw new TypeError('TcpTransport requires a valid port.');
    this.tls = options.tls === true || options.secure === true;
    this.tlsOptions = { ...(options.tlsOptions || {}) };
    this.connectTimeoutMs = Math.max(1, Number(options.connectTimeoutMs) || 5000);
    this.reconnectDelayMs = Math.max(0, Number(options.reconnectDelayMs) || 250);
    this.socket = null;
    this._connecting = null;
  }

  async connect() {
    if (this.closed) throw new Error(`TCP transport [${this.name}] is closed.`);
    if (this.socket && !this.socket.destroyed && this.socket.writable) return this.socket;
    if (this._connecting) return await this._connecting;
    this._connecting = new Promise((resolve, reject) => {
      const options = { host: this.host, port: this.port, ...this.tlsOptions };
      const socket = this.tls ? tls.connect(options) : net.createConnection(options);
      const timer = setTimeout(() => socket.destroy(new Error(`TCP logger connection timed out after ${this.connectTimeoutMs}ms.`)), this.connectTimeoutMs);
     
      const connectedEvent = this.tls ? 'secureConnect' : 'connect';
      const onError = (error) => { clearTimeout(timer); reject(error); };
      socket.once('error', onError);
      socket.once(connectedEvent, () => {
        clearTimeout(timer);
        socket.off('error', onError);
        socket.setNoDelay(true);
        socket.setKeepAlive(true);
        socket.on('error', (error) => this._failed(error));
        socket.on('close', () => { if (this.socket === socket) this.socket = null; });
        this.socket = socket;
        this.emit('connect', { host: this.host, port: this.port, tls: this.tls });
        resolve(socket);
      });
    }).finally(() => { this._connecting = null; });
    return await this._connecting;
  }

  async writeRecord(record) {
    if (this.closed || this.silent) return;
    let socket;
    try { socket = await this.connect(); }
    catch (error) {
      if (this.reconnectDelayMs) await new Promise((resolve) => { const timer = setTimeout(resolve, this.reconnectDelayMs); });
      throw error;
    }
    const payload = `${this.serializer.stringify(record)}\n`;
    await new Promise((resolve, reject) => {
      let callbackDone = false;
      let drainDone = true;
      let settled = false;
      const cleanup = () => socket.off('error', onError);
      const finish = (error) => {
        if (settled) return;
        if (error) { settled = true; cleanup(); reject(error); return; }
        if (callbackDone && drainDone) { settled = true; cleanup(); resolve(); }
      };
      const onError = (error) => finish(error);
      socket.once('error', onError);
      try {
        const accepted = socket.write(payload, (error) => { callbackDone = true; finish(error); });
        if (!accepted) {
          drainDone = false;
          socket.once('drain', () => { drainDone = true; finish(); });
        }
      } catch (error) { finish(error); }
    });
    this._written(Buffer.byteLength(payload));
    this.emit('written', record);
  }

  async close() {
    if (this.closed) return;
    const socket = this.socket;
    this.socket = null;
    if (socket && !socket.destroyed) await new Promise((resolve) => { socket.end(resolve); socket.once('close', resolve); });
    await super.close();
  }

  health() {
    return { ...super.health(), host: this.host, port: this.port, connected: Boolean(this.socket && !this.socket.destroyed), tls: this.tls };
  }
}

export default TcpTransport;
