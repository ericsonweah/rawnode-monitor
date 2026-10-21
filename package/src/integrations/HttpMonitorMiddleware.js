'use strict';

import { SpanKind, SpanStatus } from '../constants.js';
import { extractTraceContext, injectTraceContext } from '../tracing/TraceContext.js';
import { errorRecord } from '../support.js';

/** RawNode/Express-compatible HTTP server middleware with no request-body capture. */
export function createMonitorHttpMiddleware(monitor, options = {}) {
  if (!monitor) throw new TypeError('createMonitorHttpMiddleware() requires a MonitorRuntime.');
  const requests = monitor.metrics.counter('http_server_requests_total', { description: 'HTTP requests completed by the application.' });
  const duration = monitor.metrics.histogram('http_server_request_duration_seconds', { unit: 'seconds', description: 'HTTP server request latency.' });
  const active = monitor.metrics.upDownCounter('http_server_active_requests', { description: 'HTTP requests currently executing.' });
  const responseBytes = monitor.metrics.histogram('http_server_response_bytes', { unit: 'bytes' });

  return function rawNodeMonitorHttp(req, res, next) {
    if (monitor.configuration.get('enabled') === false || ignored(req, options)) return next();
    const started = process.hrtime.bigint();
    const method = String(req.method || 'GET').toUpperCase();
    const route = routeName(req, options);
    const path = safePath(req, options);
    const parent = extractTraceContext(req.headers || {}, { strict: options.strictTraceContext === true });
    const span = monitor.tracer.startSpan(`${method} ${route || path || '/'}`, {
      kind: SpanKind.SERVER,
      parent,
      attributes: {
        'http.request.method': method,
        'url.path': path,
        'http.route': route,
        'network.protocol.version': req.httpVersion || null,
        'server.address': req.headers?.host || null,
        'client.address': clientAddress(req, options),
        'user_agent.original': options.captureUserAgent === true ? req.headers?.['user-agent'] : undefined,
      },
    });
    const context = monitor.context.createRequestContext(req, {
      traceId: span.traceId,
      spanId: span.spanId,
      traceContext: span.spanContext(),
      span,
    });
    req.monitor = monitor;
    req.monitorContext = context;
    req.traceId = req.traceId || span.traceId;
    req.spanId = req.spanId || span.spanId;
    setResponseHeader(res, 'x-request-id', context.requestId);
    if (options.exposeTraceId === true) setResponseHeader(res, 'x-trace-id', span.traceId);
    if (options.propagateResponseTrace === true) injectTraceContext(span.spanContext(), res, { set: (target, key, value) => setResponseHeader(target, key, value) });

    const labels = { method, route: route || path || 'unmatched' };
    active.add(1, labels);
    let settled = false;
    const finish = (error = null, event = 'finish') => {
      if (settled) return;
      settled = true;
      const status = Number(res.statusCode || res.raw?.statusCode || (error ? 500 : 200));
      const elapsed = Number(process.hrtime.bigint() - started) / 1e9;
      const finalLabels = { ...labels, status: String(status), status_class: `${Math.floor(status / 100)}xx` };
      active.add(-1, labels);
      requests.inc(finalLabels, { context });
      duration.record(elapsed, finalLabels, { context });
      const bytes = responseSize(res);
      if (bytes != null) responseBytes.record(bytes, finalLabels, { context });
      span.setAttribute('http.response.status_code', status)
        .setAttribute('rawnode.response.event', event)
        .setAttribute('http.response.body.size', bytes);
      if (error) span.recordException(error);
      span.setStatus(error || status >= 500 ? SpanStatus.ERROR : SpanStatus.OK, error?.message || null).end();
      monitor.emitEvent('http.request.completed', {
        requestId: context.requestId,
        method,
        route: route || null,
        path,
        status,
        durationMs: elapsed * 1_000,
        error: error ? errorRecord(error) : null,
      }, { traceId: span.traceId, spanId: span.spanId, priority: status >= 500 ? 10 : 0 });
    };
    const raw = res.raw || res;
    raw.once?.('finish', () => finish(null, 'finish'));
    raw.once?.('close', () => finish(null, 'close'));
    raw.once?.('error', (error) => finish(error, 'error'));

    return monitor.context.run(context, async () => {
      try {
        const result = next();
        if (result && typeof result.then === 'function') await result;
        if (!raw.once && (res.finished || res.headersSent)) finish();
        return result;
      } catch (error) {
        finish(error, 'middleware-error');
        throw error;
      }
    });
  };
}

function ignored(req, options) { const value = safePath(req, options); return (options.exclude || []).some((entry) => typeof entry === 'function' ? entry(req) : entry instanceof RegExp ? entry.test(value) : value.startsWith(String(entry))); }
function routeName(req, options) { return options.routeResolver?.(req) || req.route?.name || req.routeName || req.matchedRoute?.name || req.route?.path || req.matchedRoute?.path || null; }
function safePath(req, options) { const source = options.pathResolver?.(req) || (typeof req.path === 'function' ? req.path() : req.path) || req.url || '/'; try { return new URL(source, 'http://rawnode.local').pathname; } catch { return String(source).split('?')[0]; } }
function clientAddress(req, options) { if (options.trustProxy === true) return String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || req.socket?.remoteAddress || null; return req.ip || req.socket?.remoteAddress || null; }
function setResponseHeader(res, name, value) { try { if (value != null) (res.setHeader || res.raw?.setHeader)?.call(res.setHeader ? res : res.raw, name, String(value)); } catch {} }
function responseSize(res) { const value = res.getHeader?.('content-length') ?? res.raw?.getHeader?.('content-length'); const number = Number(value); return Number.isFinite(number) ? number : null; }
export default createMonitorHttpMiddleware;
