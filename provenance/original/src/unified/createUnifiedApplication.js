'use strict';

import { randomBytes } from 'node:crypto';
import rawnodeHttp, { SignalManager } from '#http-server';
import { SocketIOSkin } from '#ws';
import { resolveWebSocketOptions } from '#ws/foundation/WebSocketConfiguration.js';
import { SocketSkin } from '#tcp';
import { App as UdpApp, normalizeEnterpriseOptions as normalizeUdpEnterpriseOptions } from '#udp';
import { normalizeUnifiedFactoryOptions, parseListenArguments } from './config/normalizeUnifiedOptions.js';
import { UnifiedServer } from './UnifiedServer.js';
import { UnifiedStateError } from './errors/UnifiedError.js';

const kUnified = Symbol.for('rawnode.unified.server');
const kOriginal = Symbol.for('rawnode.unified.original-http-api');

function define(target, name, value) {
  Object.defineProperty(target, name, { value, configurable: true, enumerable: true, writable: false });
}

function captureHttpApi(app) {
  return Object.freeze({
    ready: app.ready.bind(app),
    boot: app.boot?.bind(app),
    createServer: app.createServer.bind(app),
    listen: app.listen.bind(app),
    start: app.start.bind(app),
    drain: app.drain.bind(app),
    close: app.close.bind(app),
    health: app.health.bind(app),
    metrics: app.metrics.bind(app),
    diagnostics: app.diagnostics.bind(app),
    manageSignals: app.manageSignals.bind(app),
  });
}

function ownedWebSocketOptions(factory) {
  return resolveWebSocketOptions({
    profile: factory.protocolProfiles.websocket,
    ...factory.websocket,
  });
}

function ownedUdpOptions(factory) {
  const options = {
    profile: factory.protocolProfiles.udp,
    startPaused: true,
    reuseAddr: factory.listen?.reuseAddr ?? factory.reuseAddr ?? factory.udp?.reuseAddr,
    ...factory.udp,
  };
  if (factory.protocolProfiles.udp === 'compat') return options;
  const handshake = { ...(options.handshake || {}) };
  if (!handshake.secret) handshake.secret = randomBytes(32).toString('base64url');
  if (!handshake.mode) handshake.mode = 'required';
  return normalizeUdpEnterpriseOptions({ ...options, handshake });
}

function claimStartupApi(manager, current, next) {
  if (current.value && current.value !== next && !['idle', 'failed'].includes(manager.state)) {
    throw new UnifiedStateError(`start() and listen() are alternative startup APIs. This application already started through ${current.value}().`, {
      code: 'UNIFIED_STARTUP_API_CONFLICT',
      details: { active: current.value, attempted: next },
    });
  }
  current.value ||= next;
}

export function createUnifiedApplication(options = {}) {
  const factory = normalizeUnifiedFactoryOptions(options);
  const app = options.httpApp || rawnodeHttp({ profile: factory.protocolProfiles.http, ...factory.http });
  const ws = options.wsApp || options.websocketApp || new SocketIOSkin(null, ownedWebSocketOptions(factory));
  const tcp = options.tcpApp || new SocketSkin({ profile: factory.protocolProfiles.tcp, ...factory.tcp });
  const udp = options.udpApp || new UdpApp(ownedUdpOptions(factory));
  const original = captureHttpApi(app);
  const manager = new UnifiedServer(app, { http: app, ws, tcp, udp }, factory, original);
  const startupApi = { value: null };

  define(app, kOriginal, original);
  define(app, kUnified, manager);
  define(app, 'http', app);
  define(app, 'ws', ws);
  define(app, 'tcp', tcp);
  define(app, 'udp', udp);
  define(app, 'unified', manager);

  app.start = function start(startOptions = {}) {
    claimStartupApi(manager, startupApi, 'start');
    return manager.start(startOptions);
  };

  app.listen = function listen(...args) {
    claimStartupApi(manager, startupApi, 'listen');
    const { options: listenOptions, callback } = parseListenArguments(args);
    const promise = manager.start(listenOptions);
    promise.then(() => callback?.()).catch((error) => manager.emit('listenError', error));
    return manager;
  };

  app.ready = function ready() {
    const httpReady = original.ready();
    if (manager.state === 'failed' || manager.state === 'closed') {
      return manager.ready().then(() => app);
    }
    if (!manager._startPromise) return Promise.resolve(httpReady).then(() => app);
    return Promise.all([httpReady, manager.ready()]).then(() => app);
  };
  app.boot = app.ready;

  app.beginDrain = function beginDrain(drainOptions = {}) { manager.beginDrain(drainOptions); return app; };
  app.waitForIdle = function waitForIdle(timeoutMs = 0) { return manager.waitForIdle(timeoutMs).then(() => app); };
  app.drain = function drain(drainOptions = {}) {
    manager.beginDrain(drainOptions);
    return manager.waitForIdle(drainOptions.timeoutMs || 0).then(() => manager.health());
  };
  app.close = function close(closeOptions = {}) { return manager.close(closeOptions); };
  app.gracefulClose = function gracefulClose(closeOptions = {}) { return manager.gracefulClose(closeOptions); };
  app.address = function address() { return manager.address(); };
  app.addresses = function addresses() { return manager.addresses(); };
  app.health = function health() { return manager.health(); };
  app.metrics = function metrics(format = 'snapshot') { return manager.metricsOutput(format); };
  app.metricsText = function metricsText() { return manager.metricsOutput('prometheus'); };
  app.diagnostics = function diagnostics() { return manager.diagnosticsSnapshot(); };
  app.snapshot = function snapshot() { return manager.snapshot(); };
  app.useUnifiedPlugin = function useUnifiedPlugin(plugin) { manager.use(plugin); return app; };
  app.ref = function ref() { manager.ref(); return app; };
  app.unref = function unref() { manager.unref(); return app; };
  app.getUnifiedServer = function getUnifiedServer() { return manager; };

  app.manageSignals = function manageSignals(signalOptions = {}) {
    const signalManager = signalOptions instanceof SignalManager
      ? signalOptions
      : new SignalManager(app, signalOptions);
    signalManager.install();
    app._signalManagers?.add?.(signalManager);
    return signalManager;
  };

  manager.on('state', (event) => app.emit?.('unified:state', event));
  manager.on('starting', (event) => app.emit?.('unified:starting', event));
  manager.on('listening', (event) => app.emit?.('unified:listening', event));
  manager.on('draining', (event) => app.emit?.('unified:draining', event));
  manager.on('close', (event) => app.emit?.('unified:close', event));
  manager.on('unifiedError', (event) => app.emit?.('unified:error', event.error, event));

  return app;
}

export { kUnified as UNIFIED_SERVER_SYMBOL, kOriginal as ORIGINAL_HTTP_API_SYMBOL };
export default createUnifiedApplication;
