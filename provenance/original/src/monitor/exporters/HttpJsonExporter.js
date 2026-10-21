'use strict';

import http from 'node:http';
import https from 'node:https';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { createHmac } from 'node:crypto';
import { bytesOf, retry } from '../support.js';

const gzipAsync = promisify(gzip);
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

export class HttpJsonExporter {
  constructor(options = {}) {
    if (!options.url) throw new TypeError('HttpJsonExporter requires url.');
    this.url = new URL(options.url);
    if (!SUPPORTED_PROTOCOLS.has(this.url.protocol)) throw new TypeError(`Unsupported Monitor HTTP exporter protocol '${this.url.protocol}'.`);
    if (this.url.username || this.url.password) throw new TypeError('Monitor HTTP exporter URLs must not contain embedded credentials. Use headers or signing instead.');
    this.timeoutMs = Math.max(100, Number(options.timeoutMs) || 10_000);
    this.compression = options.compression !== false;
    this.compressionThresholdBytes = Math.max(256, Number(options.compressionThresholdBytes) || 1_024);
    this.maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
    this.retryBaseMs = Math.max(0, Number(options.retryBaseMs) || 100);
    this.retryMaxMs = Math.max(this.retryBaseMs, Number(options.retryMaxMs) || 5_000);
    this.maxPayloadBytes = Math.max(1_024, Number(options.maxPayloadBytes) || 8 * 1024 * 1024);
    this.maxResponseBytes = Math.max(1_024, Number(options.maxResponseBytes) || 64 * 1024);
    this.maxBatchSignals = Math.max(1, Number(options.maxBatchSignals) || 256);
    this.rejectUnauthorized = options.rejectUnauthorized !== false;
    this.headers = Object.freeze({ 'content-type': 'application/json', 'user-agent': 'rawnode-monitor/1.0', ...(options.headers || {}) });
    this.secret = options.secret || null;
    this.format = options.format || ((signals) => ({ schemaVersion: 1, sentAt: Date.now(), signals }));
    this.agent = this.url.protocol === 'https:'
      ? new https.Agent({ keepAlive: true, maxSockets: Number(options.maxSockets) || 16, maxFreeSockets: Number(options.maxFreeSockets) || 8, rejectUnauthorized: this.rejectUnauthorized })
      : new http.Agent({ keepAlive: true, maxSockets: Number(options.maxSockets) || 16, maxFreeSockets: Number(options.maxFreeSockets) || 8 });
    this.closed = false;
    this.stats = {
      batches: 0,
      signals: 0,
      bytes: 0,
      uncompressedBytes: 0,
      splitBatches: 0,
      oversizedSignals: 0,
      errors: 0,
      retries: 0,
      responses: Object.create(null),
    };
  }

  async export(signals = [], options = {}) {
    if (this.closed) return false;
    if (!Array.isArray(signals) || !signals.length) return true;
    const chunks = partitionSignals(signals, this.maxBatchSignals, this.maxPayloadBytes);
    if (chunks.length > 1) this.stats.splitBatches += chunks.length - 1;
    for (const chunk of chunks) await this._exportChunk(chunk, options);
    return true;
  }

  async _exportChunk(signals, options) {
    let body;
    try { body = Buffer.from(JSON.stringify(this.format(signals, options))); }
    catch (cause) {
      const error = Object.assign(new Error('Monitor HTTP exporter could not serialize a telemetry batch.'), { code: 'MONITOR_EXPORT_SERIALIZATION_FAILED', retryable: false, cause });
      this.stats.errors++;
      throw error;
    }

    if (body.length > this.maxPayloadBytes) {
      if (signals.length > 1) {
        const middle = Math.ceil(signals.length / 2);
        this.stats.splitBatches++;
        await this._exportChunk(signals.slice(0, middle), options);
        await this._exportChunk(signals.slice(middle), options);
        return;
      }
      this.stats.oversizedSignals++;
      this.stats.errors++;
      throw Object.assign(new Error(`Monitor HTTP export signal exceeds ${this.maxPayloadBytes} bytes after formatting.`), {
        code: 'MONITOR_EXPORT_PAYLOAD_TOO_LARGE',
        retryable: false,
        bytes: body.length,
        maxPayloadBytes: this.maxPayloadBytes,
      });
    }

    const payload = this.compression && body.length >= this.compressionThresholdBytes ? await gzipAsync(body) : body;
    const headers = { ...this.headers, 'content-length': String(payload.length) };
    if (payload !== body) headers['content-encoding'] = 'gzip';
    if (this.secret) {
      const timestamp = String(Date.now());
      headers['x-rawnode-monitor-timestamp'] = timestamp;
      headers['x-rawnode-monitor-signature'] = `sha256=${createHmac('sha256', this.secret).update(timestamp).update('.').update(payload).digest('hex')}`;
    }

    try {
      await retry(async (attempt) => {
        if (attempt > 1) this.stats.retries++;
        const response = await this._request(payload, headers, options.signal);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw Object.assign(new Error(`Monitor exporter received HTTP ${response.statusCode}.`), {
            statusCode: response.statusCode,
            retryable: response.statusCode >= 500 || response.statusCode === 429,
          });
        }
        return response;
      }, {
        attempts: this.maxAttempts,
        baseMs: this.retryBaseMs,
        maxMs: this.retryMaxMs,
        signal: options.signal,
        retryWhen: (error) => error?.retryable !== false,
      });
    } catch (error) {
      this.stats.errors++;
      throw error;
    }

    this.stats.batches++;
    this.stats.signals += signals.length;
    this.stats.bytes += payload.length;
    this.stats.uncompressedBytes += body.length;
  }

  _request(payload, headers, signal) {
    const transport = this.url.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
      let settled = false;
      let abortHandler = null;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        if (abortHandler) signal?.removeEventListener?.('abort', abortHandler);
        if (error) reject(error);
        else resolve(value);
      };
      const request = transport.request({
        protocol: this.url.protocol,
        hostname: this.url.hostname,
        port: this.url.port || undefined,
        path: `${this.url.pathname}${this.url.search}`,
        method: 'POST',
        headers,
        agent: this.agent,
        rejectUnauthorized: this.rejectUnauthorized,
      }, (response) => {
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > this.maxResponseBytes) {
            const error = Object.assign(new Error(`Monitor exporter response exceeds ${this.maxResponseBytes} bytes.`), {
              code: 'MONITOR_EXPORT_RESPONSE_TOO_LARGE',
              retryable: false,
            });
            finish(error);
            response.destroy(error);
          }
        });
        response.once('aborted', () => finish(Object.assign(new Error('Monitor exporter response was aborted.'), { code: 'MONITOR_EXPORT_RESPONSE_ABORTED', retryable: true })));
        response.once('error', (error) => finish(error));
        response.once('end', () => {
          const statusCode = Number(response.statusCode || 0);
          this.stats.responses[statusCode] = (this.stats.responses[statusCode] || 0) + 1;
          finish(null, { statusCode, bytes });
        });
      });
      request.setTimeout(this.timeoutMs, () => request.destroy(Object.assign(new Error(`Monitor HTTP export exceeded ${this.timeoutMs}ms.`), { code: 'MONITOR_EXPORT_TIMEOUT', retryable: true })));
      request.once('error', (error) => finish(error));
      if (signal) {
        abortHandler = () => {
          const error = signal.reason instanceof Error
            ? signal.reason
            : Object.assign(new Error('Monitor export aborted.'), { code: 'ABORT_ERR' });
          request.destroy(error);
          finish(error);
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener('abort', abortHandler, { once: true });
      }
      if (!settled) request.end(payload);
    });
  }

  async flush() {}
  async close() { this.closed = true; this.agent.destroy(); }
  snapshot() {
    return Object.freeze({
      url: `${this.url.origin}${this.url.pathname}`,
      closed: this.closed,
      compression: this.compression,
      maxPayloadBytes: this.maxPayloadBytes,
      maxResponseBytes: this.maxResponseBytes,
      maxBatchSignals: this.maxBatchSignals,
      stats: Object.freeze({ ...this.stats, responses: Object.freeze({ ...this.stats.responses }) }),
    });
  }
}

function partitionSignals(signals, maxSignals, maxBytes) {
  const output = [];
  let batch = [];
  let estimated = 128;
  for (const signal of signals) {
    const size = bytesOf(signal, maxBytes + 1) + 1;
    if (size > maxBytes) {
      if (batch.length) { output.push(batch); batch = []; estimated = 128; }
      output.push([signal]);
      continue;
    }
    if (batch.length && (batch.length >= maxSignals || estimated + size > Math.floor(maxBytes * 0.9))) {
      output.push(batch);
      batch = [];
      estimated = 128;
    }
    batch.push(signal);
    estimated += size;
  }
  if (batch.length) output.push(batch);
  return output;
}

export default HttpJsonExporter;
