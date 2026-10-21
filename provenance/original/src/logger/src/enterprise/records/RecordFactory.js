'use strict';

import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { threadId, isMainThread } from 'node:worker_threads';

function valueOrCall(value) {
  return typeof value === 'function' ? value() : value;
}

function ownData(value, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

function messageText(value, serializer) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'object') return serializer.stringify(value);
  try { return String(value); } catch { return '[Unprintable]'; }
}

export function resolveMessageAndError(message, data, options = {}, serializer) {
  let resolvedMessage = valueOrCall(message);
  let resolvedData = valueOrCall(data);
  let error = options.error || null;

  if (resolvedMessage instanceof Error) {
    error = resolvedMessage;
    resolvedMessage = resolvedMessage.message || resolvedMessage.name;
  } else if (resolvedData instanceof Error) {
    error = resolvedData;
    resolvedData = null;
  } else if (resolvedMessage && typeof resolvedMessage === 'object' && !Array.isArray(resolvedMessage)) {
    const candidate = resolvedMessage;
    const candidateError = ownData(candidate, 'error') || ownData(candidate, 'err');
    const candidateMessage = ownData(candidate, 'message') ?? ownData(candidate, 'msg');
    if (candidateError instanceof Error) error = candidateError;
    if (candidateMessage !== undefined) {
      resolvedMessage = candidateMessage;
      if (resolvedData == null) {
        const normalized = serializer.normalize(candidate);
        if (normalized && typeof normalized === 'object') {
          delete normalized.message;
          delete normalized.msg;
          delete normalized.error;
          delete normalized.err;
          resolvedData = Object.keys(normalized).length ? normalized : null;
        }
      }
    }
  }

  return {
    message: messageText(resolvedMessage, serializer),
    data: resolvedData,
    error,
  };
}

export class RecordFactory {
  constructor(options = {}) {
    if (!options.serializer) throw new TypeError('RecordFactory requires a serializer.');
    if (!options.errorNormalizer) throw new TypeError('RecordFactory requires an error normalizer.');
    this.serializer = options.serializer;
    this.errorNormalizer = options.errorNormalizer;
    this.clock = options.clock || (() => Date.now());
    this.hrtime = options.hrtime || (() => process.hrtime.bigint());
    this.idFactory = options.idFactory || randomUUID;
    this.hostname = options.hostname || os.hostname();
    this.service = options.service || process.env.APP_NAME || process.env.SERVICE_NAME || 'rawnode';
    this.environment = options.environment || process.env.APP_ENV || process.env.NODE_ENV || 'development';
    this.sequence = Number(options.sequence) || 0;
    this.schemaVersion = Number(options.schemaVersion) || 1;
  }

  create(input = {}) {
    const now = input.timeUnixMs == null ? Number(this.clock()) : Number(input.timeUnixMs);
    const sequence = ++this.sequence;
    const resolved = resolveMessageAndError(input.message, input.data, input, this.serializer);
    const context = this.serializer.normalize(input.context || {});
    const data = resolved.data == null ? null : this.serializer.normalize(resolved.data);
    const error = resolved.error ? this.errorNormalizer.normalize(resolved.error) : null;
    const levelDefinition = input.levelDefinition || {};

    return {
      schemaVersion: this.schemaVersion,
      id: this.idFactory(),
      sequence,
      timestamp: new Date(now).toISOString(),
      timeUnixMs: now,
      hrtimeNs: String(input.hrtimeNs == null ? this.hrtime() : input.hrtimeNs),
      level: input.level,
      levelValue: levelDefinition.severity ?? null,
      levelRank: levelDefinition.rank ?? null,
      category: levelDefinition.category || 'custom',
      syslog: levelDefinition.syslog ?? null,
      consoleMethod: levelDefinition.consoleMethod || 'log',
      droppable: levelDefinition.droppable !== false,
      message: resolved.message,
      data,
      context,
      error,
      channel: input.channel || 'app',
      service: input.service || this.service,
      environment: input.environment || this.environment,
      hostname: this.hostname,
      pid: process.pid,
      threadId: isMainThread ? 0 : threadId,
      requestId: input.requestId ?? context.requestId ?? context.request_id ?? null,
      correlationId: input.correlationId ?? context.correlationId ?? context.correlation_id ?? null,
      traceId: input.traceId ?? context.traceId ?? context.trace_id ?? null,
      spanId: input.spanId ?? context.spanId ?? context.span_id ?? null,
      tenantId: input.tenantId ?? context.tenantId ?? context.tenant_id ?? null,
      userId: input.userId ?? context.userId ?? context.user_id ?? null,
      tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      formatted: '',
    };
  }
}

export default RecordFactory;
