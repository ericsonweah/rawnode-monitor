'use strict';

import { timingSafeEqual } from 'node:crypto';
import { MonitorSecurityError } from '../errors.js';

export class MonitorStudioAuthorizer {
  constructor(options = {}) {
    this.token = options.token || null;
    this.localOnly = options.localOnly !== false;
    this.authorize = options.authorize || null;
    this.allowedOrigins = new Set(options.allowedOrigins || []);
    this.trustProxy = options.trustProxy === true;
    this.requireCsrf = options.requireCsrf !== false;
  }

  async check(req, options = {}) {
    const address = clientAddress(req, this.trustProxy);
    const host = String(req.headers?.host || '');
    if (this.localOnly && host && !/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host)) return denied('MONITOR_STUDIO_HOST', 403, 'Monitor Studio requires a loopback Host.');
    if (this.localOnly && !isLoopback(address)) return denied('MONITOR_STUDIO_LOCAL_ONLY', 403, 'Monitor Studio is restricted to local connections.');
    if (options.mutate && this.requireCsrf && !sameOrigin(req, this.allowedOrigins)) return denied('MONITOR_STUDIO_CSRF', 403, 'Monitor Studio request failed origin validation.');
    if (!sameOrigin(req, this.allowedOrigins)) return denied('MONITOR_STUDIO_ORIGIN', 403, 'Monitor Studio request failed origin validation.');
    if (this.authorize) {
      const result = await this.authorize(req, options);
      if (result === true || result?.ok === true) return { ok: true, actor: result?.actor || req.user || null, method: 'custom' };
      return denied('MONITOR_STUDIO_FORBIDDEN', 403, 'Monitor Studio access is forbidden.');
    }
    if (this.token) {
      const presented = extractToken(req);
      if (!presented || !safeEqual(presented, this.token)) return denied('MONITOR_STUDIO_UNAUTHORIZED', 401, 'Monitor Studio authorization is required.');
    } else if (!this.localOnly) return denied('MONITOR_STUDIO_UNCONFIGURED', 503, 'Monitor Studio authorization is not configured.');
    if (options.mutate && this.requireCsrf && !sameOrigin(req, this.allowedOrigins)) return denied('MONITOR_STUDIO_CSRF', 403, 'Monitor Studio request failed origin validation.');
    return { ok: true, actor: req.user || req.auth?.payload || null, method: this.token ? 'token' : 'local' };
  }

  async assert(req, options = {}) { const result = await this.check(req, options); if (!result.ok) throw new MonitorSecurityError(result.message, { code: result.code, status: result.status }); return result; }
}
function denied(code, status, message) { return { ok: false, code, status, message }; }
function extractToken(req) { const authorization = req.headers?.authorization || req.headers?.Authorization || ''; const bearer = /^Bearer\s+(.+)$/i.exec(String(authorization))?.[1]; return bearer || req.headers?.['x-rawnode-monitor-token'] || req.headers?.['x-monitor-token'] || null; }
function safeEqual(left, right) { const a = Buffer.from(String(left)); const b = Buffer.from(String(right)); return a.length === b.length && timingSafeEqual(a, b); }
function clientAddress(req, trustProxy) { if (trustProxy) return String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || ''; return req.socket?.remoteAddress || req.raw?.socket?.remoteAddress || ''; }
function isLoopback(value) { const address = String(value || '').replace(/^::ffff:/, ''); return address === '127.0.0.1' || address === '::1' || address === 'localhost' || address.startsWith('127.'); }
function sameOrigin(req, allowedOrigins) {
  const fetchSite = String(req.headers?.['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;
  const origin = req.headers?.origin;
  if (!origin) return !fetchSite || ['same-origin', 'none'].includes(fetchSite);
  if (allowedOrigins.has(origin)) return true;
  const host = req.headers?.host;
  try { const parsed = new URL(origin); return parsed.host === host; }
  catch { return false; }
}
export default MonitorStudioAuthorizer;
