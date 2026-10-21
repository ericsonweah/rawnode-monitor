'use strict';

export class EventLoggingBridge {
  constructor(events, logger, options = {}) {
    this.events = events;
    this.logger = logger;
    this.options = options;
    this.listeners = [];
  }

  listen(event, level = 'info', mapper = null) {
    const handler = (...args) => {
      const mapped = typeof mapper === 'function' ? mapper(...args) : { args };
      this.logger.log(level, `Event dispatched: ${event}`, mapped, { channel: this.options.channel || 'events' });
    };
    this.events.on(event, handler);
    this.listeners.push({ event, handler });
    return this;
  }

  close() {
    for (const { event, handler } of this.listeners) this.events.off?.(event, handler);
    this.listeners.length = 0;
  }
}

export default EventLoggingBridge;
