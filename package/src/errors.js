'use strict';

export class MonitorError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = options.name || this.constructor.name;
    this.code = options.code || 'MONITOR_ERROR';
    this.status = Number(options.status || 500);
    this.retryable = options.retryable === true;
    this.details = options.details || null;
    if (options.cause && !this.cause) this.cause = options.cause;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      retryable: this.retryable,
      message: this.message,
      details: this.details,
    };
  }
}

export class MonitorConfigurationError extends MonitorError {
  constructor(message, options = {}) { super(message, { ...options, code: options.code || 'MONITOR_CONFIGURATION_ERROR', status: 500 }); }
}
export class MonitorCapacityError extends MonitorError {
  constructor(message, options = {}) { super(message, { ...options, code: options.code || 'MONITOR_CAPACITY_EXCEEDED', status: 429, retryable: true }); }
}
export class MonitorSecurityError extends MonitorError {
  constructor(message, options = {}) { super(message, { ...options, code: options.code || 'MONITOR_SECURITY_ERROR', status: options.status || 403 }); }
}
export class MonitorTimeoutError extends MonitorError {
  constructor(message, options = {}) { super(message, { ...options, code: options.code || 'MONITOR_TIMEOUT', status: 504, retryable: true }); }
}
export class MonitorClosedError extends MonitorError {
  constructor(message = 'RawNode Monitor is closed.', options = {}) { super(message, { ...options, code: 'MONITOR_CLOSED', status: 503 }); }
}
export class MetricDefinitionError extends MonitorError {
  constructor(message, options = {}) { super(message, { ...options, code: options.code || 'MONITOR_METRIC_DEFINITION_ERROR', status: 422 }); }
}
export class CardinalityLimitError extends MonitorCapacityError {
  constructor(message, options = {}) { super(message, { ...options, code: 'MONITOR_CARDINALITY_LIMIT' }); }
}
export class TraceContextError extends MonitorError {
  constructor(message, options = {}) { super(message, { ...options, code: options.code || 'MONITOR_TRACE_CONTEXT_ERROR', status: 400 }); }
}
export class AlertRuleError extends MonitorError {
  constructor(message, options = {}) { super(message, { ...options, code: options.code || 'MONITOR_ALERT_RULE_ERROR', status: 422 }); }
}
