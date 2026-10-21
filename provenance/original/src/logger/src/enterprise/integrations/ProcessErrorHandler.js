'use strict';

export class ProcessErrorHandler {
  constructor(logger, options = {}) {
    if (!logger) throw new TypeError('ProcessErrorHandler requires a logger.');
    this.logger = logger;
    this.options = {
      uncaughtException: options.uncaughtException === true,
      unhandledRejection: options.unhandledRejection === true,
      warning: options.warning === true,
      exitOnUncaught: options.exitOnUncaught === true,
      flushTimeoutMs: Math.max(1, Number(options.flushTimeoutMs) || 5000),
    };
    this.handlers = new Map();
  }

  attach() {
    if (this.options.uncaughtException) this._attach('uncaughtException', async (error, origin) => {
      await this._report('critical', 'Uncaught exception', error, { origin });
      if (this.options.exitOnUncaught) process.exitCode = 1;
    });
    if (this.options.unhandledRejection) this._attach('unhandledRejection', async (reason, promise) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      await this._report('error', 'Unhandled promise rejection', error, { promise: String(promise) });
    });
    if (this.options.warning) this._attach('warning', async (warning) => {
      await this._report('warn', 'Process warning', warning, { code: warning?.code });
    });
    return this;
  }

  _attach(event, handler) {
    if (this.handlers.has(event)) return;
    const wrapped = (...args) => { Promise.resolve(handler(...args)).catch(() => {}); };
    this.handlers.set(event, wrapped);
    process.on(event, wrapped);
  }

  async _report(level, message, error, data) {
    const work = this.logger.logAsync(level, message, data, { error }).then(() => this.logger.flush());
    await Promise.race([
      work,
      new Promise((resolve) => { const timer = setTimeout(resolve, this.options.flushTimeoutMs); }),
    ]);
  }

  detach() {
    for (const [event, handler] of this.handlers) process.off(event, handler);
    this.handlers.clear();
  }
}

export default ProcessErrorHandler;
