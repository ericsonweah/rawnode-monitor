'use strict';

const bool = (name, fallback = false) => {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).toLowerCase());
};

const int = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
};

export default {
  stateDir: process.env.RAWNODE_PM_HOME || undefined,

  runtime: {
    enabled: bool('RAWNODE_PM_RUNTIME', process.env.RAWNODE_PM_MANAGED === '1'),
    autoReadyAfterBoot: bool('RAWNODE_PM_AUTO_READY', false),
    captureSignals: process.env.RAWNODE_PM_CAPTURE_SIGNALS !== 'false',
    telemetryIntervalMs: int('RAWNODE_PM_TELEMETRY_INTERVAL', 2_000),
    incidentDir: process.env.RAWNODE_PM_INCIDENT_DIR || 'storage/framework/pm/incidents',
  },
};
