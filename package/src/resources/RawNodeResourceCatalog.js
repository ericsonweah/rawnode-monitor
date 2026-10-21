'use strict';

export const RAWNODE_RESOURCE_CATALOG = Object.freeze([
  resource('http', ['http.metrics', 'http.server', 'http.health'], ['health', 'readiness', 'snapshot'], ['metrics', 'snapshot', 'getStats']),
  resource('routes', ['router', 'routes.metrics', 'route.metrics'], ['health', 'snapshot'], ['metrics', 'snapshot', 'manifest']),
  resource('websocket', ['ws.metrics', 'websocket.metrics', 'ws', 'websocket', 'io'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('tcp', ['tcp.metrics', 'tcp', 'tcp.server'], ['health', 'snapshot'], ['metrics', 'snapshot', 'getStats']),
  resource('udp', ['udp.metrics', 'udp', 'udp.server'], ['health', 'snapshot'], ['metrics', 'snapshot', 'getStats']),
  resource('unified', ['unified.metrics', 'unified.server', 'unified'], ['health', 'snapshot'], ['metrics', 'snapshot', 'getStats']),
  resource('mongo', ['mongo.metrics', 'rawmongo.metrics', 'mongo', 'rawmongo', 'database'], ['health', 'ping', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('redis', ['redis.health.all', 'redis.readiness.all', 'redis.health', 'redis'], ['health', 'ping', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('cache', ['cache.metrics', 'cache.repository', 'cache'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('session', ['session.metrics', 'session.manager', 'session'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('view', ['view.observability', 'view.cache', 'view'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('events', ['events.metrics', 'events'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('logger', ['logger.health', 'logger.manager', 'logger'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('pm', ['pm.manager', 'pm.runtime'], ['runtimeHealth', 'health', 'liveness', 'snapshot'], ['metrics', 'snapshot']),
  resource('live', ['live.metrics', 'live.manager', 'live'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('sdspa', ['sdspa.manager', 'sdspa'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('mail', ['mail.metrics', 'mail.manager', 'mailer'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('payment', ['payment.metrics', 'payment.manager', 'payment'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('phone', ['phone.metrics', 'phone.manager', 'phone'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('editor', ['editor.metrics', 'editor', 'editor.studio'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('filesystem', ['fs.metrics', 'filesystem.metrics', 'fs', 'storage'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('validator', ['validator.metrics', 'validator.manager'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('config', ['config.metrics', 'config'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('dotenv', ['dotenv.metrics', 'dotenv'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('console', ['console.metrics', 'console.manager'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
  resource('frontend', ['frontend.studio', 'frontend.metrics'], ['health', 'snapshot'], ['metrics', 'snapshot', 'stats']),
]);

function resource(name, bindings, healthMethods, metricMethods) {
  return Object.freeze({ name, bindings: Object.freeze(bindings), healthMethods: Object.freeze(healthMethods), metricMethods: Object.freeze(metricMethods) });
}
