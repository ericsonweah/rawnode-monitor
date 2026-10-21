'use strict';

import defaultConfig from '../../../config/logger.js';
import LoggerConfiguration from '../config/LoggerConfiguration.js';
import ChannelManager from '../channels/ChannelManager.js';
import SwappableLogger from './SwappableLogger.js';
import ProcessErrorHandler from './ProcessErrorHandler.js';
import LoggerHealth from '../observability/LoggerHealth.js';

function safeResolve(app, key, fallback = undefined) {
  try { return app?.resolve?.(key) ?? fallback; } catch { return fallback; }
}

function configGet(config, key, fallback = undefined) {
  try {
    if (typeof config?.get === 'function') {
      const value = config.get(key);
      return value === undefined ? fallback : value;
    }
  } catch {}
  const parts = String(key).split('.');
  let current = config;
  for (const part of parts) current = current?.[part];
  return current === undefined ? fallback : current;
}

function bind(app, key, value) {
  if (typeof app?.instance === 'function') return app.instance(key, value);
  if (typeof app?.singleton === 'function') return app.singleton(key, () => value);
  if (typeof app?.bind === 'function') return app.bind(key, () => value);
  if (app?.container && typeof app.container.instance === 'function') return app.container.instance(key, value);
  throw new Error(`RawNode application cannot bind logger service [${key}].`);
}

function tryBind(app, key, value) {
  try { return bind(app, key, value); } catch { return null; }
}

/** RawNode service provider for configuration-driven logging channels. */
export class LoggerServiceProvider {
  static dependencies = ['app'];
  static priority = -1000;

  constructor(app, options = {}) {
    this.app = app;
    this.options = options;
    this.configuration = null;
    this.manager = null;
    this.logger = options.proxy || new SwappableLogger();
    this.processErrors = null;
  }

  async register() {
    const configService = safeResolve(this.app, 'config', {});
    const supplied = this.options.config
      || configGet(configService, 'logger', null)
      || configGet(configService, 'logging', null)
      || defaultConfig;

    this.configuration = supplied instanceof LoggerConfiguration
      ? supplied
      : new LoggerConfiguration(supplied, { defaults: defaultConfig, strict: this.options.strictConfig !== false });

    const snapshot = this.configuration.snapshot();
    this.manager = new ChannelManager({
      default: snapshot.channel || snapshot.default || 'stack',
      channels: snapshot.channels,
      drivers: this.options.drivers,
      loggerFactory: this.options.loggerFactory,
      base: {
        profile: snapshot.profile,
        level: snapshot.level,
        service: this.options.service
          || (!(supplied instanceof LoggerConfiguration) ? supplied?.service : null)
          || configGet(configService, 'app.name', null)
          || snapshot.service
          || process.env.APP_NAME
          || 'rawnode',
        environment: this.options.environment
          || (!(supplied instanceof LoggerConfiguration) ? supplied?.environment : null)
          || configGet(configService, 'app.env', null)
          || snapshot.environment
          || process.env.APP_ENV
          || process.env.NODE_ENV
          || 'development',
        security: {
          enabled: snapshot.security?.redact !== false,
          redact: snapshot.security?.redact !== false,
          sanitizeControls: snapshot.security?.sanitize !== false,
          ...(snapshot.security || {}),
        },
        queue: snapshot.queue,
        observability: snapshot.metrics || snapshot.observability,
      },
    });
    this.manager.setBindingResolver((key) => safeResolve(this.app, key, null));

    const target = this.manager.channel(this.manager.default());
    this.logger.swap(target);

    bind(this.app, 'logger', this.logger);
    tryBind(this.app, 'log', this.logger);
    tryBind(this.app, 'Logger', this.logger);
    tryBind(this.app, 'logger.manager', this.manager);
    tryBind(this.app, 'logger.channels', this.manager);
    tryBind(this.app, 'logger.configuration', this.configuration);
    tryBind(this.app, 'logger.health', new LoggerHealth(this.logger));
    tryBind(this.app, 'logger.channel', (name) => this.manager.channel(name));

    const processOptions = snapshot.processErrors || {};
    if (processOptions.enabled === true) {
      this.processErrors = new ProcessErrorHandler(this.logger, {
        uncaughtException: processOptions.uncaughtException !== false,
        unhandledRejection: processOptions.unhandledRejection !== false,
        warning: processOptions.warning === true,
        exitOnUncaught: processOptions.exitOnUncaught === true,
        flushTimeoutMs: processOptions.flushTimeoutMs,
      });
      tryBind(this.app, 'logger.processErrors', this.processErrors);
    }

    return this.logger;
  }

  async boot() {
    await this.logger.ready?.();
    this.processErrors?.attach();
  }

  async tearDown(options = {}) {
    this.processErrors?.detach();
    await this.manager?.close?.(options);
  }

  async shutdown(options = {}) { return await this.tearDown(options); }
}

export default LoggerServiceProvider;
