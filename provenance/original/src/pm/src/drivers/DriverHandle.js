'use strict';

import { EventEmitter } from 'node:events';

export class DriverHandle extends EventEmitter {
  constructor(options = {}) {
    super();
    this.kind = options.kind || 'unknown';
    this.child = options.child || null;
    this.worker = options.worker || null;
    this.pid = options.pid || this.child?.pid || this.worker?.process?.pid || null;
    this.stdout = options.stdout || this.child?.stdout || this.worker?.process?.stdout || null;
    this.stderr = options.stderr || this.child?.stderr || this.worker?.process?.stderr || null;
    this.connected = options.connected !== false;
    this._send = options.send || null;
    this._kill = options.kill || null;
    this._disconnect = options.disconnect || null;
  }

  async send(message) {
    if (!this._send) return false;
    return this._send(message);
  }

  kill(signal = 'SIGTERM') {
    if (this._kill) return this._kill(signal);
    return false;
  }

  disconnect() {
    this.connected = false;
    if (this._disconnect) return this._disconnect();
    return false;
  }
}

export default DriverHandle;
