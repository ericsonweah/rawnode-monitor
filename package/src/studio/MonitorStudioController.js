'use strict';

import { renderMonitorStudioPage } from './MonitorStudioPage.js';
import { errorRecord } from '../support.js';

export class MonitorStudioController {
  constructor(options = {}) { this.studio = options.studio; this.assets = options.assets; this.prefix = options.prefix; this.maxBodyBytes = Math.max(1_024, Number(options.maxBodyBytes) || 1024 * 1024); }

  page = async (req, res) => {
    const auth = await this._authorize(req, res); if (!auth) return;
    return html(res, 200, renderMonitorStudioPage({ prefix: this.prefix, pollIntervalMs: this.studio.config.pollIntervalMs, service: this.studio.monitor.configuration.get('service'), environment: this.studio.monitor.configuration.get('environment'), tokenRequired: !!this.studio.authorizer.token }));
  };
  asset = async (req, res) => { const auth = await this._authorize(req, res); if (!auth) return; const record = await this.assets.read(param(req, 'asset')); if (!record) return json(res, 404, { ok: false, error: { code: 'MONITOR_ASSET_NOT_FOUND', message: 'Asset not found.' } }); return send(res, 200, record.body, record.type, { 'cache-control': this.studio.monitor.configuration.get('production') ? 'public, max-age=3600, immutable' : 'no-cache' }); };
  overview = this._get(() => this.studio.overview());
  metrics = this._get((req) => this.studio.metrics({ history: query(req).history === '1', limit: number(query(req).limit, 100) }));
  prometheus = async (req, res) => { const auth = await this._authorize(req, res); if (!auth) return; return send(res, 200, this.studio.monitor.prometheus(), 'text/plain; version=0.0.4; charset=utf-8', { 'cache-control': 'no-store' }); };
  traces = this._get((req) => this.studio.traces({ limit: number(query(req).limit, 100), traceId: query(req).traceId, status: query(req).status, minDurationMs: query(req).minDurationMs }));
  trace = this._get((req) => this.studio.trace(param(req, 'traceId')));
  signals = this._get((req) => this.studio.signals({ limit: number(query(req).limit, 100), kind: query(req).kind, traceId: query(req).traceId, since: query(req).since, until: query(req).until }));
  health = this._get((req) => this.studio.health({ fresh: query(req).fresh === '1' }));
  resources = this._get((req) => this.studio.resources(param(req, 'name') || null));
  alerts = this._get((req) => this.studio.alerts({ state: query(req).state, severity: query(req).severity, limit: number(query(req).limit, 100) }));
  acknowledgeAlert = this._mutate(async (req, auth) => ({ ok: this.studio.acknowledgeAlert(param(req, 'id'), actor(auth)) }));
  silence = this._mutate(async (req, auth) => this.studio.silence(await body(req, this.maxBodyBytes), actor(auth)));
  removeSilence = this._mutate(async (req) => ({ ok: this.studio.removeSilence(param(req, 'id')) }));
  slos = this._get((req) => this.studio.slos(param(req, 'id') || null));
  incidents = this._get((req) => this.studio.incidents({ state: query(req).state, severity: query(req).severity, limit: number(query(req).limit, 100) }));
  acknowledgeIncident = this._mutate(async (req, auth) => this.studio.acknowledgeIncident(param(req, 'id'), { ...(await body(req, this.maxBodyBytes)), actor: actor(auth) }));
  resolveIncident = this._mutate(async (req, auth) => this.studio.resolveIncident(param(req, 'id'), { ...(await body(req, this.maxBodyBytes)), actor: actor(auth) }));
  annotateIncident = this._mutate(async (req, auth) => this.studio.annotateIncident(param(req, 'id'), { ...(await body(req, this.maxBodyBytes)), actor: actor(auth) }));
  fleet = this._get(() => this.studio.fleet());
  deployments = this._get((req) => this.studio.deployments({ limit: number(query(req).limit, 100) }));
  anomalies = this._get((req) => this.studio.anomalies({ includeBaselines: query(req).baselines === '1', includeSeries: query(req).series === '1' }));
  synthetics = this._get((req) => this.studio.synthetics({ history: query(req).history === '1', limit: number(query(req).limit, 100) }));
  runSynthetic = this._mutate(async (req) => this.studio.runSynthetic(param(req, 'id'), await body(req, this.maxBodyBytes)));
  correlate = this._mutate(async (req) => { const input = await body(req, this.maxBodyBytes); return this.studio.correlate(input, input.options || {}); });
  diagnostics = this._get((req) => this.studio.diagnostics({ includeSignals: query(req).signals === '1', signalLimit: number(query(req).limit, 100), includeSyntheticHistory: query(req).synthetics === '1' }));
  doctor = this._get(() => this.studio.doctor());
  bundle = this._mutate(async (req) => this.studio.bundle(await body(req, this.maxBodyBytes)));
  stream = async (req, res) => { const auth = await this._authorize(req, res); if (!auth) return; return this.studio.stream(req, res); };
  ingest = async (req, res) => {
    if (!this.studio.monitor.configuration.get('security.allowRemoteIngest')) return json(res, 404, { ok: false, error: { code: 'MONITOR_INGEST_DISABLED', message: 'Remote ingestion is disabled.' } });
    try { const raw = await rawBody(req, this.maxBodyBytes); this.studio.monitor.authenticator.assert(raw, req.headers || {}); const parsed = JSON.parse(raw.toString('utf8')); return json(res, 202, { ok: true, ...this.studio.monitor.sanitizeTelemetry(await this.studio.monitor.ingest(parsed, { remote: true })) }); }
    catch (error) { return this._failure(res, error); }
  };

  _get(handler) { return async (req, res) => { const auth = await this._authorize(req, res); if (!auth) return; try { return json(res, 200, { ok: true, data: this.studio.monitor.sanitizeTelemetry(await handler(req, auth)) }); } catch (error) { return this._failure(res, error); } }; }
  _mutate(handler) { return async (req, res) => { const auth = await this._authorize(req, res, { mutate: true }); if (!auth) return; try { return json(res, 200, { ok: true, data: this.studio.monitor.sanitizeTelemetry(await handler(req, auth)) }); } catch (error) { return this._failure(res, error); } }; }
  _failure(res, error) {
    const monitor = this.studio.monitor;
    const record = monitor.sanitizeTelemetry(errorRecord(error, { stack: false }));
    // The serializer may replace a large record with its bounded truncation
    // marker. Keep a separately sanitized protocol code useful to callers.
    if (record?.truncated === true) Object.assign(record, monitor.sanitizeTelemetry({ code: error?.code || null, message: 'Monitor request failed; error details exceeded serialization limits.' }));
    return json(res, errorStatus(error?.status), { ok: false, error: record });
  }
  async _authorize(req, res, options = {}) { try { const result = await this.studio.authorize(req, options); if (result.ok) { secure(res); return result; } for (const [key, value] of Object.entries(result.headers || {})) setHeader(res, key, value); json(res, errorStatus(result.status, 403), { ok: false, error: this.studio.monitor.sanitizeTelemetry({ code: result.code, message: result.message }) }); return null; } catch (error) { this._failure(res, error); return null; } }
}

function param(req, name) { return req.params?.[name] ?? req.param?.(name) ?? null; }
function query(req) { if (req.query && typeof req.query === 'object') return req.query; try { return Object.fromEntries(new URL(req.url || '/', 'http://rawnode.local').searchParams); } catch { return {}; } }
function actor(auth) { return auth?.actor?.id || auth?.actor?.userId || auth?.actor || null; }
function number(value, fallback) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
async function body(req, maxBytes) { if (req.body && typeof req.body === 'object') { if (Buffer.byteLength(JSON.stringify(req.body)) > maxBytes) throw tooLarge(); return req.body; } const raw = await rawBody(req, maxBytes); if (!raw.length) return {}; return JSON.parse(raw.toString('utf8')); }
async function rawBody(req, maxBytes) { if (Buffer.isBuffer(req.rawBody)) { if (req.rawBody.length > maxBytes) throw tooLarge(); return req.rawBody; } const raw = req.raw || req; if (!raw?.[Symbol.asyncIterator]) return Buffer.alloc(0); const chunks = []; let bytes = 0; for await (const chunk of raw) { const value = Buffer.from(chunk); bytes += value.length; if (bytes > maxBytes) throw Object.assign(new Error('Monitor request body is too large.'), { code: 'MONITOR_BODY_TOO_LARGE', status: 413 }); chunks.push(value); } return Buffer.concat(chunks); }
function tooLarge() { return Object.assign(new Error('Monitor request body is too large.'), { code: 'MONITOR_BODY_TOO_LARGE', status: 413 }); }
function errorStatus(value, fallback = 500) { const status = Number(value); return Number.isInteger(status) && status >= 400 && status <= 599 ? status : fallback; }
function secure(res) { for (const [key, value] of Object.entries({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", 'cache-control': 'no-store' })) setHeader(res, key, value); }
function setHeader(res, name, value) { try { (res.setHeader || res.raw?.setHeader)?.call(res.setHeader ? res : res.raw, name, value); } catch {} }
function json(res, status, value) { secure(res); if (typeof res.status === 'function') { const target = res.status(status); if (typeof target.json === 'function') return target.json(value); if (typeof target.send === 'function') return target.send(JSON.stringify(value)); } const raw = res.raw || res; raw.statusCode = status; raw.setHeader?.('content-type', 'application/json; charset=utf-8'); return raw.end?.(JSON.stringify(value)); }
function html(res, status, value) { return send(res, status, value, 'text/html; charset=utf-8'); }
function send(res, status, value, type, headers = {}) { secure(res); for (const [key, item] of Object.entries(headers)) setHeader(res, key, item); if (typeof res.status === 'function') { const target = res.status(status); target.type?.(type); if (typeof target.send === 'function') return target.send(value); } const raw = res.raw || res; raw.statusCode = status; raw.setHeader?.('content-type', type); return raw.end?.(value); }
export default MonitorStudioController;
