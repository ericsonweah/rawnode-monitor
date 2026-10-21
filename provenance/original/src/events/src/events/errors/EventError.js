'use strict';

export class EventError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = options.name || new.target.name || 'EventError';
    this.code = options.code || 'EVENT_ERROR';
    this.details = options.details ?? null;
    this.eventName = options.eventName ?? null;
  }
}

export class EventConfigurationError extends EventError {
  constructor(message, options = {}) {
    super(message, { ...options, name: 'EventConfigurationError', code: options.code || 'EVENT_CONFIGURATION_ERROR' });
  }
}

export class EventAdmissionError extends EventError {
  constructor(message, options = {}) {
    super(message, { ...options, name: 'EventAdmissionError', code: options.code || 'EVENT_ADMISSION_REJECTED' });
  }
}

export class EventTimeoutError extends EventError {
  constructor(message, options = {}) {
    super(message, { ...options, name: 'EventTimeoutError', code: options.code || 'EVENT_TIMEOUT' });
    this.timeoutMs = options.timeoutMs ?? null;
  }
}

export class EventAbortError extends EventError {
  constructor(message = 'Event operation aborted.', options = {}) {
    super(message, { ...options, name: 'EventAbortError', code: options.code || 'EVENT_ABORTED' });
  }
}

export class EventClosedError extends EventError {
  constructor(message = 'Event subsystem is closed.', options = {}) {
    super(message, { ...options, name: 'EventClosedError', code: options.code || 'EVENT_CLOSED' });
  }
}

export class EventTransportError extends EventError {
  constructor(message, options = {}) {
    super(message, { ...options, name: 'EventTransportError', code: options.code || 'EVENT_TRANSPORT_ERROR' });
  }
}


export class EventStoreError extends EventError {
  constructor(message, options = {}) {
    super(message, { ...options, name: 'EventStoreError', code: options.code || 'EVENT_STORE_ERROR' });
  }
}

export class EventConcurrencyError extends EventStoreError {
  constructor(message, options = {}) {
    super(message, { ...options, name: 'EventConcurrencyError', code: options.code || 'EVENT_CONCURRENCY_CONFLICT' });
    this.expectedVersion = options.expectedVersion ?? null;
    this.actualVersion = options.actualVersion ?? null;
    this.streamId = options.streamId ?? null;
  }
}
