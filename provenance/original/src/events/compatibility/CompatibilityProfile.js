'use strict';

const BASE = Object.freeze({
  name: 'compat',
  strictConfiguration: false,
  allowUnknownEvents: true,
  allowUnsignedLocal: true,
  allowUnsignedRemote: true,
  requireRemoteContracts: false,
  requireRemoteAuthentication: false,
  requireTenantResolution: false,
  freezeDefinitions: false,
  freezeTransports: false,
  dynamicRegistration: true,
  localValidation: false,
  remoteValidation: true,
  durableValidation: true,
  publishEnvelopeVersion: 3,
  acceptedEnvelopeVersions: Object.freeze([1, 2, 3]),
  deliveryFailurePolicy: 'report',
  middlewareErrorPolicy: 'propagate',
  resourceOverflow: 'reject',
  transportFallback: true,
  metrics: false,
  diagnostics: false,
  flightRecorder: false,
  browser: Object.freeze({
    exposeGlobal: true,
    globalKey: 'events',
    captureLifecycle: false,
    captureErrors: false,
    bridgeDomEvents: false,
    crossTab: false,
    serviceWorker: false,
  }),
  limits: Object.freeze({
    maxEventNameBytes: 0,
    maxPayloadBytes: 0,
    maxContextBytes: 0,
    maxEnvelopeBytes: 0,
    maxHops: 8,
    maxMiddleware: 10_000,
    maxDefinitions: 10_000,
    maxTransports: 128,
    maxFlightRecords: 0,
    maxMetricSeries: 2_048,
    requestTimeoutMs: 30_000,
    resourceItems: 0,
    resourceBytes: 0,
    tenantItems: 0,
    tenantBytes: 0,
  }),
});

function merge(base, ...sources) {
  const output = { ...base };
  for (const source of sources) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      const previous = output[key];
      output[key] = value && typeof value === 'object' && !Array.isArray(value)
        && previous && typeof previous === 'object' && !Array.isArray(previous)
        ? merge(previous, value)
        : Array.isArray(value) ? value.slice() : value;
    }
  }
  return output;
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
}

export const EVENT_COMPATIBILITY_PROFILES = freeze({
  compat: BASE,
  enterprise: merge(BASE, {
    name: 'enterprise',
    requireRemoteContracts: true,
    deliveryFailurePolicy: 'report',
    metrics: true,
    diagnostics: true,
    flightRecorder: true,
    browser: {
      captureLifecycle: true,
      crossTab: true,
    },
    limits: {
      maxEventNameBytes: 512,
      maxPayloadBytes: 16 * 1024 * 1024,
      maxContextBytes: 64 * 1024,
      maxEnvelopeBytes: 20 * 1024 * 1024,
      maxFlightRecords: 2_048,
      resourceItems: 100_000,
      resourceBytes: 128 * 1024 * 1024,
      tenantItems: 25_000,
      tenantBytes: 32 * 1024 * 1024,
    },
  }),
  production: merge(BASE, {
    name: 'production',
    strictConfiguration: true,
    allowUnknownEvents: false,
    allowUnsignedRemote: false,
    requireRemoteContracts: true,
    requireRemoteAuthentication: true,
    freezeDefinitions: true,
    freezeTransports: true,
    dynamicRegistration: false,
    deliveryFailurePolicy: 'throw',
    metrics: true,
    diagnostics: true,
    flightRecorder: true,
    browser: {
      captureLifecycle: true,
      captureErrors: true,
      crossTab: true,
      serviceWorker: true,
    },
    limits: {
      maxEventNameBytes: 512,
      maxPayloadBytes: 8 * 1024 * 1024,
      maxContextBytes: 64 * 1024,
      maxEnvelopeBytes: 10 * 1024 * 1024,
      maxFlightRecords: 4_096,
      resourceItems: 100_000,
      resourceBytes: 128 * 1024 * 1024,
      tenantItems: 20_000,
      tenantBytes: 24 * 1024 * 1024,
    },
  }),
  strict: merge(BASE, {
    name: 'strict',
    strictConfiguration: true,
    allowUnknownEvents: false,
    allowUnsignedLocal: false,
    allowUnsignedRemote: false,
    requireRemoteContracts: true,
    requireRemoteAuthentication: true,
    requireTenantResolution: true,
    freezeDefinitions: true,
    freezeTransports: true,
    dynamicRegistration: false,
    localValidation: true,
    deliveryFailurePolicy: 'throw',
    middlewareErrorPolicy: 'propagate',
    metrics: true,
    diagnostics: true,
    flightRecorder: true,
    browser: {
      captureLifecycle: true,
      captureErrors: true,
      bridgeDomEvents: false,
      crossTab: true,
      serviceWorker: true,
    },
    limits: {
      maxEventNameBytes: 256,
      maxPayloadBytes: 4 * 1024 * 1024,
      maxContextBytes: 32 * 1024,
      maxEnvelopeBytes: 5 * 1024 * 1024,
      maxHops: 4,
      maxFlightRecords: 8_192,
      resourceItems: 50_000,
      resourceBytes: 64 * 1024 * 1024,
      tenantItems: 10_000,
      tenantBytes: 12 * 1024 * 1024,
    },
  }),
  test: merge(BASE, {
    name: 'test',
    localValidation: true,
    requireRemoteContracts: true,
    metrics: true,
    diagnostics: true,
    flightRecorder: true,
    browser: { captureLifecycle: true, crossTab: false },
    limits: {
      maxEventNameBytes: 512,
      maxPayloadBytes: 1024 * 1024,
      maxContextBytes: 64 * 1024,
      maxEnvelopeBytes: 2 * 1024 * 1024,
      maxFlightRecords: 1_024,
      resourceItems: 10_000,
      resourceBytes: 16 * 1024 * 1024,
      tenantItems: 5_000,
      tenantBytes: 8 * 1024 * 1024,
    },
  }),
});

export function resolveEventCompatibilityProfile(profile = 'compat', overrides = {}) {
  const supplied = profile && typeof profile === 'object' ? profile : null;
  const requested = typeof profile === 'string' ? profile : supplied?.name || 'compat';
  const preset = EVENT_COMPATIBILITY_PROFILES[requested];
  if (!preset) {
    throw Object.assign(new Error(`Unsupported RawNode Events profile '${requested}'.`), {
      name: 'EventConfigurationError',
      code: 'EVENT_PROFILE_INVALID',
      details: { requested, supported: Object.keys(EVENT_COMPATIBILITY_PROFILES) },
    });
  }
  const resolved = merge(preset, supplied || {}, overrides || {}, { name: requested });
  resolved.acceptedEnvelopeVersions = Array.from(new Set(resolved.acceptedEnvelopeVersions || [1, 2, 3]));
  return freeze(resolved);
}

export const resolveCompatibilityProfile = resolveEventCompatibilityProfile;
export default resolveEventCompatibilityProfile;
