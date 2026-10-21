'use strict';

export class LoggerHealth {
  constructor(logger) {
    this.logger = logger;
  }

  snapshot() {
    return this.logger.health();
  }

  isHealthy() {
    return this.snapshot().status === 'healthy';
  }

  assertHealthy() {
    const snapshot = this.snapshot();
    if (snapshot.status !== 'healthy') {
      const error = new Error(`RawNode Logger is ${snapshot.status}.`);
      error.code = 'RAWNODE_LOGGER_UNHEALTHY';
      error.health = snapshot;
      throw error;
    }
    return snapshot;
  }
}

export default LoggerHealth;
