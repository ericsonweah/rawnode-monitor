'use strict';

import { AsyncLocalStorage } from 'node:async_hooks';

export const INVOCATION_CONTEXT_STORAGE = Symbol.for('rawnode.foundation.invocation.storage');
export const APPLICATION_INVOCATION_CONTEXT = Symbol.for('rawnode.foundation.invocation.context');

function sharedStorage() {
  const current = globalThis[INVOCATION_CONTEXT_STORAGE];
  if (current instanceof AsyncLocalStorage) return current;

  const storage = new AsyncLocalStorage();
  try {
    Object.defineProperty(globalThis, INVOCATION_CONTEXT_STORAGE, {
      configurable: false,
      enumerable: false,
      writable: false,
      value: storage,
    });
  } catch {
    return globalThis[INVOCATION_CONTEXT_STORAGE] instanceof AsyncLocalStorage
      ? globalThis[INVOCATION_CONTEXT_STORAGE]
      : storage;
  }
  return storage;
}

const storage = sharedStorage();

function boolean(value, fallback = false) {
  return value === undefined ? fallback : value === true;
}

function text(value, fallback = null) {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export class RuntimeStartDeniedError extends Error {
  constructor(operation, context = null, details = {}) {
    const command = context?.command ? ` for console command [${context.command}]` : '';
    super(`RawNode runtime start [${operation}] is not authorized${command}.`);
    this.name = 'RuntimeStartDeniedError';
    this.code = 'RUNTIME_START_DENIED';
    this.exitCode = 5;
    this.operation = operation;
    this.context = context;
    this.details = Object.freeze({
      operation,
      invocationKind: context?.kind || null,
      command: context?.command || null,
      profile: context?.profile || null,
      processMode: context?.processMode || null,
      ...details,
    });
  }
}

export function normalizeInvocationContext(input = {}, parent = null) {
  const inherited = parent && typeof parent === 'object' ? parent : null;
  const kind = text(input.kind ?? input.runtime, inherited?.kind || 'application').toLowerCase();
  const command = text(input.command, inherited?.command || null)?.toLowerCase() || null;
  const profile = text(input.profile, inherited?.profile || 'application').toLowerCase();
  const processMode = text(input.processMode, inherited?.processMode || 'finite').toLowerCase();

  const allowTransportStart = boolean(
    input.allowTransportStart,
    inherited?.allowTransportStart === true,
  );
  const allowTransportAutoStart = boolean(
    input.allowTransportAutoStart,
    inherited?.allowTransportAutoStart === true,
  );
  const allowBackgroundStart = boolean(
    input.allowBackgroundStart,
    inherited?.allowBackgroundStart === true,
  );
  const allowBackgroundAutoStart = boolean(
    input.allowBackgroundAutoStart,
    inherited?.allowBackgroundAutoStart === true,
  );

  return Object.freeze({
    kind,
    runtime: kind,
    command,
    profile,
    processMode,
    allowTransportStart,
    allowTransportAutoStart,
    allowBackgroundStart,
    allowBackgroundAutoStart,
    correlationId: text(input.correlationId, inherited?.correlationId || null),
    tenant: text(input.tenant, inherited?.tenant || null),
    startedAt: Number.isFinite(Number(input.startedAt))
      ? Number(input.startedAt)
      : (inherited?.startedAt || Date.now()),
    metadata: Object.freeze({
      ...(inherited?.metadata || {}),
      ...(input.metadata || {}),
    }),
  });
}

export function runWithInvocationContext(context, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('runWithInvocationContext() requires a callback.');
  }
  const normalized = normalizeInvocationContext(context, storage.getStore() || null);
  return storage.run(normalized, callback);
}

export function runOutsideInvocationContext(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('runOutsideInvocationContext() requires a callback.');
  }
  return storage.run(null, callback);
}

export function currentInvocationContext(app = null) {
  const active = storage.getStore();
  if (active) return active;
  const fallback = app?.[APPLICATION_INVOCATION_CONTEXT];
  return fallback && typeof fallback === 'object' ? fallback : null;
}

export function isConsoleInvocation(app = null) {
  return currentInvocationContext(app)?.kind === 'console';
}

export function allowsTransportStart(app = null, options = {}) {
  const context = currentInvocationContext(app);
  if (!context || context.kind !== 'console') return true;
  return options.automatic === true
    ? context.allowTransportAutoStart === true
    : context.allowTransportStart === true;
}

export function allowsTransportAutoStart(app = null) {
  return allowsTransportStart(app, { automatic: true });
}

export function assertTransportStartAllowed(app = null, operation = 'transport.start', details = {}) {
  const context = currentInvocationContext(app);
  if (allowsTransportStart(app, { automatic: details.automatic === true })) return context;
  throw new RuntimeStartDeniedError(operation, context, details);
}

export function allowsBackgroundStart(app = null, options = {}) {
  const context = currentInvocationContext(app);
  if (!context || context.kind !== 'console') return true;
  return options.automatic === true
    ? context.allowBackgroundAutoStart === true
    : context.allowBackgroundStart === true;
}

export function allowsBackgroundAutoStart(app = null) {
  return allowsBackgroundStart(app, { automatic: true });
}

export function assertBackgroundStartAllowed(app = null, operation = 'background.start', details = {}) {
  const context = currentInvocationContext(app);
  if (allowsBackgroundStart(app, { automatic: details.automatic === true })) return context;
  throw new RuntimeStartDeniedError(operation, context, details);
}

export function installApplicationInvocationContext(app, context) {
  if (!app || (typeof app !== 'object' && typeof app !== 'function')) return false;
  const normalized = normalizeInvocationContext(context);
  try {
    Object.defineProperty(app, APPLICATION_INVOCATION_CONTEXT, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: normalized,
    });
    return true;
  } catch {
    return false;
  }
}

export function clearApplicationInvocationContext(app) {
  if (!app) return false;
  try {
    delete app[APPLICATION_INVOCATION_CONTEXT];
    return true;
  } catch {
    try { app[APPLICATION_INVOCATION_CONTEXT] = null; return true; }
    catch { return false; }
  }
}

export function lifecycleInvocationOptions(app = null) {
  const context = currentInvocationContext(app);
  return Object.freeze({
    invocation: context,
    console: context?.kind === 'console',
    command: context?.command || null,
    profile: context?.profile || null,
    processMode: context?.processMode || null,
    startTransports: allowsTransportAutoStart(app),
    startBackground: allowsBackgroundAutoStart(app),
  });
}

export default {
  INVOCATION_CONTEXT_STORAGE,
  APPLICATION_INVOCATION_CONTEXT,
  RuntimeStartDeniedError,
  normalizeInvocationContext,
  runWithInvocationContext,
  runOutsideInvocationContext,
  currentInvocationContext,
  isConsoleInvocation,
  allowsTransportStart,
  allowsTransportAutoStart,
  assertTransportStartAllowed,
  allowsBackgroundStart,
  allowsBackgroundAutoStart,
  assertBackgroundStartAllowed,
  installApplicationInvocationContext,
  clearApplicationInvocationContext,
  lifecycleInvocationOptions,
};
