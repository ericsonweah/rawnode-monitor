'use strict';

const BASE = Object.freeze({
  name: 'compat',
  strictConfiguration: false,
  failFast: false,
  freezeDefinitions: false,
  allowLateRegistration: true,
  cardinalityPolicy: 'drop',
  queueOverflow: 'drop-oldest',
  exporterErrorPolicy: 'isolate',
  resourceErrorPolicy: 'isolate',
  healthErrorPolicy: 'report',
  captureErrorStacks: false,
  captureRequestHeaders: false,
  captureRequestBodies: false,
  studioDefaultEnabled: true,
  studioProductionEnabled: false,
  requireStudioAuthorization: false,
  requireSignedRemoteIngest: false,
  metricsEnabled: true,
  tracingEnabled: true,
  alertsEnabled: true,
  incidentsEnabled: true,
  sloEnabled: true,
  systemMetricsEnabled: true,
  analysisEnabled: true,
  syntheticsEnabled: false,
  pluginsEnabled: true,
  persistenceEnabled: false,
});

export const MONITOR_COMPATIBILITY_PROFILES = Object.freeze({
  compat: BASE,
  enterprise: Object.freeze({
    ...BASE,
    name: 'enterprise',
    freezeDefinitions: true,
    allowLateRegistration: false,
    studioDefaultEnabled: true,
    requireStudioAuthorization: true,
    persistenceEnabled: true,
  }),
  production: Object.freeze({
    ...BASE,
    name: 'production',
    strictConfiguration: true,
    failFast: false,
    freezeDefinitions: true,
    allowLateRegistration: false,
    queueOverflow: 'drop-new',
    captureErrorStacks: false,
    studioDefaultEnabled: false,
    requireStudioAuthorization: true,
    requireSignedRemoteIngest: true,
    persistenceEnabled: true,
  }),
  strict: Object.freeze({
    ...BASE,
    name: 'strict',
    strictConfiguration: true,
    failFast: true,
    freezeDefinitions: true,
    allowLateRegistration: false,
    cardinalityPolicy: 'error',
    queueOverflow: 'reject',
    exporterErrorPolicy: 'propagate',
    resourceErrorPolicy: 'propagate',
    healthErrorPolicy: 'propagate',
    studioDefaultEnabled: false,
    requireStudioAuthorization: true,
    requireSignedRemoteIngest: true,
    persistenceEnabled: true,
  }),
  test: Object.freeze({
    ...BASE,
    name: 'test',
    systemMetricsEnabled: false,
    alertsEnabled: false,
    incidentsEnabled: false,
    analysisEnabled: false,
    syntheticsEnabled: false,
    persistenceEnabled: false,
  }),
});

export function resolveMonitorCompatibilityProfile(profile = 'compat', overrides = {}) {
  const supplied = profile && typeof profile === 'object' ? profile : null;
  const requested = typeof profile === 'string' ? profile : supplied?.name || 'compat';
  const preset = MONITOR_COMPATIBILITY_PROFILES[requested] || MONITOR_COMPATIBILITY_PROFILES.compat;
  return Object.freeze({ ...preset, ...(supplied || {}), ...(overrides || {}), name: preset.name });
}

export default resolveMonitorCompatibilityProfile;
