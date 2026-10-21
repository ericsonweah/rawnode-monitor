'use strict';

const bool = (name, fallback = false) => {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(String(value).trim().toLowerCase());
};

const int = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
};

export default {
  profile: process.env.LOG_PROFILE || (process.env.NODE_ENV === 'production' ? 'production' : 'v1'),
  level: process.env.LOG_LEVEL || 'info',
  channel: process.env.LOG_CHANNEL || 'stack',
  service: process.env.APP_NAME || 'rawnode',
  environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',

  context: {
    enabled: process.env.LOG_CONTEXT !== 'false',
  },

  security: {
    redact: process.env.LOG_REDACT !== 'false',
    sanitize: process.env.LOG_SANITIZE !== 'false',
    replacement: process.env.LOG_REDACTION_REPLACEMENT || '[REDACTED]',
    paths: [],
  },

  queue: {
    maxItems: int('LOG_QUEUE_MAX_ITEMS', 20_000),
    maxBytes: int('LOG_QUEUE_MAX_BYTES', 64 * 1024 * 1024),
    overflow: process.env.LOG_QUEUE_OVERFLOW || 'drop-lowest',
    budgetMs: int('LOG_QUEUE_BUDGET_MS', 6),
    maxPerSlice: int('LOG_QUEUE_MAX_PER_SLICE', 1_000),
  },

  channels: {
    stack: {
      driver: 'stack',
      channels: ['console'],
      ignoreExceptions: false,
    },
    console: {
      driver: 'console',
      level: process.env.LOG_CONSOLE_LEVEL || undefined,
      colors: process.env.NO_COLOR ? false : true,
      structured: bool('LOG_CONSOLE_JSON', false),
    },
    daily: {
      driver: 'file',
      directory: process.env.LOG_DIRECTORY || 'storage/logs',
      filename: process.env.LOG_FILE || 'application.log',
      maxBytes: int('LOG_FILE_MAX_BYTES', 25 * 1024 * 1024),
      rotateIntervalMs: int('LOG_ROTATE_INTERVAL_MS', 24 * 60 * 60 * 1_000),
      compress: bool('LOG_COMPRESS', true),
      retention: {
        maxFiles: int('LOG_RETENTION_FILES', 14),
        maxAgeMs: int('LOG_RETENTION_AGE_MS', 14 * 24 * 60 * 60 * 1_000),
        maxBytes: int('LOG_RETENTION_BYTES', 2 * 1024 * 1024 * 1024),
      },
    },
    audit: {
      driver: 'audit',
      directory: process.env.LOG_AUDIT_DIRECTORY || 'storage/logs/audit',
      filename: process.env.LOG_AUDIT_FILE || 'audit.ndjson',
      secret: process.env.LOG_AUDIT_SECRET || process.env.APP_KEY,
      keyId: process.env.LOG_AUDIT_KEY_ID || 'primary',
    },
  },

  processErrors: {
    enabled: bool('LOG_PROCESS_ERRORS', false),
    exitOnUncaught: bool('LOG_EXIT_ON_UNCAUGHT', false),
  },
};
