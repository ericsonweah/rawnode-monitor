'use strict';

import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { controlRequest } from './ControlProtocol.js';
import { withTimeout } from '../support/async.js';
import { ControlError } from '../errors.js';

export class ControlClient {
  constructor(options = {}) {
    this.socketPath = options.socketPath;
    this.tokenPath = options.tokenPath;
    this.token = options.token || null;
    this.timeoutMs = Math.max(250, Number(options.timeoutMs) || 10_000);
    this.maxFrameBytes = Math.max(4_096, Number(options.maxFrameBytes) || 1024 * 1024);
  }

  async initialize() {
    if (!this.token) this.token = (await readFile(this.tokenPath, 'utf8')).trim();
    return this;
  }

  async request(command, params = {}, options = {}) {
    await this.initialize();
    const request = controlRequest(command, params, this.token);
    let socket = null;
    const task = new Promise((resolve, reject) => {
      socket = net.connect(this.socketPath);
      let buffer = '';
      const cleanup = () => socket?.destroy();
      socket.setNoDelay(true);
      socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        if (Buffer.byteLength(buffer) > this.maxFrameBytes) {
          cleanup();
          reject(new ControlError('Control response exceeds frame limit.', { code: 'RNPM_FRAME_TOO_LARGE' }));
          return;
        }
        const index = buffer.indexOf('\n');
        if (index === -1) return;
        const line = buffer.slice(0, index);
        cleanup();
        try {
          const response = JSON.parse(line);
          if (!response.ok) {
            reject(new ControlError(response.error?.message || 'Control request failed.', {
              code: response.error?.code || 'RNPM_CONTROL_REQUEST_FAILED',
              status: response.error?.status || 500,
              details: response.error?.details || null,
            }));
          } else resolve(response.result);
        } catch (error) { reject(error); }
      });
      socket.once('error', reject);
    });
    try {
      return await withTimeout(task, options.timeoutMs || this.timeoutMs, { message: `Control command '${command}' timed out.` });
    } finally {
      socket?.destroy();
    }
  }

  async subscribe(options = {}, onEvent = () => {}) {
    await this.initialize();
    const request = controlRequest('subscribe', options, this.token);
    const socket = net.connect(this.socketPath);
    let buffer = '';
    let acknowledged = false;
    const ready = new Promise((resolve, reject) => {
      socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
      socket.once('error', reject);
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        if (Buffer.byteLength(buffer) > this.maxFrameBytes) {
          socket.destroy();
          reject(new ControlError('Control event frame exceeds limit.', { code: 'RNPM_FRAME_TOO_LARGE' }));
          return;
        }
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          let packet;
          try { packet = JSON.parse(line); } catch { continue; }
          if (!acknowledged && packet.id === request.id) {
            if (!packet.ok) return reject(new ControlError(packet.error?.message || 'Subscription failed.', { code: packet.error?.code }));
            acknowledged = true;
            resolve();
            continue;
          }
          if (packet.stream === 'events') {
            try { onEvent(packet); }
            catch (error) {
              if (typeof options.onError === 'function') options.onError(error, packet);
              else socket.destroy(error);
            }
          }
        }
      });
    });
    try {
      await withTimeout(ready, this.timeoutMs, { message: 'Control subscription timed out.' });
      return () => socket.destroy();
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }
}

export default ControlClient;
