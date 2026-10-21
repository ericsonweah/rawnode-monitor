'use strict';

import { boundedInteger, deepFreeze } from '../support.js';

const TYPES = new Set(['http', 'tcp', 'dns', 'custom']);

export class SyntheticCheck {
  constructor(input = {}, defaults = {}) {
    const id = String(input.id || input.name || '').trim();
    if (!id) throw new TypeError('Synthetic checks require an id.');
    const type = String(input.type || (input.url ? 'http' : input.port ? 'tcp' : typeof input.run === 'function' ? 'custom' : 'dns')).toLowerCase();
    if (!TYPES.has(type)) throw new TypeError(`Unsupported synthetic check type '${type}'.`);
    if (type === 'http') validateUrl(input.url);
    if (type === 'tcp' && (!input.host || !validPort(input.port))) throw new TypeError(`TCP synthetic check '${id}' requires host and port.`);
    if (type === 'dns' && !input.hostname && !input.host) throw new TypeError(`DNS synthetic check '${id}' requires hostname.`);
    if (type === 'custom' && typeof input.run !== 'function') throw new TypeError(`Custom synthetic check '${id}' requires run().`);
    this.id = id;
    this.name = String(input.name || id);
    this.type = type;
    this.enabled = input.enabled !== false;
    this.intervalMs = boundedInteger(input.intervalMs, defaults.intervalMs || 60_000, 1_000, 24 * 60 * 60_000);
    this.timeoutMs = boundedInteger(input.timeoutMs, defaults.timeoutMs || 10_000, 100, 10 * 60_000);
    this.jitterMs = boundedInteger(input.jitterMs, Math.min(5_000, Math.floor(this.intervalMs * 0.1)), 0, this.intervalMs);
    this.failureThreshold = boundedInteger(input.failureThreshold, 3, 1, 10_000);
    this.recoveryThreshold = boundedInteger(input.recoveryThreshold, 2, 1, 10_000);
    this.severity = String(input.severity || 'warning');
    this.critical = input.critical === true;
    this.alert = input.alert !== false;
    this.incident = input.incident === true || this.severity === 'critical';
    this.runbook = input.runbook || null;
    this.tags = Object.freeze(Array.from(new Set((input.tags || []).map(String))));
    this.options = deepFreeze({ ...input, run: type === 'custom' ? input.run : undefined });
    Object.freeze(this);
  }
}

function validateUrl(input) {
  let url;
  try { url = new URL(String(input || '')); } catch { throw new TypeError('HTTP synthetic checks require a valid absolute URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError(`Unsupported synthetic URL protocol '${url.protocol}'.`);
  if (url.username || url.password) throw new TypeError('Synthetic URLs cannot contain embedded credentials.');
}
function validPort(value) { const number = Number(value); return Number.isSafeInteger(number) && number > 0 && number <= 65_535; }
export default SyntheticCheck;
