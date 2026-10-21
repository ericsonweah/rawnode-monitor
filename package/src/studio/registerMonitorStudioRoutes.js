'use strict';

import MonitorStudioController from './MonitorStudioController.js';
import MonitorStudioAssets from './MonitorStudioAssets.js';

export function registerMonitorStudioRoutes(router, options = {}) {
  if (!router || typeof router.get !== 'function') throw new TypeError('registerMonitorStudioRoutes requires an HTTP router.');
  const studio = options.studio;
  if (!studio) throw new TypeError('registerMonitorStudioRoutes requires studio.');
  const prefix = normalize(options.prefix || studio.config.prefix || '/__rawnode/monitor');
  const assets = options.assets || new MonitorStudioAssets({ root: options.assetsRoot, production: studio.monitor.configuration.get('production') });
  const controller = options.controller || new MonitorStudioController({ studio, assets, prefix, maxBodyBytes: options.maxBodyBytes });
  const group = typeof router.group === 'function' ? (callback) => router.group({ prefix, name: 'monitor.' }, callback) : (callback) => callback(prefixedRouter(router, prefix));
  group((route) => {
    route.get('/', controller.page);
    route.get('/assets/:asset', controller.asset);
    route.get('/api/overview', controller.overview);
    route.get('/api/metrics', controller.metrics);
    route.get('/api/prometheus', controller.prometheus);
    route.get('/api/traces', controller.traces);
    route.get('/api/traces/:traceId', controller.trace);
    route.get('/api/signals', controller.signals);
    route.get('/api/health', controller.health);
    route.get('/api/resources', controller.resources);
    route.get('/api/resources/:name', controller.resources);
    route.get('/api/alerts', controller.alerts);
    route.post('/api/alerts/:id/acknowledge', controller.acknowledgeAlert);
    route.post('/api/silences', controller.silence);
    route.delete('/api/silences/:id', controller.removeSilence);
    route.get('/api/slos', controller.slos);
    route.get('/api/slos/:id', controller.slos);
    route.get('/api/incidents', controller.incidents);
    route.post('/api/incidents/:id/acknowledge', controller.acknowledgeIncident);
    route.post('/api/incidents/:id/resolve', controller.resolveIncident);
    route.post('/api/incidents/:id/annotate', controller.annotateIncident);
    route.get('/api/fleet', controller.fleet);
    route.get('/api/deployments', controller.deployments);
    route.get('/api/anomalies', controller.anomalies);
    route.get('/api/synthetics', controller.synthetics);
    route.post('/api/synthetics/:id/run', controller.runSynthetic);
    route.post('/api/correlate', controller.correlate);
    route.get('/api/diagnostics', controller.diagnostics);
    route.get('/api/doctor', controller.doctor);
    route.post('/api/diagnostics/bundle', controller.bundle);
    route.get('/api/stream', controller.stream);
    route.post('/api/ingest', controller.ingest);
  });
  return { prefix, controller, assets, studio };
}
function normalize(value) { const text = String(value || '/__rawnode/monitor').trim(); const path = `/${text.replace(/^\/+|\/+$/g, '')}`; return path === '/' ? '/__rawnode/monitor' : path; }
function prefixedRouter(router, prefix) { return new Proxy(router, { get(target, property) { if (['get', 'post', 'put', 'patch', 'delete'].includes(String(property))) return (path, ...handlers) => target[property](`${prefix}${path === '/' ? '' : path}`, ...handlers); return Reflect.get(target, property); } }); }
export default registerMonitorStudioRoutes;
