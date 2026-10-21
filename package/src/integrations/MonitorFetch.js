'use strict';

import { SpanKind, SpanStatus } from '../constants.js';
import { injectTraceContext } from '../tracing/TraceContext.js';

/** Return an instrumented fetch function without replacing globalThis.fetch. */
export function createMonitorFetch(monitor, fetchImpl = globalThis.fetch, options = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('createMonitorFetch requires a fetch implementation.');
  const requests = monitor.metrics.counter('http_client_requests_total');
  const duration = monitor.metrics.histogram('http_client_request_duration_seconds', { unit: 'seconds' });
  return async function monitorFetch(input, init = {}) {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const method = String(init.method || (typeof input === 'object' ? input.method : '') || 'GET').toUpperCase();
    return await monitor.tracer.trace(`${method} ${url.hostname}`, { kind: SpanKind.CLIENT, attributes: { 'http.request.method': method, 'url.full': options.captureQuery === true ? url.toString() : `${url.origin}${url.pathname}`, 'server.address': url.hostname, 'server.port': url.port || null } }, async (span) => {
      const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined) || {});
      injectTraceContext(span.spanContext(), headers, { set: (target, key, value) => target.set(key, value) });
      const started = process.hrtime.bigint();
      try {
        const response = await fetchImpl(input, { ...init, headers });
        const labels = { method, host: url.hostname, status: String(response.status), status_class: `${Math.floor(response.status / 100)}xx` };
        requests.inc(labels); duration.record(Number(process.hrtime.bigint() - started) / 1e9, labels);
        span.setAttribute('http.response.status_code', response.status).setStatus(response.status >= 500 ? SpanStatus.ERROR : SpanStatus.OK);
        return response;
      } catch (error) {
        const labels = { method, host: url.hostname, status: '0', status_class: 'network_error' };
        requests.inc(labels); duration.record(Number(process.hrtime.bigint() - started) / 1e9, labels);
        span.recordException(error).setStatus(SpanStatus.ERROR, error?.message); throw error;
      }
    });
  };
}
export default createMonitorFetch;
