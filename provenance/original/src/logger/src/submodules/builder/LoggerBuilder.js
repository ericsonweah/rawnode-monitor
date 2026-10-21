'use strict';

import AdvancedLogger from '../advanced-logger/index.js';
import Config from '../config/index.js';

class LoggerBuilder {
  constructor() {
    this.options = {
      profile: 'v1',
      level: 'info',
      transports: [],
      serialize: false,
      colors: true,
      mode: 'json',
      context: {},
      tags: [],
    };
    this.plugins = [];
    this.processors = [];
  }

  profile(name = 'v1') { this.options.profile = name; return this; }
  level(name = 'info') { this.options.level = name; return this; }
  transport(instance, options = {}) {
    if (!instance) throw new TypeError('LoggerBuilder.transport requires a transport.');
    this.options.transports.push(instance);
    if (Object.keys(options).length) {
      this.options.transportOptions ||= new Map();
      this.options.transportOptions.set(instance, options);
    }
    return this;
  }
  transports(instances = []) { for (const instance of instances) this.transport(instance); return this; }
  serialize(enable = true) { this.options.serialize = enable; return this; }
  mode(mode = 'object') { this.options.mode = mode; return this; }
  useColors(enable = true) { this.options.colors = enable; return this; }
  withProfile(name) { Config.setProfile(name); this.options.profile = name === 'default' || name === 'dark' ? 'v1' : name; return this; }
  context(values = {}) { Object.assign(this.options.context, values); return this; }
  tag(...tags) { this.options.tags.push(...tags.flat().map(String)); return this; }
  channel(name) { this.options.channel = name; return this; }
  service(name) { this.options.service = name; return this; }
  environment(name) { this.options.environment = name; return this; }
  queue(options = {}) { this.options.queue = { ...(this.options.queue || {}), ...options }; return this; }
  security(options = {}) { this.options.security = { ...(this.options.security || {}), ...options }; return this; }
  formatter(formatter) { this.options.formatter = formatter; return this; }
  processor(processor, options = {}) { this.processors.push({ processor, ...options }); return this; }
  use(processor, options = {}) { return this.processor(processor, options); }
  plugin(plugin) { this.plugins.push(plugin); return this; }

  done() {
    const logger = new AdvancedLogger({ ...this.options, processorList: this.processors, pluginList: this.plugins });
    const map = this.options.transportOptions;
    if (map) {
      for (const [transport, options] of map) {
        const adapter = logger.runtime.dispatcher.adapters.find((item) => item.transport === transport);
        if (adapter) Object.assign(adapter, options);
      }
    }
    return logger;
  }

  build() { return this.done(); }
}

export default LoggerBuilder;
