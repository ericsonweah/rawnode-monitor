'use strict';

import rawnodeHttp from '#http-server';
import { createUnifiedApplication } from './createUnifiedApplication.js';

export default function Unified(options = {}) {
  return createUnifiedApplication(options);
}

for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(rawnodeHttp))) {
  if (['name', 'length', 'prototype', 'caller', 'arguments'].includes(name)) continue;
  try { Object.defineProperty(Unified, name, descriptor); } catch {}
}

Unified.createApp = createUnifiedApplication;
Unified.createUnifiedApplication = createUnifiedApplication;

export { createUnifiedApplication } from './createUnifiedApplication.js';
export { UnifiedServer } from './UnifiedServer.js';
export { UNIFIED_STATE, UnifiedStateMachine } from './lifecycle/UnifiedState.js';
export { UnifiedMetrics } from './observability/UnifiedMetrics.js';
export { UnifiedDiagnostics, redactUnifiedDiagnostics } from './observability/UnifiedDiagnostics.js';
export {
  UnifiedError,
  UnifiedConfigurationError,
  UnifiedStateError,
  UnifiedStartupError,
  UnifiedShutdownError,
} from './errors/UnifiedError.js';
export {
  UNIFIED_DEFAULTS,
  normalizeUnifiedFactoryOptions,
  normalizeUnifiedStartOptions,
  resolveUnifiedProtocolProfiles,
  parseListenArguments,
} from './config/normalizeUnifiedOptions.js';

export * from '#http-server';
