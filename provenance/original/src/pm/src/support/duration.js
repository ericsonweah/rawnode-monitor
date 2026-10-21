'use strict';

const UNITS = Object.freeze({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 });

export function durationMs(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : fallback;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?\s*$/i.exec(String(value));
  if (!match) return fallback;
  return Math.max(0, Number(match[1]) * (UNITS[match[2]?.toLowerCase() || 'ms'] || 1));
}

export function formatDuration(ms) {
  const n = Math.max(0, Number(ms) || 0);
  if (n < 1_000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}s`;
  if (n < 3_600_000) return `${Math.floor(n / 60_000)}m ${Math.floor((n % 60_000) / 1_000)}s`;
  return `${Math.floor(n / 3_600_000)}h ${Math.floor((n % 3_600_000) / 60_000)}m`;
}
