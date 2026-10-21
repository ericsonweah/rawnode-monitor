'use strict';

import { LiveEventsBridge } from './LiveEventsBridge.js';
import { SdspaEventsBridge } from './SdspaEventsBridge.js';
import { ReactiveEventsBridge } from './ReactiveEventsBridge.js';
import { ViewEventsBridge } from './ViewEventsBridge.js';

export class BrowserIntegrationManager {
  constructor(fabric, options = {}) {
    this.fabric = fabric;
    this.options = options;
    this.integrations = new Map();
    this.started = false;
    this.register('live', options.live === false ? null : new LiveEventsBridge(fabric, object(options.live)));
    this.register('sdspa', options.sdspa === false ? null : new SdspaEventsBridge(fabric, object(options.sdspa)));
    this.register('reactive', options.reactive === false ? null : new ReactiveEventsBridge(fabric, object(options.reactive)));
    this.register('view', options.view === false ? null : new ViewEventsBridge(fabric, object(options.view)));
    for (const integration of options.integrations || []) this.register(integration.id || integration.name, integration);
  }
  register(id, integration, options = {}) {
    if (!integration) return this;
    const key = String(id || integration.id || integration.constructor?.name || '').trim();
    if (!key) throw new TypeError('Browser integration requires an id.');
    if (this.integrations.has(key) && options.replace !== true) throw Object.assign(new Error(`Browser event integration already exists: ${key}`), { code: 'EVENT_BROWSER_INTEGRATION_DUPLICATE' });
    this.integrations.set(key, integration);
    return this;
  }
  async install(options = {}) {
    const entries = Array.isArray(options)
      ? options
      : Array.isArray(options.integrations)
        ? options.integrations
        : [];
    for (const integration of entries) {
      if (!integration) continue;
      this.register(integration.id || integration.name, integration, {
        replace: options.replace === true || integration.replace === true,
      });
    }
    if (options.start !== false) await this.start();
    return this;
  }

  async start() {
    if (this.started) return this;
    for (const integration of this.integrations.values()) await integration.start?.();
    this.started = true;
    return this;
  }
  async close() {
    for (const integration of [...this.integrations.values()].reverse()) await integration.close?.();
    this.started = false;
    return this.snapshot();
  }
  snapshot() { return Object.freeze({ started: this.started, integrations: Object.fromEntries([...this.integrations].map(([id, integration]) => [id, integration.snapshot?.() || { id, started: null }])) }); }
}
function object(value) { return value && typeof value === 'object' ? value : {}; }
export default BrowserIntegrationManager;
