'use strict';

// RawNode Monitor enterprise integration provider.
// Registration is side-effect free. Background collectors only start when the
// Foundation invocation context explicitly allows automatic background work.

import defaultMonitorConfig from '../../config/monitor.js';

import {
  MonitorManager,
  MonitorStudioManager,
  createMonitorHttpMiddleware,
  registerMonitorStudioRoutes,
  RAWNODE_MONITOR_COMMANDS,
} from '../index.js';

const COMMAND_TAG = 'console.command';

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function merge(base, overlay) {
  const output = { ...(isPlainObject(base) ? base : {}) };
  for (const [key, value] of Object.entries(isPlainObject(overlay) ? overlay : {})) {
    output[key] = isPlainObject(value) && isPlainObject(output[key]) ? merge(output[key], value) : value;
  }
  return output;
}
function safeResolve(app, key, fallback = null) {
  try {
    if (typeof app?.tryResolve === 'function') return app.tryResolve(key, fallback) ?? fallback;
    return app?.resolve?.(key) ?? app?.container?.resolve?.(key) ?? fallback;
  } catch { return fallback; }
}
function configGet(config, key, fallback = undefined) {
  try { const value = config?.get?.(key); return value === undefined ? fallback : value; }
  catch { return fallback; }
}
function hasBinding(app, key) {
  try { return app?.bound?.(key) || app?.container?.bound?.(key) || app?.container?.has?.(key); }
  catch { return false; }
}
function singleton(app, key, factory) {
  if (hasBinding(app, key)) return;
  if (typeof app?.singleton === 'function') { app.singleton(key, factory); return; }
  if (typeof app?.bind === 'function') { app.bind(key, factory, true); return; }
  throw new TypeError(`RawNode application cannot register singleton [${key}].`);
}
function alias(app, aliasKey, targetKey) {
  if (hasBinding(app, aliasKey)) return;
  try {
    if (typeof app?.alias === 'function') app.alias(targetKey, aliasKey);
    else singleton(app, aliasKey, () => app.resolve(targetKey));
  } catch {}
}
function tag(app, key, ...tags) {
  const container = app?.container || app;
  for (const value of tags) { try { container?.tag?.(key, value); } catch {} }
}
function logger(app) { return safeResolve(app, 'logger', null) || app?.logger || console; }
function log(app, level, message, context = null) {
  const target = logger(app);
  try { (target?.[level] || target?.log || console.log).call(target, message, context); } catch {}
}

export class MonitorServiceProvider {
  static dependencies = ['app'];
  static priority = 90;

  constructor(app, options = {}) {
    this.options = options;
    this.app = app;
    this.manager = null;
    this.runtime = null;
    this.studio = null;
    this.routes = null;
    this.readinessRegistry = null;
    this.readinessNames = [];
    this.httpRegistered = false;
    this.booted = false;
  }

  register() {
    const app = this.app;

    singleton(app, 'monitor.manager', () => {
      const configured = configGet(safeResolve(app, 'config'), 'monitor', {}) || {};
      const options = merge(defaultMonitorConfig, configured);
      this.manager = new MonitorManager({
        app,
        root: app?.rootPath || app?.basePath || process.cwd(),
        config: options,
        logger: logger(app),
        events: safeResolve(app, 'events'),
        database: safeResolve(app, 'database') || safeResolve(app, 'rawmongo') || safeResolve(app, 'mongo'),
        redis: safeResolve(app, 'redis') || safeResolve(app, 'redis.client'),
      });
      return this.manager;
    });

    singleton(app, 'monitor.runtime', () => {
      this.runtime = app.resolve('monitor.manager').default();
      return this.runtime;
    });
    alias(app, 'monitor', 'monitor.runtime');

    const runtimeBindings = {
      'monitor.configuration': 'configuration',
      'monitor.metrics': 'metrics',
      'monitor.tracer': 'tracer',
      'monitor.context': 'context',
      'monitor.health': 'healthRegistry',
      'monitor.resources': 'resources',
      'monitor.pipeline': 'pipeline',
      'monitor.store': 'store',
      'monitor.exporters': 'exporters',
      'monitor.alerts': 'alerts',
      'monitor.slo': 'slos',
      'monitor.incidents': 'incidents',
      'monitor.runbooks': 'runbooks',
      'monitor.system': 'system',
      'monitor.anomalies': 'anomalies',
      'monitor.leaks': 'leaks',
      'monitor.correlations': 'correlations',
      'monitor.synthetics': 'synthetics',
      'monitor.plugins': 'plugins',
      'monitor.fleet': 'fleet',
      'monitor.deployments': 'deployments',
      'monitor.query': 'query',
      'monitor.integrations': 'integrations',
    };
    for (const [key, property] of Object.entries(runtimeBindings)) singleton(app, key, () => app.resolve('monitor.runtime')[property]);

    singleton(app, 'monitor.http.middleware', () => {
      const runtime = app.resolve('monitor.runtime');
      const setting = runtime.configuration.get('integrations.http', {});
      const options = typeof setting === 'object' ? setting : {};
      const exclude = Array.from(new Set([...(options.exclude || []), runtime.configuration.get('studio.prefix')]));
      return createMonitorHttpMiddleware(runtime, { ...options, exclude });
    });

    singleton(app, 'monitor.studio', () => {
      this.studio = new MonitorStudioManager({
        monitor: app.resolve('monitor.runtime'),
        config: app.resolve('monitor.runtime').configuration.get('studio', {}),
      });
      return this.studio;
    });

    RAWNODE_MONITOR_COMMANDS.forEach((CommandClass, index) => {
      const command = new CommandClass(app);
      const name = command.signature.split(/\s+/)[0];
      const key = `command.monitor.${name.replace(/^monitor:/, '').replace(/:/g, '.') || index}`;
      singleton(app, key, () => new CommandClass(app));
      tag(app, key, COMMAND_TAG, 'monitor.command', 'observability');
    });

    this._installHelpers();
    return this;
  }

  async boot() {
    if (this.booted) return this;
    const runtime = safeResolve(this.app, 'monitor.runtime');
    if (!runtime) return this;
    this.runtime = runtime;

    // Construct and attach HTTP instrumentation before production definitions
    // are frozen by MonitorRuntime.start().
    this._registerHttpMiddleware(runtime);
    this._registerStudioRoutes(runtime);
    this._registerFoundationReadiness(runtime);

    if (runtime.enabled && this.options.allowsBackgroundAutoStart?.(this.app) === true) {
      try {
        await runtime.start();
      } catch (error) {
        log(this.app, 'error', '[RawNode Monitor] startup failed', { code: error?.code, message: error?.message });
        if (runtime.configuration.get('failFast')) throw error;
      }
    }

    this.booted = true;
    if (runtime.configuration.get('bootSummary')) {
      log(this.app, 'info', '[RawNode Monitor] observability control plane registered', {
        state: runtime.state,
        profile: runtime.configuration.get('profile'),
        storage: runtime.configuration.get('storage.driver'),
        studio: runtime.configuration.get('studio.enabled') ? runtime.configuration.get('studio.prefix') : false,
      });
    }
    return this;
  }

  _registerHttpMiddleware(runtime) {
    if (this.httpRegistered) return;
    const setting = runtime.configuration.get('integrations.http', {});
    const enabled = setting !== false && (typeof setting !== 'object' || setting.enabled !== false);
    const autoRegister = typeof setting !== 'object' || setting.autoRegister !== false;
    if (!enabled || !autoRegister) return;
    const router = safeResolve(this.app, 'router') || safeResolve(this.app, 'http.router');
    if (!router || typeof router.use !== 'function') return;
    const middleware = safeResolve(this.app, 'monitor.http.middleware');
    if (!middleware) return;
    router.use(middleware);
    this.httpRegistered = true;
  }

  _registerStudioRoutes(runtime) {
    if (this.routes || !runtime.configuration.get('studio.enabled') || !runtime.configuration.get('studio.registerRoutes')) return;
    const router = safeResolve(this.app, 'router') || safeResolve(this.app, 'http.router');
    if (!router) return;
    const studio = safeResolve(this.app, 'monitor.studio');
    if (!studio) return;
    this.routes = registerMonitorStudioRoutes(router, {
      studio,
      assetsRoot: this.options.assetsRoot,
      prefix: runtime.configuration.get('studio.prefix'),
      maxBodyBytes: runtime.configuration.get('security.maxPayloadBytes'),
    });
  }

  _registerFoundationReadiness(runtime) {
    if (this.readinessRegistry) return;
    const registry = safeResolve(this.app, 'app.readiness');
    if (!registry || typeof registry.register !== 'function') return;
    registry.register('monitor', () => runtime.readiness({ fresh: true }), {
      critical: runtime.configuration.get('storage.required') === true,
      timeoutMs: runtime.configuration.get('health.timeoutMs'),
      tags: ['readiness', 'monitor', 'observability'],
    });
    registry.register('monitor-runtime', () => runtime.liveness({ fresh: true }), {
      critical: true,
      timeoutMs: runtime.configuration.get('health.timeoutMs'),
      tags: ['liveness', 'monitor', 'observability'],
    });
    this.readinessRegistry = registry;
    this.readinessNames = ['monitor', 'monitor-runtime'];
  }

  _installHelpers() {
    const app = this.app;
    if (typeof app.monitor !== 'function') app.monitor = (name = null) => name ? app.resolve('monitor.manager').runtime(name) : app.resolve('monitor.runtime');
    if (typeof app.metrics !== 'function') app.metrics = () => app.resolve('monitor.metrics');
    if (typeof app.tracer !== 'function') app.tracer = () => app.resolve('monitor.tracer');
    if (typeof app.incidents !== 'function') app.incidents = () => app.resolve('monitor.incidents');
    if (typeof app.synthetics !== 'function') app.synthetics = () => app.resolve('monitor.synthetics');
    if (typeof app.anomalies !== 'function') app.anomalies = () => app.resolve('monitor.anomalies');
  }

  async teardown() {
    for (const name of this.readinessNames) { try { this.readinessRegistry?.unregister?.(name); } catch {} }
    this.readinessNames = [];
    this.readinessRegistry = null;
    try { await this.studio?.close?.(); } catch {}
    try { await this.manager?.close?.(); } catch {}
    this.routes = null;
    this.httpRegistered = false;
    this.booted = false;
  }
}

export default MonitorServiceProvider;
