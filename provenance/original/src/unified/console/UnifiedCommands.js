'use strict';

function managerOf(app) {
  if (app?.getUnifiedServer) return app.getUnifiedServer();
  if (app?.unified?.start) return app.unified;
  try { return app?.resolve?.('unified.manager') || app?.resolve?.('unified')?.unified; }
  catch { return null; }
}

export class UnifiedServeCommand {
  constructor(app) { this.app = app; this.signature = 'unified:serve {port?}'; this.description = 'Start the RawNode unified HTTP/WebSocket/TCP/UDP endpoint.'; }
  async handle(input = {}) {
    const manager = managerOf(this.app);
    if (!manager) throw new Error('RawNode Unified manager is not registered.');
    const argument = typeof this.argument === 'function' ? this.argument('port') : null;
    const port = Number(input.port ?? argument ?? process.env.UNIFIED_PORT ?? process.env.PORT ?? 3000);
    const host = String(input.host ?? process.env.UNIFIED_HOST ?? process.env.HOST ?? '127.0.0.1');
    const server = await manager.start({ ...input, host, port });
    this.info?.(`RawNode Unified listening at ${host}:${server.address()?.port}`);
    return server;
  }
}

export class UnifiedDoctorCommand {
  constructor(app) { this.app = app; this.signature = 'unified:doctor'; this.description = 'Inspect unified lifecycle, protocol readiness, and classification policy.'; }
  async handle() {
    const manager = managerOf(this.app);
    if (!manager) return { ok: false, code: 'UNIFIED_NOT_REGISTERED' };
    const health = manager.health();
    return { ok: health.ok, health, diagnostics: manager.diagnosticsSnapshot() };
  }
}

export class UnifiedRoutesCommand {
  constructor(app) { this.app = app; this.signature = 'unified:routes'; this.description = 'List HTTP routes and registered realtime/RPC handlers.'; }
  async handle() {
    const manager = managerOf(this.app);
    if (!manager) return { ok: false, code: 'UNIFIED_NOT_REGISTERED' };
    const http = manager.app?.diagnostics?.()?.native?.http?.router || manager.original?.diagnostics?.()?.router || null;
    return {
      ok: true,
      http,
      websocket: manager.protocols.ws?.snapshot?.({ includeStun: false, includeSignaling: false }) || null,
      tcpHandlers: Array.from(manager.protocols.tcp?._handlers?.keys?.() || []),
      udpRoutes: Array.from(manager.protocols.udp?.routes?.keys?.() || []),
    };
  }
}

export class UnifiedStatsCommand {
  constructor(app) { this.app = app; this.signature = 'unified:stats'; this.description = 'Print unified protocol metrics and pressure.'; }
  async handle(input = {}) {
    const manager = managerOf(this.app);
    if (!manager) return { ok: false, code: 'UNIFIED_NOT_REGISTERED' };
    return input.prometheus === true ? manager.metricsOutput('prometheus') : manager.metricsSnapshot();
  }
}

export default { UnifiedServeCommand, UnifiedDoctorCommand, UnifiedRoutesCommand, UnifiedStatsCommand };
