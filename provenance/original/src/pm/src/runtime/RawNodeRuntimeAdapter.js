'use strict';

import { EventEmitter } from 'node:events';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { withTimeout } from '../support/async.js';
import { serializeError } from '../errors.js';

function safeResolve(app, key, fallback = null) {
  try {
    if (app?.container?.has?.(key) || typeof app?.resolve === 'function') {
      const value = app.resolve(key);
      return value === undefined ? fallback : value;
    }
  } catch {}
  return fallback;
}

function callSnapshot(value) {
  if (!value) return null;
  for (const method of ['snapshot', 'stats', 'getStats', 'metrics', 'health']) {
    try {
      if (typeof value[method] === 'function') return value[method]();
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }
  return null;
}

function underlyingServer(server) {
  return server?.httpServer || server?.server || server?.raw || server;
}

export class RawNodeRuntimeAdapter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.app = options.app || null;
    this.logger = options.logger || safeResolve(this.app, 'logger', console) || console;
    this.incidentDir = path.resolve(options.incidentDir || process.env.RAWNODE_PM_INCIDENT_DIR || 'storage/framework/pm/incidents');
    this.servers = new Map();
    this.resources = new Map();
    this.activeRequests = 0;
    this.totalRequests = 0;
    this.sockets = new Set();
    this._draining = false;
    for (const entry of options.servers || []) this.trackServer(entry);
  }

  trackServer(server, options = {}) {
    if (!server) return this;
    const name = options.name || `server-${this.servers.size + 1}`;
    const raw = underlyingServer(server);
    const record = { name, server, raw, sockets: new Set(), close: options.close || null, forceClose: options.forceClose || null };
    this.servers.set(name, record);

    if (raw && typeof raw.on === 'function') {
      raw.on('connection', (socket) => {
        record.sockets.add(socket);
        this.sockets.add(socket);
        socket.once('close', () => {
          record.sockets.delete(socket);
          this.sockets.delete(socket);
        });
      });
      raw.on('request', (_req, res) => {
        this.activeRequests++;
        this.totalRequests++;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          this.activeRequests = Math.max(0, this.activeRequests - 1);
        };
        res.once?.('finish', done);
        res.once?.('close', done);
      });
    }
    return this;
  }

  registerResource(name, resource) {
    if (!name || !resource) throw new Error('registerResource(name, resource) requires both values.');
    this.resources.set(String(name), resource);
    return this;
  }

  async health({ deep = true } = {}) {
    const health = safeResolve(this.app, 'health') || safeResolve(this.app, 'http.health') || safeResolve(this.app, 'health.check');
    let framework = null;
    try {
      if (health?.snapshot) framework = await health.snapshot({ deep });
      else framework = await Promise.resolve(callSnapshot(health));
    } catch (error) {
      framework = { ok: false, ready: false, error: error?.message || String(error) };
    }

    const resources = Object.create(null);
    let resourcesOk = true;
    for (const [name, resource] of this.resources) {
      if (typeof resource.health !== 'function') continue;
      try {
        const value = await resource.health();
        resources[name] = value ?? { ok: true };
        if (value?.ok === false) resourcesOk = false;
      } catch (error) {
        resources[name] = { ok: false, error: error?.message || String(error) };
        resourcesOk = false;
      }
    }

    return {
      ok: framework?.ok !== false && resourcesOk,
      ready: framework?.ready !== false && !this._draining,
      draining: this._draining,
      activeRequests: this.activeRequests,
      openSockets: this.sockets.size,
      framework,
      resources,
    };
  }

  async metrics() {
    const sources = {
      http: safeResolve(this.app, 'http.metrics'),
      events: safeResolve(this.app, 'events'),
      cache: safeResolve(this.app, 'cache'),
      redis: safeResolve(this.app, 'redis'),
      session: safeResolve(this.app, 'session.metrics'),
      websocket: safeResolve(this.app, 'ws') || safeResolve(this.app, 'io'),
      tcp: safeResolve(this.app, 'tcp'),
      udp: safeResolve(this.app, 'udp'),
      mongo: safeResolve(this.app, 'mongo'),
      view: safeResolve(this.app, 'view.observability') || safeResolve(this.app, 'view.cache'),
    };
    const framework = Object.create(null);
    for (const [name, source] of Object.entries(sources)) {
      try { framework[name] = await Promise.resolve(callSnapshot(source)); }
      catch (error) { framework[name] = { error: error?.message || String(error) }; }
    }
    for (const [name, resource] of this.resources) {
      if (typeof resource.metrics !== 'function') continue;
      try { framework[name] = await resource.metrics(); }
      catch (error) { framework[name] = { error: error?.message || String(error) }; }
    }
    return {
      activeRequests: this.activeRequests,
      totalRequests: this.totalRequests,
      openSockets: this.sockets.size,
      framework,
    };
  }

  async drain(options = {}) {
    if (this._draining) return { alreadyDraining: true };
    this._draining = true;
    const deadlineMs = Math.max(1, Number(options.deadlineMs) || 15_000);
    const events = safeResolve(this.app, 'events');
    try { await events?.dispatch?.('pm:runtime:draining', { pid: process.pid, deadlineMs }); } catch {}

    const resourceResults = Object.create(null);
    for (const [name, resource] of this.resources) {
      if (typeof resource.drain !== 'function') continue;
      try { resourceResults[name] = await withTimeout(() => resource.drain(options), deadlineMs); }
      catch (error) { resourceResults[name] = { ok: false, error: error?.message || String(error) }; }
    }

    const closes = [];
    for (const record of this.servers.values()) {
      closes.push(this._closeServer(record, deadlineMs));
    }
    const servers = await Promise.allSettled(closes);
    return {
      ok: servers.every((result) => result.status === 'fulfilled'),
      activeRequests: this.activeRequests,
      openSockets: this.sockets.size,
      resources: resourceResults,
      servers: servers.map((result) => result.status === 'fulfilled' ? result.value : { ok: false, error: result.reason?.message || String(result.reason) }),
    };
  }

  async _closeServer(record, deadlineMs) {
    const close = record.close || record.server?.close?.bind(record.server) || record.raw?.close?.bind(record.raw);
    if (typeof close !== 'function') return { name: record.name, ok: true, skipped: true };
    const task = new Promise((resolve, reject) => {
      let settled = false;
      const done = (error) => {
        if (settled) return;
        settled = true;
        error ? reject(error) : resolve({ name: record.name, ok: true });
      };
      try {
        const value = close(done);
        if (value && typeof value.then === 'function') value.then(() => done(), done);
        else if (close.length === 0) done();
      } catch (error) { done(error); }
    });
    try {
      return await withTimeout(task, deadlineMs, { message: `Server '${record.name}' did not drain within ${deadlineMs}ms.` });
    } catch (error) {
      if (typeof record.forceClose === 'function') {
        try { await record.forceClose(); } catch {}
      }
      for (const socket of record.sockets) {
        try { socket.destroy(); } catch {}
      }
      return { name: record.name, ok: false, forced: true, error: error?.message || String(error) };
    }
  }

  async shutdown(options = {}) {
    const events = safeResolve(this.app, 'events');
    try { await events?.dispatch?.('pm:runtime:shutting-down', { pid: process.pid }); } catch {}
    for (const [name, resource] of Array.from(this.resources).reverse()) {
      if (typeof resource.shutdown !== 'function') continue;
      try { await resource.shutdown(options); }
      catch (error) { this.logger?.warn?.(`[rawnode-pm] Resource '${name}' shutdown failed`, error); }
    }
    if (this.app?.shutdown) await this.app.shutdown();
    return { ok: true };
  }

  async reloadConfig() {
    const config = safeResolve(this.app, 'config');
    if (config?.reload) return config.reload();
    return { ok: false, skipped: true, reason: 'config.reload unavailable' };
  }

  async diagnostics(options = {}) {
    if (!process.report?.writeReport) return { ok: false, supported: false };
    await mkdir(this.incidentDir, { recursive: true, mode: 0o700 });
    const file = path.join(this.incidentDir, `report-${process.pid}-${Date.now()}.json`);
    try {
      const output = process.report.writeReport(file, options.error);
      return { ok: true, file: output || file };
    } catch (error) {
      return { ok: false, error: serializeError(error) };
    }
  }
}

export default RawNodeRuntimeAdapter;
