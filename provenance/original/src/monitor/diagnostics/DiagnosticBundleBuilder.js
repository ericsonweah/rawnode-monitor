'use strict';

import { createGzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { deepFreeze, randomId, sha256 } from '../support.js';

export class DiagnosticBundleBuilder {
  constructor(monitor, options = {}) { this.monitor = monitor; this.root = path.resolve(options.path || monitor.configuration.get('incidents.path', 'storage/framework/monitor/diagnostics')); this.mode = options.mode ?? 0o600; }
  async build(options = {}) {
    const id = options.id || randomId('diag'); const createdAt = new Date().toISOString();
    const data = this.monitor.serializer.sanitize({ schemaVersion: 1, id, createdAt, reason: options.reason || 'manual', runtime: this.monitor.snapshot({ includeRecent: true }), health: await this.monitor.health(), diagnostics: await this.monitor.diagnostics({ includeSignals: options.includeSignals !== false, signalLimit: options.signalLimit || 500 }), process: { pid: process.pid, versions: process.versions, argv: process.argv.slice(0, 32), execPath: process.execPath, cwd: process.cwd(), env: safeEnvironment(options.environmentAllowlist || ['APP_ENV', 'NODE_ENV', 'RAWNODE_APP_PROFILE']) } }, { maxPayloadBytes: options.maxBytes || 32 * 1024 * 1024, includeErrorStack: options.includeStacks === true });
    const json = `${JSON.stringify(data, null, 2)}\n`;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const filename = `rawnode-monitor-${createdAt.replace(/[:.]/g, '-')}-${id}.json.gz`;
    const target = path.join(this.root, filename); const temporary = `${target}.${process.pid}.tmp`;
    try { await pipeline(Readable.from([json]), createGzip({ level: 6 }), createWriteStream(temporary, { mode: this.mode })); await rename(temporary, target); }
    catch (error) { await unlink(temporary).catch(() => {}); throw error; }
    return deepFreeze({ ok: true, id, createdAt, path: target, filename, bytesUncompressed: Buffer.byteLength(json), sha256: sha256(json) });
  }
}
function safeEnvironment(allowlist) { return Object.fromEntries(allowlist.filter((key) => process.env[key] != null).map((key) => [key, process.env[key]])); }
export default DiagnosticBundleBuilder;
