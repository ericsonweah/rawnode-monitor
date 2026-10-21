'use strict';

import path from 'node:path';
import { access, readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { atomicWriteFile } from '../support/fs.js';

const APPLICATION_IMPORT_ANCHOR = `import { ColorServiceProvider } from '#providers/ColorServiceProvider.js';
import TestServiceProvider from '#providers/TestServiceProvider.js';
import EditorServiceProvider from '#providers/EditorServiceProvider.js';`;

const APPLICATION_IMPORT_PAYLOAD = `${APPLICATION_IMPORT_ANCHOR}
import PMServiceProvider from '#providers/PMServiceProvider.js';`;

const APPLICATION_PROVIDER_ANCHOR = `  { provider: TestServiceProvider, profiles: ['testing', 'full'] },
  { provider: ConsoleServiceProvider, profiles: ['minimal', 'http', 'api', 'realtime', 'testing', 'full'] },
  { provider: SdspaServiceProvider, profiles: ['http', 'realtime', 'testing', 'full'] },`;

const APPLICATION_PROVIDER_PAYLOAD = `  { provider: TestServiceProvider, profiles: ['testing', 'full'] },
  { provider: ConsoleServiceProvider, profiles: ['minimal', 'http', 'api', 'realtime', 'testing', 'full'] },
  { provider: PMServiceProvider, profiles: ['minimal', 'http', 'api', 'realtime', 'testing', 'full'] },
  { provider: SdspaServiceProvider, profiles: ['http', 'realtime', 'testing', 'full'] },`;

const SERVE_SERVER_ANCHOR = `    const server = new HybridServer(
        tcpSkin || { onConnection:()=>{}, onData:()=>{}, onDisconnect:()=>{} }, 
        httpHandler,
        udpApp // 👈 Pass UDP App here
    );`;

const SERVE_SERVER_PAYLOAD = `${SERVE_SERVER_ANCHOR}

    // RawNode PM: track the actual multi-protocol server without creating the
    // runtime adapter in unmanaged processes.
    const pm = this.app.tryResolve?.('pm.manager', null) || null;
    if (pm?.settings?.runtime?.enabled) {
      pm.trackServer(server, { name: 'hybrid', protocol: 'hybrid' });
    }`;

const SERVE_LISTEN_ANCHOR = `    server.listen(port, () => {
        this.info(\`RawNode Multi Protocol Server running on port \${port}\`);
        this.info(\`- HTTP/WebSocket: Ready\`);
        if (tcpSkin) this.info(\`- Raw TCP: Ready\`);
        if (udpApp)  this.info(\`- Reliable UDP: Ready (RUDP)\`);
        
        this.line('Press Ctrl+C to stop');
    });`;

const SERVE_LISTEN_PAYLOAD = `    server.listen(port, () => {
        if (pm?.settings?.runtime?.enabled) {
          const readyMeta = {
            source: 'serve-command',
            port: Number(port),
            protocols: {
              http: true,
              websocket: !!wsService,
              tcp: !!tcpSkin,
              udp: !!udpApp,
            },
          };

          pm.protocolReady('http', readyMeta);
          if (wsService) pm.protocolReady('websocket', readyMeta);
          if (tcpSkin) pm.protocolReady('tcp', readyMeta);
          if (udpApp) pm.protocolReady('udp', readyMeta);
          pm.ready(readyMeta);
        }

        this.info(\`RawNode Multi Protocol Server running on port \${port}\`);
        this.info(\`- HTTP/WebSocket: Ready\`);
        if (tcpSkin) this.info(\`- Raw TCP: Ready\`);
        if (udpApp)  this.info(\`- Reliable UDP: Ready (RUDP)\`);
        
        this.line('Press Ctrl+C to stop');
    });`;

function applyTransform(source, transformation, file) {
  if (source.includes(transformation.present)) return { source, changed: false, skipped: 'already-integrated' };
  if (!source.includes(transformation.anchor)) {
    const error = new Error(`RawNode integration anchor was not found in ${file}: ${transformation.name}`);
    error.code = 'RNPM_INTEGRATION_ANCHOR_MISSING';
    error.details = { file, anchor: transformation.anchor, name: transformation.name };
    throw error;
  }
  return {
    source: source.replace(transformation.anchor, transformation.payload),
    changed: true,
    skipped: null,
  };
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export class RawNodeIntegrator {
  constructor(options = {}) {
    this.root = path.resolve(options.root || process.cwd());
    this.applicationFile = path.resolve(this.root, options.applicationFile || 'src/foundation/Application.js');
    this.serveFile = path.resolve(this.root, options.serveFile || 'src/console/commands/ServeCommand.js');
    this.configFile = path.resolve(this.root, options.configFile || 'config/pm.js');
    this.manifestFile = path.resolve(this.root, options.manifestFile || 'rawnode.process.mjs');
    this.configTemplate = fileURLToPath(new URL('../../config/pm.js', import.meta.url));
    this.manifestTemplate = fileURLToPath(new URL('../../config/rawnode.process.example.mjs', import.meta.url));
  }

  async plan(options = {}) {
    const applicationOriginal = await readFile(this.applicationFile, 'utf8');
    const serveOriginal = await readFile(this.serveFile, 'utf8');

    let application = { source: applicationOriginal, changed: false };
    for (const transformation of [
      {
        name: 'service-provider-import',
        anchor: APPLICATION_IMPORT_ANCHOR,
        payload: APPLICATION_IMPORT_PAYLOAD,
        present: "from '#providers/PMServiceProvider.js'",
      },
      {
        name: 'service-provider-registration',
        anchor: APPLICATION_PROVIDER_ANCHOR,
        payload: APPLICATION_PROVIDER_PAYLOAD,
        present: "{ provider: PMServiceProvider, profiles:",
      },
    ]) {
      const result = applyTransform(application.source, transformation, this.applicationFile);
      application = { source: result.source, changed: application.changed || result.changed };
    }

    let serve = { source: serveOriginal, changed: false };
    for (const transformation of [
      {
        name: 'runtime-server-tracking',
        anchor: SERVE_SERVER_ANCHOR,
        payload: SERVE_SERVER_PAYLOAD,
        present: "pm.trackServer(server, { name: 'hybrid', protocol: 'hybrid' });",
      },
      {
        name: 'runtime-readiness',
        anchor: SERVE_LISTEN_ANCHOR,
        payload: SERVE_LISTEN_PAYLOAD,
        present: "source: 'serve-command'",
      },
    ]) {
      const result = applyTransform(serve.source, transformation, this.serveFile);
      serve = { source: result.source, changed: serve.changed || result.changed };
    }

    const createConfig = options.force === true || !(await exists(this.configFile));
    const createManifest = options.force === true || !(await exists(this.manifestFile));
    return {
      edits: [
        { file: this.applicationFile, original: applicationOriginal, source: application.source, changed: application.changed },
        { file: this.serveFile, original: serveOriginal, source: serve.source, changed: serve.changed },
      ],
      creates: [
        ...(createConfig ? [{ file: this.configFile, sourceFile: this.configTemplate, existed: await exists(this.configFile) }] : []),
        ...(createManifest ? [{ file: this.manifestFile, sourceFile: this.manifestTemplate, existed: await exists(this.manifestFile) }] : []),
      ],
    };
  }

  async integrate(options = {}) {
    const plan = await this.plan(options);
    if (options.dryRun === true) {
      return {
        ok: true,
        dryRun: true,
        changed: plan.edits.filter((entry) => entry.changed).map((entry) => entry.file),
        created: plan.creates.map((entry) => entry.file),
      };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backups = [];
    const created = [];
    const written = [];
    try {
      for (const edit of plan.edits) {
        if (!edit.changed) continue;
        const backup = `${edit.file}.rawnode-pm.${stamp}.bak`;
        await atomicWriteFile(backup, edit.original, { encoding: 'utf8', mode: 0o600 });
        backups.push({ file: edit.file, backup, original: edit.original });
        await atomicWriteFile(edit.file, edit.source, { encoding: 'utf8', mode: 0o644 });
        written.push(edit.file);
      }
      for (const entry of plan.creates) {
        const content = await readFile(entry.sourceFile, 'utf8');
        if (entry.existed) {
          const original = await readFile(entry.file, 'utf8');
          const backup = `${entry.file}.rawnode-pm.${stamp}.bak`;
          await atomicWriteFile(backup, original, { encoding: 'utf8', mode: 0o600 });
          backups.push({ file: entry.file, backup, original });
        } else created.push(entry.file);
        await atomicWriteFile(entry.file, content, { encoding: 'utf8', mode: 0o644 });
        written.push(entry.file);
      }
      return {
        ok: true,
        dryRun: false,
        changed: plan.edits.filter((entry) => entry.changed).map((entry) => entry.file),
        created: plan.creates.map((entry) => entry.file),
        backups: backups.map((entry) => entry.backup),
      };
    } catch (error) {
      for (const backup of backups.reverse()) {
        await atomicWriteFile(backup.file, backup.original, { encoding: 'utf8', mode: 0o644 }).catch(() => {});
      }
      for (const file of created) await rm(file, { force: true }).catch(() => {});
      error.details = { ...(error.details || {}), rolledBack: written };
      throw error;
    }
  }
}

export const RAWNODE_INTEGRATION_ANCHORS = Object.freeze({
  APPLICATION_IMPORT_ANCHOR,
  APPLICATION_PROVIDER_ANCHOR,
  SERVE_SERVER_ANCHOR,
  SERVE_LISTEN_ANCHOR,
});

export default RawNodeIntegrator;