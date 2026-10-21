'use strict';

import AdvancedLogger from '../../submodules/advanced-logger/index.js';
import Config from '../../submodules/config/index.js';

/** Fluent, dependency-free logger builder. Every method is additive. */
export class LoggerBuilder {
  constructor(options = {}) {
    this.options = {
      level: 'info',
      transports: [],
      serialize: false,
      colors: false,
      mode: 'object',
      profile: 'production',
      context: {},
      tags: [],
      ...options,
    };
    this._transports = [];
    this._processors = [];
    this._plugins = [];

    for (const transport of options.transports || []) this.transport(transport);
  }

  level(name = 'info') { this.options.level = name; return this; }
  profile(name = 'v1') { this.options.profile = name; return this; }
  production() { return this.profile('production'); }
  strict() { return this.profile('strict'); }
  testing() { return this.profile('test'); }
  serverless() { return this.profile('serverless'); }
  serialize(enabled = true) { this.options.serialize = enabled; return this; }
  mode(value = 'object') { this.options.mode = value; return this; }
  useColors(enabled = true) { this.options.colors = enabled; return this; }
  colors(enabled = true) { return this.useColors(enabled); }
  withProfile(name) { Config.setProfile(name); this.options.colorProfile = name; return this; }
  service(name) { this.options.service = name; return this; }
  environment(name) { this.options.environment = name; return this; }
  channel(name) { this.options.channel = name; return this; }
  context(values = {}) { this.options.context = { ...(this.options.context || {}), ...values }; return this; }
  tag(...tags) { this.options.tags = [...(this.options.tags || []), ...tags.flat().map(String)]; return this; }
  queue(options = {}) { this.options.queue = { ...(this.options.queue || {}), ...options }; return this; }
  pipelineQueue(options = {}) { this.options.pipelineQueue = { ...(this.options.pipelineQueue || {}), ...options }; return this; }
  transportQueue(options = {}) { this.options.transportQueue = { ...(this.options.transportQueue || {}), ...options }; return this; }
  circuitBreaker(options = {}) { this.options.circuitBreaker = { ...(this.options.circuitBreaker || {}), ...options }; return this; }
  security(options = {}) { this.options.security = { ...(this.options.security || {}), ...options }; return this; }
  redaction(options = true) {
    if (options === false) this.options.security = { ...(this.options.security || {}), redact: false, enabled: false };
    else this.options.security = { ...(this.options.security || {}), redact: true, enabled: true, ...(options === true ? {} : options) };
    return this;
  }
  sanitization(options = true) {
    if (options === false) this.options.security = { ...(this.options.security || {}), sanitizeControls: false };
    else this.options.security = { ...(this.options.security || {}), sanitizeControls: true, ...(options === true ? {} : options) };
    return this;
  }
  metrics(options = true) {
    this.options.observability = options === true
      ? { ...(this.options.observability || {}), enabled: true }
      : options === false
        ? { ...(this.options.observability || {}), enabled: false }
        : { ...(this.options.observability || {}), ...(options || {}) };
    return this;
  }
  formatter(formatter) { this.options.formatter = formatter; return this; }
  awaitDelivery(enabled = true) { this.options.awaitTransportDelivery = enabled; return this; }

  transport(transport, options = {}) {
    if (!transport) throw new TypeError('LoggerBuilder.transport requires a transport.');
    this._transports.push({ transport, options: { ...(options || {}) } });
    return this;
  }

  transports(...transports) {
    for (const transport of transports.flat()) this.transport(transport);
    return this;
  }

  processor(processor, options = {}) {
    if (typeof processor !== 'function') throw new TypeError('LoggerBuilder.processor requires a function.');
    this._processors.push({ processor, ...options });
    return this;
  }

  use(processor, options = {}) { return this.processor(processor, options); }

  plugin(plugin) {
    if (!plugin || typeof plugin !== 'object') throw new TypeError('LoggerBuilder.plugin requires an object.');
    this._plugins.push(plugin);
    return this;
  }

  done() { return this.build(); }

  build() {
    const logger = new AdvancedLogger({
      ...this.options,
      transports: [],
      processorList: this._processors,
      pluginList: this._plugins,
    });
    for (const { transport, options } of this._transports) logger.addTransport(transport, options);
    return logger;
  }
}

export default LoggerBuilder;
