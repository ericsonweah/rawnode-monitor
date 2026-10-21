'use strict';

export class EventsListCommand {
  constructor(app) {
    this.app = app;
    this.signature = 'events:list {--json}';
    this.description = 'List registered event listeners, owners, tags, priorities, and patterns.';
  }

  async handle(options = {}) {
    const bus = this.app?.resolve?.('events');
    if (!bus) throw new Error('Events dispatcher is not registered');
    const manifest = bus.listenerManifest?.() || [];
    const result = { count: manifest.length, listeners: manifest };
    if (options.json || options['--json']) return result;
    return result;
  }
}

export default EventsListCommand;
