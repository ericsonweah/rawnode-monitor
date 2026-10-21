'use strict';

const BASE = Object.freeze({
  name: 'v1',
  strictLevels: false,
  legacyFormatting: true,
  legacyTransportPayload: 'json',
  isolateProcessorErrors: true,
  isolatePluginErrors: true,
  redact: false,
  sanitizeControls: false,
  stripAnsi: false,
  boundedQueues: true,
  queueOverflow: 'drop-oldest',
  awaitTransportDelivery: false,
  autoUnref: true,
  metrics: false,
  context: true,
  freezeRecords: false,
  lazyDefaultTransports: true,
});

export const COMPATIBILITY_PROFILES = Object.freeze({
  v1: BASE,
  strict: Object.freeze({
    ...BASE,
    name: 'strict',
    strictLevels: true,
    legacyFormatting: false,
    legacyTransportPayload: 'object',
    redact: true,
    sanitizeControls: true,
    stripAnsi: true,
    metrics: true,
    freezeRecords: true,
  }),
  production: Object.freeze({
    ...BASE,
    name: 'production',
    strictLevels: true,
    legacyFormatting: false,
    legacyTransportPayload: 'object',
    redact: true,
    sanitizeControls: true,
    stripAnsi: true,
    queueOverflow: 'severity-aware',
    metrics: true,
    freezeRecords: true,
  }),
  test: Object.freeze({
    ...BASE,
    name: 'test',
    strictLevels: true,
    legacyFormatting: false,
    legacyTransportPayload: 'object',
    redact: true,
    sanitizeControls: true,
    stripAnsi: true,
    metrics: true,
    freezeRecords: true,
    autoUnref: true,
  }),
  serverless: Object.freeze({
    ...BASE,
    name: 'serverless',
    strictLevels: true,
    legacyFormatting: false,
    legacyTransportPayload: 'object',
    redact: true,
    sanitizeControls: true,
    stripAnsi: true,
    queueOverflow: 'severity-aware',
    metrics: true,
    freezeRecords: true,
    lazyDefaultTransports: true,
  }),
});

export function resolveCompatibilityProfile(profile = 'v1', overrides = {}) {
  const supplied = profile && typeof profile === 'object' ? profile : null;
  const requestedName = typeof profile === 'string' ? profile : supplied?.name || 'v1';
  const preset = COMPATIBILITY_PROFILES[requestedName] || COMPATIBILITY_PROFILES.v1;
  return Object.freeze({
    ...preset,
    ...(supplied || {}),
    ...(overrides || {}),
    name: requestedName,
  });
}

export default resolveCompatibilityProfile;
