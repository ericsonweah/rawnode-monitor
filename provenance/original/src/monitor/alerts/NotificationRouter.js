'use strict';

import { EventEmitter } from 'node:events';

export class NotificationRouter extends EventEmitter {
  constructor(options = {}) { super(); this.channels = new Map(); this.routes = []; this.errorPolicy = options.errorPolicy || 'isolate'; this.stats = { sent: 0, errors: 0, skipped: 0 }; }
  register(name, channel, options = {}) { if (!name || !channel) throw new TypeError('Notification channel name and implementation are required.'); this.channels.set(String(name), { name: String(name), channel, required: options.required === true }); return channel; }
  route(match = {}, channels = []) { this.routes.push(Object.freeze({ match: { ...match }, channels: Object.freeze([...channels]) })); return this; }
  async notify(notification, options = {}) {
    const selected = options.channels?.length ? options.channels : this._channels(notification);
    const results = [];
    for (const name of selected) {
      const entry = this.channels.get(String(name));
      if (!entry) { this.stats.skipped++; results.push({ channel: name, skipped: true, reason: 'missing' }); continue; }
      try {
        const channel = entry.channel;
        const value = typeof channel.send === 'function'
          ? await channel.send(notification, options)
          : typeof channel.notify === 'function'
            ? await channel.notify(notification, options)
            : typeof channel === 'function'
              ? await channel(notification, options)
              : false;
        this.stats.sent++; results.push({ channel: name, ok: value !== false, result: value });
      } catch (error) {
        this.stats.errors++; results.push({ channel: name, ok: false, error: error?.message || String(error) }); this.emit('error', error, name, notification);
        if (entry.required || this.errorPolicy === 'propagate') throw error;
      }
    }
    return Object.freeze(results);
  }
  _channels(notification) {
    const output = new Set();
    for (const route of this.routes) if (matches(route.match, notification)) for (const name of route.channels) output.add(name);
    if (!output.size) for (const name of this.channels.keys()) output.add(name);
    return [...output];
  }
  async close() { await Promise.allSettled(Array.from(this.channels.values()).map((entry) => entry.channel.close?.())); }
  snapshot() { return Object.freeze({ channels: Object.freeze(Array.from(this.channels.keys())), routes: Object.freeze(this.routes.slice()), stats: Object.freeze({ ...this.stats }) }); }
}
function matches(match, value) { return Object.entries(match || {}).every(([key, expected]) => Array.isArray(expected) ? expected.includes(value?.[key]) : value?.[key] === expected); }

export class LoggerNotificationChannel {
  constructor(logger) { this.logger = logger; }
  async send(notification) { const method = notification.severity === 'critical' || notification.severity === 'error' ? 'error' : notification.severity === 'warning' ? 'warn' : 'info'; this.logger?.[method]?.(`[Monitor] ${notification.title || notification.rule?.name || notification.type}`, notification); return true; }
}
export class EventNotificationChannel {
  constructor(events, event = 'monitor:notification') { this.events = events; this.event = event; }
  async send(notification) { const value = this.events?.dispatch?.(this.event, notification) ?? this.events?.emit?.(this.event, notification); await value; return true; }
}
export class CallbackNotificationChannel { constructor(callback) { this.callback = callback; } async send(notification, options) { return await this.callback(notification, options); } }
export default NotificationRouter;
