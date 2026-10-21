'use strict';

export class RawNodePmError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = options.name || 'RawNodePmError';
    this.code = options.code || 'RNPM_ERROR';
    this.status = options.status || 500;
    this.details = options.details || null;
    this.retryable = options.retryable === true;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

export class ConfigurationError extends RawNodePmError {
  constructor(message, details = null) {
    super(message, { name: 'ConfigurationError', code: 'RNPM_CONFIGURATION_ERROR', status: 400, details });
  }
}

export class ControlError extends RawNodePmError {
  constructor(message, options = {}) {
    super(message, { name: 'ControlError', code: options.code || 'RNPM_CONTROL_ERROR', status: options.status || 500, ...options });
  }
}

export class ProcessLifecycleError extends RawNodePmError {
  constructor(message, options = {}) {
    super(message, { name: 'ProcessLifecycleError', code: options.code || 'RNPM_PROCESS_ERROR', status: options.status || 500, ...options });
  }
}

export function serializeError(error, { stack = false } = {}) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    code: error.code || null,
    message: error.message || String(error),
    status: error.status || null,
    details: error.details || null,
    ...(stack && error.stack ? { stack: error.stack } : {}),
  };
}
