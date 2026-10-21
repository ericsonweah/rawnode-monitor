
'use strict';

import { UnifiedConfigurationError } from '../errors/UnifiedError.js';

const TRUE = new Set(['1', 'true', 'yes', 'on', 'enabled']);
const FALSE = new Set(['0', 'false', 'no', 'off', 'disabled']);
const PROFILES = new Set(['compat', 'ultra', 'enterprise', 'production', 'safe', 'strict']);

const PROTOCOL_PROFILE_MAP = Object.freeze({
  compat: Object.freeze({ http: 'compat', websocket: 'compat', tcp: 'compat', udp: 'compat' }),
  ultra: Object.freeze({ http: 'ultra', websocket: 'compat', tcp: 'compat', udp: 'compat' }),
  enterprise: Object.freeze({ http: 'enterprise', websocket: 'production', tcp: 'enterprise', udp: 'production' }),
  production: Object.freeze({ http: 'enterprise', websocket: 'production', tcp: 'enterprise', udp: 'production' }),
  safe: Object.freeze({ http: 'safe', websocket: 'production', tcp: 'enterprise', udp: 'production' }),
  strict: Object.freeze({ http: 'strict', websocket: 'strict', tcp: 'enterprise', udp: 'strict' }),
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function object(value) { return isPlainObject(value) ? value : {}; }
function bool(value, fallback) {
  if (value === true || value === false) return value;
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE.has(normalized)) return true;
  if (FALSE.has(normalized)) return false;
  return fallback;
}
function integer(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}
function string(value, fallback) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}
function normalizeProfile(value, fallback = 'compat') {
  const normalized = string(value, fallback).toLowerCase();
  if (!PROFILES.has(normalized)) {
    throw new UnifiedConfigurationError(`Unsupported RawNode Unified profile '${normalized}'.`, {
      code: 'UNIFIED_PROFILE_INVALID',
      details: { profile: normalized, supported: Array.from(PROFILES) },
    });
  }
  return normalized;
}
function merge(base, overlay) {
  const source = object(base);
  const output = { ...source };
  for (const [key, value] of Object.entries(object(overlay))) {
    if (isPlainObject(value) && isPlainObject(source[key])) output[key] = merge(source[key], value);
    else output[key] = value;
  }
  return output;
}

export const UNIFIED_DEFAULTS = Object.freeze({
  profile: 'compat',
  host: '127.0.0.1',
  port: 3000,
  backlog: 511,
  protocols: Object.freeze({ http: true, websocket: true, tcp: true, udp: true }),
  startup: Object.freeze({ atomic: true, maxPortAttempts: 10, ephemeralPortRetries: 10, optionalProtocols: Object.freeze([]), rollbackTimeoutMs: 2_000 }),
  shutdown: Object.freeze({ timeoutMs: 15_000, forceCloseTimeoutMs: 2_000, force: true, closeExternal: false }),
  classification: Object.freeze({ maxBytes: 64, timeoutMs: 300, ambiguous: 'tcp' }),
  tls: Object.freeze({ enabled: false, options: null, alpnProtocols: Object.freeze(['http/1.1', 'rawnode-tcp/1']), unknownAlpn: 'reject' }),
  http2: Object.freeze({ enabled: false, server: null }),
  proxyProtocol: Object.freeze({ enabled: false, required: false, trusted: false }),
  stun: Object.freeze({ enabled: false }),
  observability: Object.freeze({ enabled: true, prefix: 'rawnode_unified', historyLimit: 256 }),
});

function normalizeProtocols(input) {
  const source = object(input);
  const protocols = {
    http: bool(source.http, true),
    websocket: bool(source.websocket ?? source.ws, true),
    tcp: bool(source.tcp, true),
    udp: bool(source.udp, true),
  };
  if (protocols.websocket && !protocols.http) {
    throw new UnifiedConfigurationError('WebSocket requires the HTTP upgrade pipeline. Enable protocols.http or disable protocols.websocket.', {
      code: 'UNIFIED_WEBSOCKET_REQUIRES_HTTP',
    });
  }
  if (!Object.values(protocols).some(Boolean)) {
    throw new UnifiedConfigurationError('At least one protocol must be enabled.', { code: 'UNIFIED_NO_PROTOCOLS_ENABLED' });
  }
  return Object.freeze(protocols);
}

export function resolveUnifiedProtocolProfiles(profile = UNIFIED_DEFAULTS.profile, overrides = {}) {
  const normalized = normalizeProfile(profile, UNIFIED_DEFAULTS.profile);
  const preset = PROTOCOL_PROFILE_MAP[normalized] || PROTOCOL_PROFILE_MAP.compat;
  const source = object(overrides);
  return Object.freeze({
    http: string(source.http, preset.http),
    websocket: string(source.websocket ?? source.ws, preset.websocket),
    tcp: string(source.tcp, preset.tcp),
    udp: string(source.udp, preset.udp),
  });
}

function normalizeTls(input) {
  if (input === true) return { ...UNIFIED_DEFAULTS.tls, enabled: true };
  if (input === false || input == null) return { ...UNIFIED_DEFAULTS.tls };
  const source = object(input);
  const options = object(source.options);
  const direct = { ...source };
  for (const key of ['enabled', 'options', 'alpnProtocols', 'unknownAlpn']) delete direct[key];
  const tlsOptions = { ...direct, ...options };
  return {
    enabled: bool(source.enabled, Object.keys(tlsOptions).length > 0),
    options: Object.keys(tlsOptions).length ? tlsOptions : null,
    alpnProtocols: Array.isArray(source.alpnProtocols || source.ALPNProtocols)
      ? [...(source.alpnProtocols || source.ALPNProtocols)]
      : [...UNIFIED_DEFAULTS.tls.alpnProtocols],
    unknownAlpn: string(source.unknownAlpn, 'reject'),
  };
}

export function normalizeUnifiedFactoryOptions(input = {}) {
  const source = object(input);
  const profile = normalizeProfile(source.profile, UNIFIED_DEFAULTS.profile);
  const enterprise = ['enterprise', 'production', 'safe', 'strict'].includes(profile);
  return Object.freeze({
    ...source,
    profile,
    protocolProfiles: resolveUnifiedProtocolProfiles(profile, {
      ...object(source.protocolProfiles),
      http: source.http?.profile ?? source.protocolProfiles?.http,
      websocket: source.websocket?.profile ?? source.ws?.profile ?? source.protocolProfiles?.websocket ?? source.protocolProfiles?.ws,
      tcp: source.tcp?.profile ?? source.protocolProfiles?.tcp,
      udp: source.udp?.profile ?? source.protocolProfiles?.udp,
    }),
    http: object(source.http),
    websocket: object(source.websocket ?? source.ws),
    tcp: object(source.tcp),
    udp: object(source.udp),
    lifecycle: object(source.lifecycle),
    ownership: Object.freeze({
      http: source.httpApp == null,
      websocket: source.wsApp == null && source.websocketApp == null,
      tcp: source.tcpApp == null,
      udp: source.udpApp == null,
    }),
    closeExternal: bool(source.closeExternal, false),
    plugins: Object.freeze(Array.isArray(source.plugins) ? [...source.plugins] : []),
    classification: Object.freeze({
      maxBytes: integer(source.classification?.maxBytes, 64, 8, 65_536),
      timeoutMs: integer(source.classification?.timeoutMs, 300, 0, 60_000),
      ambiguous: string(source.classification?.ambiguous, enterprise ? 'reject' : 'tcp'),
      rawPrefaces: source.classification?.rawPrefaces,
      detectors: Array.isArray(source.classification?.detectors) ? [...source.classification.detectors] : [],
    }),
    observability: Object.freeze(merge(UNIFIED_DEFAULTS.observability, source.observability)),
  });
}

export function normalizeUnifiedStartOptions(factory = {}, input = {}) {
  const source = merge(factory, input);
  const listen = merge(factory.listen, source.listen);
  const lifecycle = merge(factory.lifecycle, source.lifecycle);
  const profile = normalizeProfile(source.profile ?? factory.profile, UNIFIED_DEFAULTS.profile);
  const enterprise = ['enterprise', 'production', 'safe', 'strict'].includes(profile);
  const proxyInput = source.proxyProtocol ?? factory.proxyProtocol ?? false;
  const proxy = proxyInput === true
    ? { enabled: true, required: false, trusted: false }
    : proxyInput === false
      ? { ...UNIFIED_DEFAULTS.proxyProtocol }
      : merge(UNIFIED_DEFAULTS.proxyProtocol, proxyInput);
  const tls = normalizeTls(source.tls ?? factory.tls);
  const classification = merge({
    ...UNIFIED_DEFAULTS.classification,
    ambiguous: enterprise ? 'reject' : 'tcp',
  }, merge(factory.classification, source.classification));
  if (!['reject', 'tcp', 'http'].includes(classification.ambiguous)) {
    throw new UnifiedConfigurationError(`Unsupported ambiguity policy '${classification.ambiguous}'.`, {
      code: 'UNIFIED_CLASSIFICATION_POLICY_INVALID',
    });
  }
  const protocols = normalizeProtocols(source.protocols ?? factory.protocols ?? UNIFIED_DEFAULTS.protocols);
  const protocolProfiles = resolveUnifiedProtocolProfiles(profile, {
    ...object(factory.protocolProfiles),
    ...object(source.protocolProfiles),
    http: source.http?.profile ?? source.protocolProfiles?.http ?? factory.http?.profile ?? factory.protocolProfiles?.http,
    websocket: source.websocket?.profile ?? source.ws?.profile ?? source.protocolProfiles?.websocket ?? source.protocolProfiles?.ws
      ?? factory.websocket?.profile ?? factory.protocolProfiles?.websocket ?? factory.protocolProfiles?.ws,
    tcp: source.tcp?.profile ?? source.protocolProfiles?.tcp ?? factory.tcp?.profile ?? factory.protocolProfiles?.tcp,
    udp: source.udp?.profile ?? source.protocolProfiles?.udp ?? factory.udp?.profile ?? factory.protocolProfiles?.udp,
  });
  const atomic = bool(source.startup?.atomic, true);
  if (!atomic) {
    throw new UnifiedConfigurationError('RawNode Unified requires atomic startup; startup.atomic cannot be disabled.', {
      code: 'UNIFIED_ATOMIC_STARTUP_REQUIRED',
    });
  }
  return Object.freeze({
    profile,
    host: string(source.host ?? listen.host, UNIFIED_DEFAULTS.host),
    port: integer(source.port ?? listen.port, UNIFIED_DEFAULTS.port, 0, 65_535),
    backlog: integer(source.backlog ?? listen.backlog, UNIFIED_DEFAULTS.backlog, 1, 65_535),
    ipv6Only: bool(source.ipv6Only ?? listen.ipv6Only, false),
    reusePort: bool(source.reusePort ?? listen.reusePort, false),
    reuseAddr: bool(source.reuseAddr ?? listen.reuseAddr, true),
    protocols,
    protocolProfiles,
    startup: Object.freeze({
      atomic,
      maxPortAttempts: integer(
        source.startup?.maxPortAttempts ?? source.startup?.ephemeralPortRetries,
        UNIFIED_DEFAULTS.startup.maxPortAttempts,
        1,
        128,
      ),
      ephemeralPortRetries: integer(
        source.startup?.ephemeralPortRetries ?? source.startup?.maxPortAttempts,
        UNIFIED_DEFAULTS.startup.ephemeralPortRetries,
        1,
        128,
      ),
      optionalProtocols: Object.freeze(Array.from(new Set(
        (Array.isArray(source.startup?.optionalProtocols) ? source.startup.optionalProtocols : [])
          .map((name) => String(name).toLowerCase())
          .filter((name) => ['http', 'websocket', 'tcp', 'udp'].includes(name)),
      ))),
      rollbackTimeoutMs: integer(source.startup?.rollbackTimeoutMs, UNIFIED_DEFAULTS.startup.rollbackTimeoutMs, 1, 120_000),
    }),
    shutdown: Object.freeze({
      timeoutMs: integer(
        source.shutdown?.timeoutMs ?? lifecycle.shutdownTimeoutMs ?? source.timeoutMs,
        UNIFIED_DEFAULTS.shutdown.timeoutMs,
        1,
        600_000,
      ),
      forceCloseTimeoutMs: integer(
        source.shutdown?.forceCloseTimeoutMs ?? lifecycle.forceCloseTimeoutMs,
        UNIFIED_DEFAULTS.shutdown.forceCloseTimeoutMs,
        0,
        120_000,
      ),
      force: bool(source.shutdown?.force ?? lifecycle.force, true),
      closeExternal: bool(
        source.shutdown?.closeExternal ?? lifecycle.closeExternal ?? source.closeExternal,
        factory.closeExternal ?? false,
      ),
    }),
    classification: Object.freeze({
      maxBytes: integer(classification.maxBytes, 64, 8, 65_536),
      timeoutMs: integer(classification.timeoutMs, 300, 0, 60_000),
      ambiguous: classification.ambiguous,
      rawPrefaces: classification.rawPrefaces,
      detectors: Array.isArray(classification.detectors) ? [...classification.detectors] : [],
    }),
    proxyProtocol: Object.freeze({
      enabled: bool(proxy.enabled, proxyInput !== false),
      required: bool(proxy.required, false),
      trusted: proxy.trusted ?? proxy.trustedProxies ?? false,
      maxHeaderBytes: integer(proxy.maxHeaderBytes, 536, 16, 65_536),
    }),
    tls: Object.freeze(tls),
    http2: Object.freeze(merge(UNIFIED_DEFAULTS.http2, source.http2 ?? factory.http2)),
    stun: Object.freeze(merge(UNIFIED_DEFAULTS.stun, source.stun ?? factory.stun)),
    http: Object.freeze(merge(factory.http, source.http)),
    websocket: Object.freeze(merge(factory.websocket, source.websocket ?? source.ws)),
    tcp: Object.freeze(merge(factory.tcp, source.tcp)),
    udp: Object.freeze(merge(factory.udp, source.udp)),
    observability: Object.freeze(merge(factory.observability, source.observability)),
  });
}

export function parseListenArguments(args = []) {
  const values = [...args];
  const callback = typeof values.at(-1) === 'function' ? values.pop() : null;
  if (values[0] && typeof values[0] === 'object' && !Array.isArray(values[0])) {
    return { options: { ...values[0] }, callback };
  }
  const options = {};
  if (values[0] != null) options.port = values[0];
  if (typeof values[1] === 'string') options.host = values[1];
  else if (typeof values[1] === 'number') options.backlog = values[1];
  if (typeof values[2] === 'number') options.backlog = values[2];
  return { options, callback };
}

export default normalizeUnifiedStartOptions;