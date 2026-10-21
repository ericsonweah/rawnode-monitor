'use strict';

import dgram from 'node:dgram';
import { sanitizeMetricName } from '../support.js';

export class StatsdExporter {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = Math.max(1, Number(options.port) || 8125);
    this.prefix = sanitizeMetricName(options.prefix || 'rawnode').replace(/[:]/g, '.');
    this.maxPacketBytes = Math.max(512, Number(options.maxPacketBytes) || 8_192);
    this.socket = dgram.createSocket(options.type || 'udp4');
    this.closed = false;
    this.stats = { packets: 0, lines: 0, bytes: 0, errors: 0 };
    this.socket.on('error', () => { this.stats.errors++; });
    this.socket.unref?.();
  }

  async export(signals) {
    if (this.closed) return false;
    const lines = [];
    for (const signal of signals) if (signal.kind === 'metrics') lines.push(...metricsToStatsd(signal.payload || signal, this.prefix));
    if (!lines.length) return true;
    let packet = '';
    for (const line of lines) {
      if (Buffer.byteLength(packet ? `${packet}\n${line}` : line) > this.maxPacketBytes && packet) { await this._send(packet); packet = line; }
      else packet = packet ? `${packet}\n${line}` : line;
    }
    if (packet) await this._send(packet);
    this.stats.lines += lines.length;
    return true;
  }

  _send(text) {
    const buffer = Buffer.from(text);
    return new Promise((resolve, reject) => this.socket.send(buffer, this.port, this.host, (error) => {
      if (error) { this.stats.errors++; reject(error); }
      else { this.stats.packets++; this.stats.bytes += buffer.length; resolve(true); }
    }));
  }
  async close() { if (this.closed) return; this.closed = true; await new Promise((resolve) => { try { this.socket.close(resolve); } catch { resolve(); } }); }
  snapshot() { return Object.freeze({ host: this.host, port: this.port, prefix: this.prefix, closed: this.closed, stats: Object.freeze({ ...this.stats }) }); }
}
function metricsToStatsd(snapshot, prefix) {
  const lines = [];
  for (const metric of Object.values(snapshot?.metrics || {})) for (const series of metric.series || []) {
    const name = `${prefix}.${sanitizeMetricName(metric.name).replace(/[:]/g, '.')}`;
    const tags = Object.entries(series.labels || {}).map(([key, value]) => `${key}:${String(value).replace(/[|,@]/g, '_')}`).join(',');
    const suffix = tags ? `|#${tags}` : '';
    if (metric.type === 'counter') lines.push(`${name}:${series.value}|c${suffix}`);
    else if (metric.type === 'histogram' || metric.type === 'timer') lines.push(`${name}:${series.mean || 0}|h${suffix}`);
    else lines.push(`${name}:${series.value}|g${suffix}`);
  }
  return lines;
}
export default StatsdExporter;
