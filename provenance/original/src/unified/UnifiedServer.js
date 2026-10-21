'use strict';

import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { HybridServer, SecureHybridServer } from '#tcp';
import { normalizeUnifiedStartOptions } from './config/normalizeUnifiedOptions.js';
import { UnifiedDiagnostics } from './observability/UnifiedDiagnostics.js';
import { UnifiedMetrics } from './observability/UnifiedMetrics.js';
import { UNIFIED_STATE, UnifiedStateMachine } from './lifecycle/UnifiedState.js';
import {
  UnifiedShutdownError,
  UnifiedStartupError,
  UnifiedStateError,
  safeError,
} from './errors/UnifiedError.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function withTimeout(promise, timeoutMs, createError) {
  if (!(Number(timeoutMs) > 0)) return Promise.resolve(promise);
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(createError()), Number(timeoutMs));
      timer.unref?.();
    }),
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

function isAddress(value) {
  return value && typeof value === 'object' && Number.isInteger(value.port);
}

function protocolHealth(configured, active, native, extra = null, failure = null, required = false) {
  const health = active && typeof native?.health === 'function' ? native.health() : null;
  return {
    enabled: configured === true,
    active: active === true,
    required: required === true,
    ready: active === true && (health ? health.ready !== false && health.ok !== false : true),
    draining: health?.draining === true,
    degraded: !!failure,
    failure,
    health,
    ...(extra || {}),
  };
}

function closeCode(error) {
  return error?.code || error?.cause?.code || null;
}

function retryablePortConflict(error) {
  return ['EADDRINUSE', 'EACCES'].includes(closeCode(error));
}

const PROTOCOL_NAMES = Object.freeze(['http', 'websocket', 'tcp', 'udp']);
const TCP_SIDE_PROTOCOLS = Object.freeze(['http', 'websocket', 'tcp']);

function enabledProtocolNames(protocols) {
  return PROTOCOL_NAMES.filter((name) => protocols?.[name] === true);
}

function aggregateFailures(results, message) {
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (!failures.length) return null;
  return new AggregateError(failures, message);
}

function pluginName(plugin, index = 0) {
  return String(plugin?.name || plugin?.constructor?.name || `plugin-${index + 1}`);
}

export class UnifiedServer extends EventEmitter {
  constructor(app, protocols, factoryOptions, original) {
    super();
    this.app = app;
    this.protocols = protocols;
    this.factoryOptions = factoryOptions;
    this.original = original;
    this.ownership = { ...factoryOptions.ownership };
    this.stateMachine = new UnifiedStateMachine(UNIFIED_STATE.IDLE, (event) => {
      this.metrics.set('state', stateNumber(event.current));
      this.diagnostics.record('state-transition', event);
      this.emit('state', event);
    });
    this.metrics = new UnifiedMetrics(factoryOptions.observability);
    this.diagnostics = new UnifiedDiagnostics(factoryOptions.observability);
    this.startedAt = 0;
    this.closedAt = 0;
    this.lastError = null;
    this.lastOptions = null;
    this.startAttempts = 0;
    this.rollbackCount = 0;
    this.forcedShutdowns = 0;
    this._startPromise = null;
    this._closePromise = null;
    this._attempt = null;
    this.httpServer = null;
    this.hybrid = null;
    this._address = null;
    this._draining = false;
    this._forced = false;
    this._degraded = false;
    this._protocolFailures = Object.create(null);
    this._activeProtocols = Object.freeze({ http: false, websocket: false, tcp: false, udp: false });
    this.plugins = [];
    for (const plugin of factoryOptions.plugins || []) this.use(plugin);
  }

  get state() { return this.stateMachine.value; }
  get listening() { return this.state === UNIFIED_STATE.LISTENING; }
  get draining() { return this._draining || this.state === UNIFIED_STATE.DRAINING || this.state === UNIFIED_STATE.CLOSING; }
  get degraded() { return this._degraded; }

  use(plugin) {
    if (![UNIFIED_STATE.IDLE, UNIFIED_STATE.FAILED].includes(this.state)) {
      throw new UnifiedStateError('Unified plugins must be registered before startup.', {
        code: 'UNIFIED_PLUGIN_REGISTRATION_CLOSED',
        details: { state: this.state },
      });
    }
    if (!plugin) throw new TypeError('Unified plugin is required.');
    let candidate = plugin;
    if (typeof plugin === 'function') {
      const installed = plugin(this);
      if (installed && typeof installed.then === 'function') {
        throw new TypeError('Unified plugin setup functions must be synchronous; use lifecycle hooks for async work.');
      }
      if (installed == null) return this;
      candidate = installed;
    }
    if (!candidate || typeof candidate !== 'object') {
      throw new TypeError('Unified plugin must be an object or a synchronous setup function.');
    }
    this.plugins.push(candidate);
    this.diagnostics.record('plugin-registered', { name: pluginName(candidate, this.plugins.length - 1) });
    return this;
  }

  async _runHooks(name, payload = null, { isolate = false } = {}) {
    for (let index = 0; index < this.plugins.length; index++) {
      const plugin = this.plugins[index];
      const hook = plugin?.[name];
      if (typeof hook !== 'function') continue;
      try {
        await hook.call(plugin, payload, this);
      } catch (error) {
        this.metrics.inc('plugin_hook_failures_total');
        this.diagnostics.record('plugin-hook-error', {
          plugin: pluginName(plugin, index), hook: name, error,
        }, isolate ? 'warn' : 'error');
        if (!isolate) throw error;
      }
    }
  }

  _isOptional(name, options = this.lastOptions) {
    return options?.startup?.optionalProtocols?.includes(name) === true;
  }

  _isRequired(name, options = this.lastOptions) {
    return options?.protocols?.[name] === true && !this._isOptional(name, options);
  }

  _recordProtocolFailure(name, error, phaseName, options) {
    const failure = Object.freeze({
      protocol: name,
      optional: this._isOptional(name, options),
      phase: phaseName,
      error: safeError(error),
      at: Date.now(),
    });
    this._protocolFailures[name] = failure;
    this._degraded = true;
    this.metrics.inc('protocol_failures_total');
    this.metrics.inc(`protocol_${name}_failures_total`);
    this.metrics.set('degraded', 1);
    this.diagnostics.record('protocol-degraded', failure, 'warn');
    this.emit('protocolDegraded', failure);
    return failure;
  }

  _optionalFailureCanContinue(names, options) {
    const enabled = names.filter((name) => options.protocols[name] === true);
    return enabled.length > 0 && enabled.every((name) => this._isOptional(name, options));
  }

  ready() {
    if (this.state === UNIFIED_STATE.LISTENING) return Promise.resolve(this);
    if (this._startPromise) return this._startPromise;
    return Promise.reject(new UnifiedStateError('RawNode Unified has not been started.', {
      code: 'UNIFIED_NOT_STARTED', details: { state: this.state },
    }));
  }

  start(input = {}) {
    if (this.state === UNIFIED_STATE.CLOSED) {
      return Promise.reject(new UnifiedStateError('RawNode Unified is closed and cannot be restarted.', { code: 'UNIFIED_CLOSED' }));
    }
    if (this.state === UNIFIED_STATE.LISTENING) return Promise.resolve(this);
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._start(input).catch((error) => {
      this._startPromise = null;
      throw error;
    });
    return this._startPromise;
  }

  async _start(input) {
    const options = normalizeUnifiedStartOptions(this.factoryOptions, input);
    this.lastOptions = options;
    this._draining = false;
    this._forced = false;
    this._degraded = false;
    this._protocolFailures = Object.create(null);
    this._activeProtocols = Object.freeze({ http: false, websocket: false, tcp: false, udp: false });
    this.lastError = null;
    this.metrics.set('degraded', 0);
    this.stateMachine.transition(UNIFIED_STATE.STARTING, { host: options.host, port: options.port, protocols: options.protocols });
    this.emit('starting', { options });
    this.diagnostics.record('startup-begin', { options });
    this.metrics.inc('starts_total');
    const started = performance.now();

    try {
      await this._runHooks('beforeStart', { options, app: this.app });
      await this.original.ready();
      const maxAttempts = options.port === 0 ? options.startup.maxPortAttempts : 1;
      let lastFailure = null;
      for (let index = 1; index <= maxAttempts; index++) {
        this.startAttempts++;
        this.metrics.inc('startup_attempts_total');
        try {
          await this._startAttempt(options, index);
          this.startedAt = Date.now();
          this.metrics.observe('startup_duration_ms', performance.now() - started);
          this.metrics.set('ready', 1);
          this.stateMachine.transition(UNIFIED_STATE.LISTENING, { attempt: index, addresses: this.addresses() });
          this.emit('listening', this.addresses());
          this.diagnostics.record('startup-committed', {
            attempt: index,
            addresses: this.addresses(),
            degraded: this._degraded,
            protocolFailures: this._protocolFailures,
          });
          await this._runHooks('afterStart', { options, server: this, health: this.health() }, { isolate: true });
          return this;
        } catch (error) {
          lastFailure = error;
          await this._rollbackAttempt(error, options);
          const retry = options.port === 0 && error?.phase === 'udp-bind' && retryablePortConflict(error) && index < maxAttempts;
          this.diagnostics.record('startup-attempt-failed', { attempt: index, retry, error }, retry ? 'warn' : 'error');
          if (!retry) throw error;
          this.metrics.inc('startup_retries_total');
          await sleep(Math.min(25 * index, 100));
        }
      }
      throw lastFailure || new UnifiedStartupError('RawNode Unified exhausted startup attempts.', { code: 'UNIFIED_STARTUP_ATTEMPTS_EXHAUSTED' });
    } catch (error) {
      this.lastError = safeError(error);
      this.metrics.inc('startup_failures_total');
      this.metrics.set('ready', 0);
      this.stateMachine.transition(UNIFIED_STATE.FAILED, { error: this.lastError });
      this._emitError(error, 'startup');
      throw error instanceof UnifiedStartupError
        ? error
        : new UnifiedStartupError(`RawNode Unified startup failed: ${error?.message || error}`, {
            code: 'UNIFIED_STARTUP_FAILED', cause: error, details: { phase: error?.phase || null, host: options.host, port: options.port },
          });
    }
  }

  async _startAttempt(options, attemptNumber) {
    const attempt = {
      number: attemptNumber,
      httpServer: null,
      hybrid: null,
      wsAttached: false,
      udpBound: false,
      committed: false,
      address: null,
      enabled: { ...options.protocols },
    };
    this._attempt = attempt;
    let needsTcpListener = TCP_SIDE_PROTOCOLS.some((name) => attempt.enabled[name]);
    let selectedPort = options.port;

    if (needsTcpListener && attempt.enabled.http) {
      try {
        attempt.httpServer = this.original.createServer({
          ...(options.http.server || {}),
          externalTransport: true,
        });
      } catch (error) {
        const affected = ['http', 'websocket'].filter((name) => attempt.enabled[name]);
        if (!this._optionalFailureCanContinue(affected, options)) throw phase(error, 'http-create');
        for (const name of affected) {
          this._recordProtocolFailure(name, error, 'http-create', options);
          attempt.enabled[name] = false;
        }
      }
    }

    needsTcpListener = TCP_SIDE_PROTOCOLS.some((name) => attempt.enabled[name]);
    if (needsTcpListener) {
      try {
        attempt.hybrid = this._createHybrid(options, attempt.httpServer, attempt.enabled);
        attempt.hybrid.on('error', (error) => this._emitError(error, 'tcp-listener'));
        attempt.hybrid.on('protocolError', (error, socket, context) => this.emit('protocolError', error, socket, context));
        attempt.hybrid.on('classification', (entry) => this.emit('classification', entry));
        await attempt.hybrid.listenAsync(options.port, options.host, options.backlog);
        attempt.address = attempt.hybrid.address();
        if (!isAddress(attempt.address)) throw new Error('TCP listener did not return a numeric address.');
        selectedPort = attempt.address.port;
      } catch (error) {
        const affected = TCP_SIDE_PROTOCOLS.filter((name) => attempt.enabled[name]);
        if (!this._optionalFailureCanContinue(affected, options)) throw phase(error, 'tcp-bind');
        for (const name of affected) {
          this._recordProtocolFailure(name, error, 'tcp-bind', options);
          attempt.enabled[name] = false;
        }
        try { await attempt.hybrid?.close?.({ graceful: false, drainSkin: false, timeoutMs: 1, forceCloseTimeoutMs: 0 }); } catch {}
        try { await attempt.httpServer?.gracefulClose?.({ timeoutMs: 1, force: true, closeUpgrades: true }); } catch {}
        attempt.hybrid = null;
        attempt.httpServer = null;
        attempt.address = null;
        needsTcpListener = false;
      }
    }

    // Fixed startup order: bind the TCP listener first, then the same numeric
    // UDP port, and only then register WebSocket in the HTTP upgrade pipeline.
    if (attempt.enabled.udp) {
      try {
        this.protocols.udp.deactivate?.();
        const udpAddress = await this.protocols.udp.listen(selectedPort, options.host);
        attempt.udpBound = true;
        if (!needsTcpListener) {
          attempt.address = udpAddress;
          selectedPort = udpAddress.port;
        }
      } catch (error) {
        if (!this._isOptional('udp', options)) throw phase(error, 'udp-bind');
        this._recordProtocolFailure('udp', error, 'udp-bind', options);
        attempt.enabled.udp = false;
      }
    }

    if (attempt.enabled.websocket) {
      try {
        if (!attempt.httpServer || !attempt.hybrid) {
          throw new UnifiedStartupError('WebSocket requires an active HTTP upgrade pipeline.', {
            code: 'UNIFIED_WEBSOCKET_PIPELINE_UNAVAILABLE',
          });
        }
        this.protocols.ws.attachUpgradeRegistry(attempt.httpServer, options.websocket.upgrade || {});
        attempt.wsAttached = true;
      } catch (error) {
        if (!this._isOptional('websocket', options)) throw phase(error, 'websocket-attach');
        try { this.protocols.ws.detachUpgradeRegistry?.(attempt.httpServer); } catch {}
        this._recordProtocolFailure('websocket', error, 'websocket-attach', options);
        attempt.enabled.websocket = false;
      }
    }

    const activeNames = enabledProtocolNames(attempt.enabled);
    if (!activeNames.length) {
      throw new UnifiedStartupError('No protocol remained active after optional startup failures.', {
        code: 'UNIFIED_NO_ACTIVE_PROTOCOLS',
        details: { failures: this._protocolFailures },
      });
    }

    try {
      if (attempt.enabled.websocket && attempt.enabled.udp && options.stun.enabled) {
        this.protocols.ws.attachStun(this.protocols.udp.server || this.protocols.udp.socket || this.protocols.udp);
      }
      if (attempt.enabled.http) attempt.httpServer?.markExternalListening?.(attempt.address);
      attempt.hybrid?.activate?.();
      if (attempt.enabled.udp) this.protocols.udp.activate?.();
      attempt.committed = true;
      this.httpServer = attempt.enabled.http ? attempt.httpServer : null;
      this.hybrid = attempt.hybrid;
      this._address = attempt.address;
      this._activeProtocols = Object.freeze({ ...attempt.enabled });
      this._attempt = null;
      this.metrics.set('tcp_listener_active', needsTcpListener ? 1 : 0);
      this.metrics.set('udp_listener_active', attempt.enabled.udp ? 1 : 0);
      for (const name of PROTOCOL_NAMES) this.metrics.set(`protocol_${name}_active`, attempt.enabled[name] ? 1 : 0);
    } catch (error) { throw phase(error, 'commit'); }
  }

  _createHybrid(options, httpServer, activeProtocols = options.protocols) {
    const tcpOptions = options.tcp || {};
    const serverOptions = {
      ...tcpOptions,
      profile: options.protocolProfiles?.tcp || options.profile,
      server: {
        ...(tcpOptions.server || {}),
        host: options.host,
        port: options.port,
        backlog: options.backlog,
        ipv6Only: options.ipv6Only,
        reusePort: options.reusePort,
      },
      httpServer: httpServer || false,
      http2Server: options.http2.enabled ? options.http2.server : null,
      protocols: {
        http: activeProtocols.http,
        tcp: activeProtocols.tcp,
        http2: options.http2.enabled === true,
        tls: options.tls.enabled === true,
      },
      startPaused: true,
      classification: options.classification,
      proxyProtocol: options.proxyProtocol.enabled ? options.proxyProtocol : false,
      closeSkinOnClose: this.ownership.tcp || options.shutdown.closeExternal,
      closeHttpServerOnClose: false,
      closeTlsServerOnClose: false,
      unknownAlpn: options.tls.unknownAlpn,
      alpnProtocols: options.tls.alpnProtocols,
    };
    if (options.tls.enabled) {
      if (!options.tls.options) {
        throw new UnifiedStartupError('TLS is enabled but no key/certificate options were provided.', { code: 'UNIFIED_TLS_OPTIONS_REQUIRED' });
      }
      return new SecureHybridServer(this.protocols.tcp, this.app, null, {
        ...options.tls.options,
        ALPNProtocols: options.tls.options.ALPNProtocols || options.tls.alpnProtocols,
      }, serverOptions);
    }
    return new HybridServer(this.protocols.tcp, this.app, null, serverOptions);
  }

  async _rollbackAttempt(error, options) {
    const attempt = this._attempt;
    if (!attempt) return;
    this.rollbackCount++;
    this.metrics.inc('startup_rollbacks_total');
    this.diagnostics.record('rollback-begin', { attempt: attempt.number, error }, 'warn');
    try {
      this.protocols.udp.deactivate?.();
      if (attempt.httpServer) this.protocols.ws.detachUpgradeRegistry?.(attempt.httpServer);
      attempt.httpServer?.clearExternalListening?.();
      const work = [];
      if (attempt.hybrid) work.push(attempt.hybrid.close({ graceful: false, drainSkin: false, timeoutMs: 1, forceCloseTimeoutMs: 0 }));
      if (attempt.httpServer) work.push(attempt.httpServer.gracefulClose({ timeoutMs: 1, force: true, closeUpgrades: true }));
      if (attempt.udpBound) {
        work.push(typeof this.protocols.udp.unbind === 'function'
          ? this.protocols.udp.unbind({ timeoutMs: 1 })
          : this.protocols.udp.close?.({ timeoutMs: 1 }));
      }
      await withTimeout(Promise.allSettled(work), options.startup.rollbackTimeoutMs, () => new Error('Unified startup rollback timed out'));
    } catch (rollbackError) {
      this.diagnostics.record('rollback-error', { error: rollbackError }, 'error');
      this._emitError(rollbackError, 'rollback');
    } finally {
      this._attempt = null;
      this.httpServer = null;
      this.hybrid = null;
      this._address = null;
      this._activeProtocols = Object.freeze({ http: false, websocket: false, tcp: false, udp: false });
    }
  }

  beginDrain(options = {}) {
    if ([UNIFIED_STATE.CLOSED, UNIFIED_STATE.CLOSING].includes(this.state)) return this;
    if (!this._draining) {
      void this._runHooks('beforeDrain', { options, server: this }, { isolate: true });
      this._draining = true;
      if (this.state === UNIFIED_STATE.LISTENING) this.stateMachine.transition(UNIFIED_STATE.DRAINING, { options });
      this.metrics.set('ready', 0);
      this.metrics.set('draining', 1);
      this.diagnostics.record('drain-begin', { options });
      this.emit('draining', { deadline: options.deadline || null, addresses: this.addresses() });
      this.protocols.ws.detachUpgradeRegistry(this.httpServer);
      this.httpServer?.beginDrain?.();
      const closeExternal = this.lastOptions?.shutdown?.closeExternal === true;
      if (this.ownership.ws || closeExternal) this.protocols.ws.beginDrain?.(options);
      if (this.ownership.tcp || closeExternal) this.protocols.tcp.beginDrain?.(options);
      this.protocols.udp.beginDrain?.(options);
      this.hybrid?.beginDrain?.({ ...options, drainSkin: false });
    }
    return this;
  }

  async waitForIdle(timeoutMs = 0) {
    const tasks = [
      this.httpServer?.waitForIdle?.(timeoutMs),
      this._activeProtocols.websocket ? this.protocols.ws.waitForIdle?.(timeoutMs) : null,
      this._activeProtocols.tcp ? this.protocols.tcp.waitForIdle?.(timeoutMs) : null,
      this._activeProtocols.udp ? this.protocols.udp.waitForIdle?.(timeoutMs) : null,
    ].filter(Boolean);
    const results = await Promise.allSettled(tasks);
    const failure = aggregateFailures(results, 'One or more RawNode Unified protocols did not become idle.');
    if (failure) throw failure;
    return this;
  }

  close(options = {}) {
    if (this._closePromise) return this._closePromise;
    if (this.state === UNIFIED_STATE.CLOSED) return Promise.resolve(this.health());
    const operation = this.state === UNIFIED_STATE.STARTING && this._startPromise
      ? this._startPromise.catch(() => null).then(() => this._close(options))
      : this._close(options);
    this._closePromise = operation.catch((error) => {
      this._closePromise = null;
      throw error;
    });
    return this._closePromise;
  }

  gracefulClose(options = {}) { return this.close(options); }

  async _close(input = {}) {
    const configured = this.lastOptions || normalizeUnifiedStartOptions(this.factoryOptions, {});
    const shutdown = {
      ...configured.shutdown,
      ...(input || {}),
      timeoutMs: Number(input.timeoutMs ?? configured.shutdown.timeoutMs),
      forceCloseTimeoutMs: Number(input.forceCloseTimeoutMs ?? configured.shutdown.forceCloseTimeoutMs),
      closeExternal: input.closeExternal ?? configured.shutdown.closeExternal,
    };
    await this._runHooks('beforeClose', { shutdown, server: this }, { isolate: true });
    if (this.state === UNIFIED_STATE.IDLE || this.state === UNIFIED_STATE.FAILED) {
      this.stateMachine.transition(UNIFIED_STATE.CLOSING, { idle: true });
    } else {
      this.beginDrain({ timeoutMs: shutdown.timeoutMs, deadline: Date.now() + shutdown.timeoutMs });
      if (this.state !== UNIFIED_STATE.CLOSING) this.stateMachine.transition(UNIFIED_STATE.CLOSING, { timeoutMs: shutdown.timeoutMs });
    }
    this.metrics.inc('closes_total');
    this.diagnostics.record('close-begin', { shutdown });
    const started = performance.now();
    let primaryError = null;

    try {
      await withTimeout(this._gracefulClose(shutdown), shutdown.timeoutMs, () => new UnifiedShutdownError('RawNode Unified shutdown deadline exceeded.', {
        code: 'UNIFIED_SHUTDOWN_TIMEOUT', details: { timeoutMs: shutdown.timeoutMs },
      }));
    } catch (error) {
      primaryError = error;
      if (shutdown.force === false) {
        this.lastError = safeError(error);
        this.metrics.inc('shutdown_failures_total');
        this.stateMachine.transition(UNIFIED_STATE.FAILED, { error: this.lastError, forced: false });
        this._emitError(error, 'shutdown');
        throw error;
      }
      this._forced = true;
      this.forcedShutdowns++;
      this.metrics.inc('forced_shutdowns_total');
      this.diagnostics.record('force-close-begin', { error }, 'warn');
      await this._forceClose(shutdown);
    }

    this.startedAt = 0;
    this.closedAt = Date.now();
    this._address = null;
    this._activeProtocols = Object.freeze({ http: false, websocket: false, tcp: false, udp: false });
    this._draining = false;
    this.metrics.set('ready', 0);
    this.metrics.set('draining', 0);
    this.metrics.set('tcp_listener_active', 0);
    this.metrics.set('udp_listener_active', 0);
    this.metrics.observe('shutdown_duration_ms', performance.now() - started);
    this.stateMachine.transition(UNIFIED_STATE.CLOSED, { forced: this._forced, error: safeError(primaryError) });
    this.emit('close', { forced: this._forced, error: primaryError, health: this.health() });
    this.diagnostics.record('close-complete', { forced: this._forced, error: primaryError }, primaryError ? 'warn' : 'info');
    await this._runHooks('afterClose', { forced: this._forced, error: primaryError, health: this.health() }, { isolate: true });
    this.metrics.close?.();
    return this.health();
  }

  async _gracefulClose(shutdown) {
    await this.waitForIdle(Math.max(0, shutdown.timeoutMs));
    const closeExternal = shutdown.closeExternal === true;
    const tasks = [];

    if (this.hybrid) {
      tasks.push(this.hybrid.close({
        graceful: true,
        timeoutMs: Math.max(1, shutdown.timeoutMs),
        forceCloseTimeoutMs: Math.max(0, shutdown.forceCloseTimeoutMs),
        drainSkin: this.ownership.tcp || closeExternal,
      }));
    }
    if (this.httpServer) tasks.push(this.httpServer.gracefulClose({ timeoutMs: shutdown.timeoutMs, force: true, closeUpgrades: true }));
    if (this.ownership.ws || closeExternal) tasks.push(this.protocols.ws.close?.({ timeoutMs: shutdown.timeoutMs }));
    else this.protocols.ws.detachUpgradeRegistry?.();
    if (this.ownership.udp || closeExternal) tasks.push(this.protocols.udp.close?.({ timeoutMs: shutdown.timeoutMs }));
    else if (this._activeProtocols.udp) tasks.push(this.protocols.udp.unbind?.({ timeoutMs: shutdown.timeoutMs }));
    const results = await Promise.allSettled(tasks.filter(Boolean));
    const failure = aggregateFailures(results, 'One or more RawNode Unified protocols failed graceful shutdown.');
    if (failure) throw failure;

    if (this.ownership.http || closeExternal) {
      await this.original.close({ timeoutMs: shutdown.timeoutMs, force: true });
    }
    this.httpServer = null;
    this.hybrid = null;
  }

  async _forceClose(shutdown) {
    const error = new UnifiedShutdownError('RawNode Unified forced transport closure.', { code: 'UNIFIED_FORCE_CLOSE' });
    try { this.protocols.ws.detachUpgradeRegistry?.(); } catch {}
    for (const socket of this.hybrid?.registry?.sockets || []) {
      try { socket.destroy(error); } catch {}
    }
    await Promise.allSettled([
      this.hybrid?.close?.({ graceful: false, timeoutMs: 1, forceCloseTimeoutMs: 0, drainSkin: this.ownership.tcp || shutdown.closeExternal }),
      this.httpServer?.gracefulClose?.({ timeoutMs: 1, force: true, closeUpgrades: true }),
      (this.ownership.ws || shutdown.closeExternal) ? this.protocols.ws.close?.({ force: true }) : null,
      (this.ownership.udp || shutdown.closeExternal)
        ? this.protocols.udp.close?.({ timeoutMs: 1 })
        : (this._activeProtocols.udp ? this.protocols.udp.unbind?.({ timeoutMs: 1 }) : null),
    ].filter(Boolean));
    if (this.ownership.http || shutdown.closeExternal) {
      try { await this.original.close({ timeoutMs: 1, force: true }); } catch {}
    }
    this.httpServer = null;
    this.hybrid = null;
  }

  address() {
    return this.addresses().tcp || null;
  }

  addresses() {
    const tcp = this.hybrid?.address?.() || (isAddress(this._address) && TCP_SIDE_PROTOCOLS.some((name) => this._activeProtocols[name]) ? this._address : null);
    const udp = this._activeProtocols.udp ? (this.protocols.udp?.address?.() || null) : null;
    const primary = tcp || udp || null;
    return {
      primary,
      tcp,
      udp,
      http: this._activeProtocols.http ? tcp : null,
      websocket: this._activeProtocols.websocket ? tcp : null,
      rawTcp: this._activeProtocols.tcp ? tcp : null,
      sameNumericPort: !!(tcp && udp && tcp.port === udp.port),
    };
  }

  health() {
    const configured = this.lastOptions?.protocols || this.factoryOptions.protocols || { http: true, websocket: true, tcp: true, udp: true };
    const active = this._activeProtocols;
    const httpHealth = active.http ? (this.httpServer?.health?.() || null) : null;
    const http = {
      enabled: configured.http === true,
      active: active.http === true,
      required: this._isRequired('http'),
      ready: active.http === true && httpHealth?.ready !== false && this.state === UNIFIED_STATE.LISTENING,
      draining: httpHealth?.draining === true,
      degraded: !!this._protocolFailures.http,
      failure: this._protocolFailures.http || null,
      health: httpHealth,
    };
    const ws = protocolHealth(
      configured.websocket,
      active.websocket,
      this.protocols.ws,
      null,
      this._protocolFailures.websocket || null,
      this._isRequired('websocket'),
    );
    const tcp = protocolHealth(
      configured.tcp,
      active.tcp,
      this.protocols.tcp,
      { listener: this.hybrid?.health?.() || null },
      this._protocolFailures.tcp || null,
      this._isRequired('tcp'),
    );
    const udp = protocolHealth(
      configured.udp,
      active.udp,
      this.protocols.udp,
      null,
      this._protocolFailures.udp || null,
      this._isRequired('udp'),
    );
    const entries = { http, websocket: ws, tcp, udp };
    const required = Object.values(entries).filter((entry) => entry.required);
    const ready = this.state === UNIFIED_STATE.LISTENING
      && !this._draining
      && required.every((entry) => entry.ready === true)
      && Object.values(active).some(Boolean);
    const degraded = this._degraded || Object.values(entries).some((entry) => entry.degraded);
    return {
      ok: [UNIFIED_STATE.LISTENING, UNIFIED_STATE.STARTING, UNIFIED_STATE.DRAINING].includes(this.state),
      live: this.state !== UNIFIED_STATE.CLOSED,
      ready,
      degraded,
      state: this.state,
      draining: this.draining,
      forced: this._forced,
      startedAt: this.startedAt || 0,
      closedAt: this.closedAt || 0,
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      addresses: this.addresses(),
      protocols: entries,
      protocolFailures: { ...this._protocolFailures },
      pressure: {
        hybrid: this.hybrid?.pressure?.() || null,
        tcp: active.tcp ? (this.protocols.tcp?.pressure?.() || null) : null,
        udp: active.udp ? (this.protocols.udp?.health?.()?.pressure || null) : null,
        websocket: active.websocket
          ? (this.protocols.ws?.snapshot?.({ includeStun: false, includeSignaling: false })?.engine?.pressure || null)
          : null,
      },
      lastError: this.lastError,
    };
  }

  metricsSnapshot() {
    return this.metrics.snapshot({
      state: this.state,
      starts: this.startAttempts,
      rollbacks: this.rollbackCount,
      forcedShutdowns: this.forcedShutdowns,
      degraded: this._degraded,
      activeProtocols: { ...this._activeProtocols },
      protocolFailures: { ...this._protocolFailures },
      protocols: {
        http: this.original.metrics?.('snapshot') || null,
        websocket: this.protocols.ws?.metrics?.() || null,
        tcp: this.protocols.tcp?.metricsSnapshot?.() || this.hybrid?.metrics?.snapshot?.() || null,
        udp: this.protocols.udp?.metrics?.('snapshot') || null,
      },
    });
  }

  metricsOutput(format = 'snapshot') {
    if (format !== 'prometheus') return this.metricsSnapshot();
    const parts = [this.metrics.prometheus({ ready: this.health().ready ? 1 : 0 })];
    try { parts.push(this.original.metrics?.('prometheus') || ''); } catch {}
    try { parts.push(this.protocols.udp?.metrics?.('prometheus') || ''); } catch {}
    try { parts.push(this.hybrid?.metrics?.prometheus?.() || this.protocols.tcp?.metrics?.prometheus?.() || ''); } catch {}
    try { parts.push(this.protocols.ws?.metrics?.('prometheus') || ''); } catch {}
    return parts.filter((entry) => typeof entry === 'string' && entry.trim()).join('\n');
  }

  diagnosticsSnapshot() {
    return this.diagnostics.snapshot({
      lifecycle: this.stateMachine.snapshot(),
      health: this.health(),
      metrics: this.metricsSnapshot(),
      startup: {
        attempts: this.startAttempts,
        rollbacks: this.rollbackCount,
        options: this.lastOptions,
        activeProtocols: { ...this._activeProtocols },
        protocolFailures: { ...this._protocolFailures },
      },
      plugins: this.plugins.map((plugin, index) => pluginName(plugin, index)),
      native: {
        http: this.httpServer?.diagnostics?.() || this.original.diagnostics?.() || null,
        websocket: this.protocols.ws?.snapshot?.() || null,
        tcp: this.hybrid?.snapshot?.() || null,
        udp: this.protocols.udp?.diagnostics?.() || null,
      },
    });
  }

  snapshot() {
    return Object.freeze({
      state: this.state,
      health: this.health(),
      metrics: this.metricsSnapshot(),
      diagnostics: this.diagnosticsSnapshot(),
    });
  }

  ref() { this.hybrid?.ref?.(); this.protocols.udp?.ref?.(); return this; }
  unref() { this.hybrid?.unref?.(); this.protocols.udp?.unref?.(); return this; }
  async [Symbol.asyncDispose]() { await this.close(); }

  _emitError(error, phaseName) {
    this.lastError = safeError(error);
    const payload = { error, phase: phaseName, at: Date.now() };
    void this._runHooks('onError', payload, { isolate: true });
    if (this.listenerCount('error') > 0) this.emit('error', error, payload);
    else this.emit('unifiedError', payload);
  }
}

function phase(error, name) {
  if (error && typeof error === 'object') {
    try { error.phase = name; } catch {}
    return error;
  }
  const wrapped = new Error(String(error));
  wrapped.phase = name;
  return wrapped;
}

function stateNumber(value) {
  return ({ idle: 0, starting: 1, listening: 2, draining: 3, closing: 4, closed: 5, failed: 6 })[value] ?? -1;
}

export default UnifiedServer;
