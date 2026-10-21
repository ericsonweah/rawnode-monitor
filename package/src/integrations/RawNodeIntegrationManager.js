'use strict';

import { safeResolve } from '../support.js';
import EventMonitorBridge from './EventMonitorBridge.js';
import LoggerMonitorBridge from './LoggerMonitorBridge.js';
import PMMonitorBridge from './PMMonitorBridge.js';
import ProtocolMonitorBridge from './ProtocolMonitorBridge.js';

export class RawNodeIntegrationManager {
  constructor(app, monitor, options = {}) { this.app = app; this.monitor = monitor; this.options = options; this.bridges = new Map(); this.started = false; this.stats = { attached: 0, skipped: 0, errors: 0 }; }

  attach(name, bridge) { if (!bridge) return null; try { bridge.start?.(); this.bridges.set(name, bridge); this.stats.attached++; return bridge; } catch (error) { this.stats.errors++; if (this.options.failFast) throw error; return null; } }

  start() {
    if (this.started) return this;
    const settings = this.monitor.configuration.get('integrations', {});
    if (settings.events !== false) {
      const events = this.options.services?.events || safeResolve(this.app, 'events');
      events ? this.attach('events', new EventMonitorBridge(events, this.monitor, typeof settings.events === 'object' ? settings.events : {})) : this.stats.skipped++;
    }
    if (settings.logger !== false) {
      const logger = this.options.services?.logger || safeResolve(this.app, 'logger') || this.app?.logger;
      logger ? this.attach('logger', new LoggerMonitorBridge(logger, this.monitor, typeof settings.logger === 'object' ? settings.logger : {})) : this.stats.skipped++;
    }
    if (settings.pm !== false) {
      const pm = this.options.services?.pm || safeResolve(this.app, 'pm.manager') || safeResolve(this.app, 'pm.runtime');
      pm ? this.attach('pm', new PMMonitorBridge(pm, this.monitor, typeof settings.pm === 'object' ? settings.pm : {})) : this.stats.skipped++;
    }
    for (const [name, keys] of Object.entries({ websocket: ['ws', 'websocket', 'ws.server'], tcp: ['tcp', 'tcp.server'], udp: ['udp', 'udp.server'], unified: ['unified', 'unified.server'] })) {
      if (settings[name] === false) continue;
      const resource = this.options.services?.[name] || keys.map((key) => safeResolve(this.app, key)).find(Boolean);
      if (resource) this.attach(name, new ProtocolMonitorBridge(resource, this.monitor, { name, ...(typeof settings[name] === 'object' ? settings[name] : {}) }));
      else this.stats.skipped++;
    }
    this.started = true; return this;
  }

  get(name) { return this.bridges.get(String(name)) || null; }
  async close() { for (const bridge of Array.from(this.bridges.values()).reverse()) { try { await bridge.close?.(); } catch { this.stats.errors++; } } this.bridges.clear(); this.started = false; }
  snapshot() { return Object.freeze({ started: this.started, bridges: Object.freeze(Array.from(this.bridges.entries(), ([name, bridge]) => ({ name, snapshot: bridge.snapshot?.() || null }))), stats: Object.freeze({ ...this.stats }) }); }
}

export function registerRawNodeIntegrations(app, monitor, options = {}) { return new RawNodeIntegrationManager(app, monitor, options).start(); }
export default RawNodeIntegrationManager;
