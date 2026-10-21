'use strict';

export const MONITOR_VERSION = '1.0.0';
export const MONITOR_SCHEMA_VERSION = 1;

export const MonitorState = Object.freeze({
  IDLE: 'idle',
  STARTING: 'starting',
  RUNNING: 'running',
  DRAINING: 'draining',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
});

export const SignalKind = Object.freeze({
  METRICS: 'metrics',
  SPAN: 'span',
  EVENT: 'event',
  LOG: 'log',
  HEALTH: 'health',
  ALERT: 'alert',
  INCIDENT: 'incident',
  SLO: 'slo',
  RESOURCE: 'resource',
  DEPLOYMENT: 'deployment',
  INTERNAL: 'internal',
  ANOMALY: 'anomaly',
  SYNTHETIC: 'synthetic',
});

export const HealthStatus = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown',
  SKIPPED: 'skipped',
});

export const AlertState = Object.freeze({
  INACTIVE: 'inactive',
  PENDING: 'pending',
  FIRING: 'firing',
  ACKNOWLEDGED: 'acknowledged',
  RESOLVED: 'resolved',
  SILENCED: 'silenced',
  ERROR: 'error',
});

export const IncidentState = Object.freeze({
  OPEN: 'open',
  ACKNOWLEDGED: 'acknowledged',
  MITIGATED: 'mitigated',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});

export const SpanKind = Object.freeze({
  INTERNAL: 'internal',
  ANOMALY: 'anomaly',
  SYNTHETIC: 'synthetic',
  SERVER: 'server',
  CLIENT: 'client',
  PRODUCER: 'producer',
  CONSUMER: 'consumer',
});

export const SpanStatus = Object.freeze({
  UNSET: 'unset',
  OK: 'ok',
  ERROR: 'error',
});

export const OverflowPolicy = Object.freeze({
  DROP_NEW: 'drop-new',
  DROP_OLDEST: 'drop-oldest',
  REJECT: 'reject',
  BLOCK: 'block',
});

export const DEFAULT_HISTOGRAM_BUCKETS = Object.freeze([
  0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25,
  0.5, 1, 2.5, 5, 10, 30, 60,
]);

export const BLOCKED_OBJECT_KEYS = Object.freeze(new Set([
  '__proto__', 'prototype', 'constructor',
]));
