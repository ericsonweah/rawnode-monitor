'use strict';

export class UnifiedError extends Error {
  constructor(message, options = {}) {
    super(String(message || 'RawNode Unified error'), options.cause ? { cause: options.cause } : undefined);
    this.name = options.name || 'UnifiedError';
    this.code = options.code || 'UNIFIED_ERROR';
    this.details = options.details && typeof options.details === 'object' ? { ...options.details } : null;
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class UnifiedConfigurationError extends UnifiedError {
  constructor(message, options = {}) {
    super(message, { ...options, name: 'UnifiedConfigurationError', code: options.code || 'UNIFIED_CONFIGURATION_ERROR' });
  }
}

export class UnifiedStateError extends UnifiedError {
  constructor(message, options = {}) {
    super(message, { ...options, name: 'UnifiedStateError', code: options.code || 'UNIFIED_STATE_ERROR' });
  }
}

export class UnifiedStartupError extends UnifiedError {
  constructor(message, options = {}) {
    super(message, { ...options, name: 'UnifiedStartupError', code: options.code || 'UNIFIED_STARTUP_ERROR' });
  }
}

export class UnifiedShutdownError extends UnifiedError {
  constructor(message, options = {}) {
    super(message, { ...options, name: 'UnifiedShutdownError', code: options.code || 'UNIFIED_SHUTDOWN_ERROR' });
  }
}

export function safeError(error) {
  if (!error) return null;
  return {
    name: error.name || 'Error',
    code: error.code || null,
    message: error.message || String(error),
    details: error.details || null,
  };
}

export default UnifiedError;
