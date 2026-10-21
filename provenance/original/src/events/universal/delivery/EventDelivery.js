'use strict';

export const EventDeliveryState = Object.freeze({
  NOT_ADMITTED: 'notAdmitted',
  QUEUED: 'queued',
  PERSISTED: 'persisted',
  WRITTEN: 'written',
  SENT: 'sent',
  ACKNOWLEDGED: 'acknowledged',
  REJECTED: 'rejected',
  FAILED: 'failed',
  OUTCOME_UNKNOWN: 'outcomeUnknown',
});

export class EventDeliveryResult {
  constructor(input = {}) {
    this.accepted = input.accepted !== false;
    this.state = input.state || (this.accepted ? EventDeliveryState.SENT : EventDeliveryState.NOT_ADMITTED);
    this.transport = input.transport || null;
    this.eventId = input.eventId || null;
    this.persisted = input.persisted === true;
    this.acknowledged = input.acknowledged === true;
    this.retryable = input.retryable === true;
    this.code = input.code || null;
    this.reason = input.reason || null;
    this.value = input.value;
    this.error = input.error || null;
    this.startedAt = input.startedAt || Date.now();
    this.finishedAt = input.finishedAt || Date.now();
    this.durationMs = Number(input.durationMs) || Math.max(0, this.finishedAt - this.startedAt);
    this.attempts = Math.max(1, Number(input.attempts) || 1);
    this.results = Array.isArray(input.results) ? input.results : null;
    Object.freeze(this);
  }

  static accepted(input = {}) { return new EventDeliveryResult({ ...input, accepted: true }); }
  static rejected(input = {}) { return new EventDeliveryResult({ ...input, accepted: false, state: input.state || EventDeliveryState.REJECTED }); }
  toJSON() { return { ...this }; }
}

export function deliveryError(message, result, options = {}) {
  const error = Object.assign(new Error(message), {
    name: 'EventDeliveryError',
    code: options.code || result?.code || 'EVENT_DELIVERY_FAILED',
    delivery: result?.state || EventDeliveryState.FAILED,
    retryable: result?.retryable === true,
    result,
    details: options.details || null,
  });
  if (options.cause) error.cause = options.cause;
  return error;
}
