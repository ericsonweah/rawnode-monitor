'use strict';

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import BaseTransport from './BaseTransport.js';

export class HttpBatchTransport extends BaseTransport {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'http-batch' });
    if (options.serializer) this.serializer = options.serializer;
    this.url = new URL(options.url || options.endpoint);
    this.headers = { 'content-type': 'application/json', ...(options.headers || {}) };
    this.timeoutMs = Math.max(1, Number(options.timeoutMs) || 10_000);
    this.batchSize = Math.max(1, Number(options.batchSize) || 100);
    this.batchIntervalMs = Math.max(0, Number(options.batchIntervalMs ?? options.flushIntervalMs) || 10);
    this.maxRetries = Math.max(0, Number(options.maxRetries) || 2);
    this.retryDelayMs = Math.max(0, Number(options.retryDelayMs) || 250);
  }

  async writeRecord(record) {
    return await this.writeBatch([record]);
  }

  async writeBatch(records) {
    if (this.closed || this.silent || !records.length) return;
    const payload = this.serializer.stringify({ records });
    let attempt = 0;
    while (true) {
      try {
        const response = await this._request(payload);
        this._written(Buffer.byteLength(payload));
        this.emit('written', { records: records.length, response });
        return response;
      } catch (error) {
        if (attempt++ >= this.maxRetries) throw error;
        if (this.retryDelayMs) await new Promise((resolve) => { const timer = setTimeout(resolve, this.retryDelayMs * attempt); });
      }
    }
  }

  _request(payload) {
    const client = this.url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      const request = client.request(this.url, {
        method: 'POST',
        headers: { ...this.headers, 'content-length': Buffer.byteLength(payload) },
      }, (response) => {
        const chunks = [];
        let bytes = 0;
        response.on('data', (chunk) => { if (bytes < 64 * 1024) chunks.push(chunk); bytes += chunk.length; });
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (response.statusCode >= 200 && response.statusCode < 300) resolve({ statusCode: response.statusCode, body });
          else reject(new Error(`HTTP log collector returned ${response.statusCode}: ${body.slice(0, 1000)}`));
        });
      });
      request.setTimeout(this.timeoutMs, () => request.destroy(new Error(`HTTP log request timed out after ${this.timeoutMs}ms.`)));
      request.on('error', reject);
      request.end(payload);
    });
  }
}

export default HttpBatchTransport;
