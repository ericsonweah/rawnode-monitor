'use strict';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { MonitorSecurityError } from '../errors.js';

export class TelemetryAuthenticator {
  constructor(options = {}) {
    this.secret = options.secret || null;
    this.header = String(options.header || 'x-rawnode-monitor-signature').toLowerCase();
    this.timestampHeader = String(options.timestampHeader || 'x-rawnode-monitor-timestamp').toLowerCase();
    this.maxSkewMs = Math.max(1_000, Number(options.maxSkewMs) || 5 * 60_000);
    this.algorithm = 'sha256';
  }

  sign(body, timestamp = Date.now()) {
    if (!this.secret) throw new MonitorSecurityError('Monitor ingestion secret is not configured.', { code: 'MONITOR_INGEST_SECRET_MISSING' });
    const text = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const signature = createHmac(this.algorithm, this.secret).update(String(timestamp)).update('.').update(text).digest('hex');
    return { timestamp: String(timestamp), signature: `sha256=${signature}` };
  }

  verify(body, headers = {}, now = Date.now()) {
    if (!this.secret) return false;
    const timestamp = Number(headers[this.timestampHeader] ?? headers[this.timestampHeader.toUpperCase()]);
    const presented = String(headers[this.header] ?? headers[this.header.toUpperCase()] ?? '');
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > this.maxSkewMs || !presented.startsWith('sha256=')) return false;
    const expected = this.sign(body, timestamp).signature;
    const left = Buffer.from(expected);
    const right = Buffer.from(presented);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  assert(body, headers = {}) {
    if (!this.verify(body, headers)) throw new MonitorSecurityError('Monitor ingestion signature is invalid or expired.', { code: 'MONITOR_INGEST_SIGNATURE_INVALID', status: 401 });
    return true;
  }
}

export default TelemetryAuthenticator;
