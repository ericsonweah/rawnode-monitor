'use strict';

export class EventsInspectCommand {
  constructor(app) {
    this.app = app;
    this.signature = 'events:inspect {event} {--json}';
    this.description = 'Show the exact, wildcard, pattern, and global listeners that would receive an event.';
  }

  async handle(eventName, options = {}) {
    if (!eventName) throw new Error('events:inspect requires an event name');
    const bus = this.app?.resolve?.('events');
    if (!bus?.inspect) throw new Error('Events dispatcher does not support inspection');
    return bus.inspect(eventName);
  }
}

export default EventsInspectCommand;
