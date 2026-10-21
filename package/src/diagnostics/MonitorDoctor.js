'use strict';

import { access, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { deepFreeze, errorRecord } from '../support.js';

export class MonitorDoctor {
  constructor(monitor) { this.monitor = monitor; }
  async inspect(options = {}) {
    const checks = [];
    const add = (name, ok, severity = 'error', details = null) => checks.push(deepFreeze({ name, ok: ok === true, severity, details }));
    const configuration = this.monitor.configuration;
    add('configuration', configuration.validation?.ok !== false, 'error', configuration.validation);
    add('runtime state', ['running', 'idle', 'stopped'].includes(this.monitor.state), 'error', { state: this.monitor.state });
    add('signal pipeline', this.monitor.pipeline?.closed !== true, 'error', this.monitor.pipeline?.snapshot());
    add('metric registry', this.monitor.metrics?.options?.enabled !== false, 'warning', this.monitor.metrics?.snapshot());
    add('tracer', this.monitor.tracer?.options?.enabled !== false, 'warning', this.monitor.tracer?.snapshot());

    const store = this.monitor.store?.snapshot?.() || null;
    const storageEnabled = configuration.get('storage.enabled') === true;
    const storageRequired = configuration.get('storage.required') === true;
    const configuredDriver = String(configuration.get('storage.driver', 'none'));
    add('telemetry store', !!store && store.closed !== true, storageEnabled ? 'error' : 'warning', store);
    if (storageEnabled) {
      const expected = configuredDriver === 'none' ? 'none' : configuredDriver;
      const actual = String(store?.driver || 'unknown');
      const compatible = expected === actual || (expected === 'composite' && actual === 'composite');
      add('telemetry store driver', compatible, storageRequired ? 'error' : 'warning', { configured: expected, actual, fallbackFrom: store?.fallbackFrom || null, fallbackReason: store?.fallbackReason || null });
    }
    const storagePath = configuration.get('storage.path');
    if (storageEnabled && ['file', 'composite'].includes(configuredDriver) && storagePath) add('storage path writable', await writable(storagePath), storageRequired ? 'error' : 'warning', { path: storagePath });

    const health = await this.monitor.healthRegistry.all({ fresh: true, signal: options.signal }).catch((error) => ({ ok: false, error: errorRecord(error) }));
    add('registered health checks', health.ok !== false, 'error', health);
    const resources = await this.monitor.resources.collect({ diagnostics: false, throwOnRequired: false, signal: options.signal }).catch((error) => ({ error: errorRecord(error) }));
    const requiredFailures = Object.values(resources.resources || {}).filter((item) => item?.error).length;
    add('resource collection', requiredFailures === 0, requiredFailures ? 'error' : 'warning', resources);
    const errors = checks.filter((check) => !check.ok && check.severity === 'error');
    const warnings = checks.filter((check) => !check.ok && check.severity !== 'error');
    return deepFreeze({ ok: errors.length === 0, checkedAt: new Date().toISOString(), service: configuration.get('service'), environment: configuration.get('environment'), state: this.monitor.state, summary: { total: checks.length, passed: checks.filter((check) => check.ok).length, failed: errors.length, warnings: warnings.length }, checks, errors, warnings });
  }
}
async function writable(directory) { const file = path.join(directory, `.monitor-doctor-${process.pid}-${Date.now()}`); try { await mkdir(directory, { recursive: true, mode: 0o700 }); await writeFile(file, 'ok', { mode: 0o600 }); await unlink(file); await access(directory); return true; } catch { return false; } }
export default MonitorDoctor;
