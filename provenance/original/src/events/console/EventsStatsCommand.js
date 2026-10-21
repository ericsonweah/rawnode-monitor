'use strict';

export class EventsStatsCommand {
  constructor(app) {
    this.app = app;
    this.signature = 'events:stats {--prometheus}';
    this.description = 'Print event metrics, queue state, history usage, and bridge counters.';
  }

  async handle(options = {}) {
    const bus = this.app?.resolve?.('events');
    if (!bus) throw new Error('Events dispatcher is not registered');
    if (options.prometheus || options['--prometheus']) return bus.prometheus?.();
    return bus.stats?.();
  }
}

export default EventsStatsCommand;
