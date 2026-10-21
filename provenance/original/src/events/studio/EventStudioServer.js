'use strict';

import { createServer } from 'node:http';
import { timingSafeEqual, randomBytes } from 'node:crypto';
import { URL } from 'node:url';

export class EventStudioServer {
  constructor(options = {}) {
    if (!options.studio) throw new TypeError('EventStudioServer requires a studio manager.');
    this.studio = options.studio;
    this.host = options.host || '127.0.0.1';
    this.port = Number(options.port) || 0;
    this.token = String(options.token || randomBytes(32).toString('base64url'));
    this.maxBodyBytes = Math.max(1_024, Number(options.maxBodyBytes) || 256 * 1024);
    this.server = null;
  }
  async start(options = {}) {
    if (this.server) return this.address();
    if (!['127.0.0.1', '::1', 'localhost'].includes(this.host) && options.allowRemote !== true) throw Object.assign(new Error('Remote Event Studio binding is disabled.'), { code: 'EVENT_STUDIO_REMOTE_DISABLED' });
    options.assertTransportStartAllowed?.();
    this.server = createServer((request, response) => void this.handle(request, response));
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.port, this.host, resolve); });
    options.signal?.addEventListener?.('abort', () => void this.close(), { once: true });
    return this.address();
  }
  async handle(request, response) {
    if (!authorized(request, this.token)) return send(response, 401, { ok: false, error: 'unauthorized' });
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    try {
      if (request.method === 'GET' && url.pathname === '/api/events/snapshot') return send(response, 200, this.studio.snapshot());
      if (request.method === 'GET' && url.pathname === '/api/events/timeline') return send(response, 200, this.studio.timeline({ eventName: url.searchParams.get('event') || undefined, correlationId: url.searchParams.get('correlation') || undefined, limit: Number(url.searchParams.get('limit')) || undefined }));
      if (request.method === 'GET' && url.pathname === '/api/events/inspect') return send(response, 200, this.studio.inspectEvent(url.searchParams.get('event') || ''));
      if (request.method === 'POST' && url.pathname === '/api/events/operate') {
        const body = await readJson(request, this.maxBodyBytes);
        return send(response, 200, await this.studio.operate(body.action, body.input || {}, { actorId: request.headers['x-rawnode-actor'] || null, tenantId: request.headers['x-rawnode-tenant'] || null }));
      }
      return send(response, 404, { ok: false, error: 'not-found' });
    } catch (error) {
      return send(response, Number(error.status) || 500, { ok: false, error: { code: error.code || 'EVENT_STUDIO_ERROR', message: error.message || String(error) } });
    }
  }
  address() { const value = this.server?.address(); const host = typeof value === 'object' && value ? value.address : this.host; const port = typeof value === 'object' && value ? value.port : this.port; return Object.freeze({ host, port, token: this.token, url: `http://${String(host).includes(':') ? `[${host}]` : host}:${port}/api/events/snapshot` }); }
  async close() { if (!this.server) return; const server = this.server; this.server = null; await new Promise((resolve) => server.close(resolve)); }
}
function authorized(request, expected) { const header = String(request.headers.authorization || ''); const supplied = header.startsWith('Bearer ') ? header.slice(7) : ''; if (!supplied || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)) return false; return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)); }
async function readJson(request, maxBytes) { const chunks = []; let bytes = 0; for await (const chunk of request) { bytes += chunk.length; if (bytes > maxBytes) throw Object.assign(new Error('Event Studio request body is too large.'), { code: 'EVENT_STUDIO_BODY_TOO_LARGE', status: 413 }); chunks.push(chunk); } return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; }
function send(response, status, payload) { const body = Buffer.from(JSON.stringify(payload)); response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }); response.end(body); }
export default EventStudioServer;
