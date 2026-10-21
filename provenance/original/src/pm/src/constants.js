'use strict';

export const PACKAGE_NAME = 'rawnode-pm';
export const STATE_SCHEMA_VERSION = 1;
export const CONTROL_PROTOCOL_VERSION = 1;
export const RUNTIME_PROTOCOL_VERSION = 1;

export const PROCESS_STATES = Object.freeze([
  'defined',
  'starting',
  'online',
  'ready',
  'running',
  'draining',
  'stopping',
  'stopped',
  'crashed',
  'unhealthy',
  'backoff',
  'quarantined',
  'boot_failed',
]);

export const TERMINAL_STATES = Object.freeze(new Set([
  'stopped',
  'crashed',
  'quarantined',
  'boot_failed',
]));

export const RUNTIME_MESSAGE = Object.freeze({
  ONLINE: 'runtime:online',
  READY: 'runtime:ready',
  HEARTBEAT: 'runtime:heartbeat',
  HEALTH: 'runtime:health',
  METRICS: 'runtime:metrics',
  DRAINING: 'runtime:draining',
  DRAINED: 'runtime:drained',
  SHUTDOWN_COMPLETE: 'runtime:shutdown-complete',
  ERROR: 'runtime:error',
  DIAGNOSTIC_READY: 'runtime:diagnostic-ready',
});

export const SUPERVISOR_MESSAGE = Object.freeze({
  DRAIN: 'supervisor:drain',
  SHUTDOWN: 'supervisor:shutdown',
  HEALTH: 'supervisor:health',
  METRICS: 'supervisor:metrics',
  DIAGNOSTICS: 'supervisor:diagnostics',
  RELOAD_CONFIG: 'supervisor:reload-config',
});

export const DEFAULTS = Object.freeze({
  telemetryIntervalMs: 2_000,
  heartbeatTimeoutMs: 10_000,
  readinessTimeoutMs: 30_000,
  shutdownGraceMs: 15_000,
  shutdownKillMs: 5_000,
  controlMaxFrameBytes: 1024 * 1024,
  logBufferBytes: 2 * 1024 * 1024,
  logMaxBytes: 50 * 1024 * 1024,
  logMaxFiles: 5,
  stateFileMode: 0o600,
  stateDirMode: 0o700,
});
