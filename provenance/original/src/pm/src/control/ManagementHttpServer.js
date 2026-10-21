'use strict';

import http from 'node:http';
import { URL } from 'node:url';
import { serializeError } from '../errors.js';
import { safeStringify } from '../support/json.js';

function sendJson(res, status, value) {
  if (res.writableEnded || res.destroyed) return;
  const body = Buffer.from(safeStringify(value));
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('content-length', String(body.length));
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(body);
}

async function readJson(req, maxBytes) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) {
    const error = new Error('Management request body exceeds limit.');
    error.code = 'RNPM_BODY_TOO_LARGE';
    error.status = 413;
    throw error;
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      const error = new Error('Management request body exceeds limit.');
      error.code = 'RNPM_BODY_TOO_LARGE';
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!bytes) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (cause) {
    const error = new Error('Management request body must contain valid JSON.', { cause });
    error.code = 'RNPM_BODY_INVALID_JSON';
    error.status = 400;
    throw error;
  }
}

function publicHealthView(health) {
  return {
    ok: health.ok,
    ready: health.ready,
    uptimeMs: health.uptimeMs,
    groups: health.groups,
    activeProcesses: health.activeProcesses,
  };
}

export class ManagementHttpServer {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port == null ? null : Number(options.port);
    this._enabled = options.enabled ?? options.port != null;
    this.authenticator = options.authenticator;
    this.manager = options.manager;
    this.publicHealth = options.publicHealth !== false;
    this.publicMetrics = options.publicMetrics === true;
    this.maxBodyBytes = Math.max(4_096, Number(options.maxBodyBytes) || 1024 * 1024);
    this.maxSseBufferBytes = Math.max(64 * 1024, Number(options.maxSseBufferBytes) || 4 * 1024 * 1024);
    this.server = null;
    this.sse = new Set();
    this._eventHandler = (packet) => this._broadcast(packet);
  }

  enabled() {
    return this._enabled === true && Number.isInteger(this.port) && this.port >= 0 && this.port <= 65535;
  }

  authorized(req) {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    return this.authenticator?.verify?.(token) === true;
  }

  async start() {
    if (!this.enabled() || this.server) return this;
    this.server = http.createServer((req, res) => this._handle(req, res).catch((error) => {
      sendJson(res, error?.status || 500, { ok: false, error: serializeError(error) });
    }));
    this.server.requestTimeout = 15_000;
    this.server.headersTimeout = 10_000;
    this.server.keepAliveTimeout = 5_000;
    this.server.maxHeadersCount = 100;
    this.server.on('clientError', (_error, socket) => {
      if (!socket.writable) return socket.destroy();
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    });
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
        this.server.listen(this.port, this.host);
      });
    } catch (error) {
      this.server?.close?.();
      this.server = null;
      throw error;
    }
    this.manager?.realtime?.on?.('event', this._eventHandler);
    return this;
  }

  async _handle(req, res) {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${this.host}:${this.port}`}`);
    const method = String(req.method || 'GET').toUpperCase();
    const authenticated = this.authorized(req);

    if (method === 'GET' && url.pathname === '/health') {
      if (!this.publicHealth && !authenticated) return sendJson(res, 401, { error: 'management token required' });
      const health = this.manager.health();
      return sendJson(res, health.ok ? 200 : 503, authenticated ? health : publicHealthView(health));
    }
    if (method === 'GET' && url.pathname === '/ready') {
      if (!this.publicHealth && !authenticated) return sendJson(res, 401, { error: 'management token required' });
      const health = this.manager.health();
      return sendJson(res, health.ready ? 200 : 503, authenticated ? health : publicHealthView(health));
    }
    if (method === 'GET' && url.pathname === '/metrics') {
      if (!this.publicMetrics && !authenticated) return sendJson(res, 401, { error: 'management token required' });
      const result = await this.manager.handleCommand('prometheus', {}, { requestId: null, transport: 'http' });
      res.statusCode = 200;
      res.setHeader('content-type', result.contentType);
      res.setHeader('cache-control', 'no-store');
      res.setHeader('x-content-type-options', 'nosniff');
      res.end(result.body);
      return;
    }

    if (!authenticated) return sendJson(res, 401, { error: 'management token required' });

    if (method === 'GET' && url.pathname === '/v1/status') {
      const name = url.searchParams.get('name');
      return sendJson(res, 200, await this.manager.handleCommand('status', { name }, { transport: 'http' }));
    }
    if (method === 'GET' && url.pathname === '/v1/events') {
      return this._openSse(req, res, url);
    }
    if (method === 'POST' && url.pathname === '/v1/command') {
      const body = await readJson(req, this.maxBodyBytes);
      if (!body.command) {
        const error = new Error('command is required.');
        error.status = 400;
        throw error;
      }
      const result = await this.manager.handleCommand(body.command, body.params || {}, { requestId: body.id || null, transport: 'http' });
      return sendJson(res, 200, { ok: true, result });
    }

    return sendJson(res, 404, { error: 'not found' });
  }

  _openSse(req, res, url) {
    const client = {
      res,
      app: url.searchParams.get('app'),
      events: new Set((url.searchParams.get('events') || '*').split(',').map((value) => value.trim()).filter(Boolean)),
    };
    res.statusCode = 200;
    res.setHeader('content-type', 'text/event-stream; charset=utf-8');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('x-content-type-options', 'nosniff');
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${safeStringify({ pid: process.pid, at: Date.now() })}\n\n`);
    this.sse.add(client);
    const close = () => this.sse.delete(client);
    req.once('close', close);
    res.once('close', close);
  }

  _broadcast(packet) {
    for (const client of this.sse) {
      if (client.res.destroyed || client.res.writableEnded) {
        this.sse.delete(client);
        continue;
      }
      const acceptsEvent = client.events.has('*') || client.events.has(packet.event);
      const name = packet.payload?.name || packet.payload?.record?.name || null;
      const acceptsApp = !client.app || client.app === name;
      if (!acceptsEvent || !acceptsApp) continue;
      if (client.res.writableLength > this.maxSseBufferBytes) {
        client.res.destroy(new Error('Slow SSE client exceeded buffer limit.'));
        this.sse.delete(client);
        continue;
      }
      client.res.write(`event: ${packet.event}\ndata: ${safeStringify(packet)}\n\n`);
    }
  }

  address() {
    try { return this.server?.address?.() || null; } catch { return null; }
  }

  async close() {
    this.manager?.realtime?.off?.('event', this._eventHandler);
    for (const client of this.sse) client.res.destroy();
    this.sse.clear();
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
  }
}

export default ManagementHttpServer;
