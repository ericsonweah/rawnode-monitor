'use strict';

import path from 'node:path';
import { writeJsonAtomic, ensureDir } from '../support/fs.js';
import { safeName } from '../support/paths.js';
import { defaultRedactor } from '../security/SecretRedactor.js';

export class DiagnosticManager {
  constructor(options = {}) {
    this.root = path.resolve(options.root || 'storage/framework/pm/incidents');
    this.registry = options.registry;
    this.supervisor = options.supervisor;
    this.logs = options.logs;
    this.metrics = options.metrics;
    this.realtime = options.realtime;
    this.redactor = options.redactor || defaultRedactor;
  }

  async collect(name, options = {}) {
    await ensureDir(this.root, 0o700);
    let runtime = null;
    try { runtime = await this.supervisor.diagnostics(name, options); }
    catch (error) { runtime = { error: error?.message || String(error) }; }
    const group = this.registry.snapshotGroup(name);
    const bundle = this.redactor.redact({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      daemon: {
        pid: process.pid,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        uptimeMs: Math.round(process.uptime() * 1_000),
      },
      group,
      runtime,
      logs: this.logs?.query?.(name, { lines: options.logLines || 500 }) || [],
      metrics: this.metrics?.snapshot?.({ includeHistory: true }) || null,
      events: this.realtime?.recent?.({ limit: options.eventLimit || 500 }) || [],
    });
    const file = path.join(this.root, `${safeName(name)}-${Date.now()}.json`);
    await writeJsonAtomic(file, bundle, { mode: 0o600, dirMode: 0o700 });
    return { ok: true, file, runtime };
  }
}

export default DiagnosticManager;
