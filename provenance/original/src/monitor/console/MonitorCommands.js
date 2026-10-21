'use strict';

function safeResolve(app, key, fallback = null) {
  try { return app?.resolve?.(key) ?? app?.container?.resolve?.(key) ?? fallback; }
  catch { return fallback; }
}
function boolean(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}
function integer(value, fallback, min = 1, max = 100_000) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

export class BaseMonitorCommand {
  constructor(app) { this.app = app; this.signature = ''; this.description = ''; this.args = Object.create(null); this.flags = Object.create(null); }
  parse(argv = []) {
    this.args = Object.create(null); this.flags = Object.create(null);
    const parts = this.signature.trim().split(/\s+/);
    if (parts[0] !== argv[0]) return false;
    const positionals = [];
    for (let index = 1; index < argv.length; index++) {
      const value = argv[index];
      if (String(value).startsWith('--')) {
        const equal = value.indexOf('=');
        const key = equal === -1 ? value.slice(2) : value.slice(2, equal);
        if (equal !== -1) this.flags[key] = value.slice(equal + 1);
        else if (argv[index + 1] != null && !String(argv[index + 1]).startsWith('-')) this.flags[key] = argv[++index];
        else this.flags[key] = true;
      } else positionals.push(value);
    }
    let cursor = 0;
    for (const part of parts.slice(1)) if (part.startsWith('{') && part.endsWith('}')) this.args[part.slice(1, -1).replace(/[?*]$/, '')] = positionals[cursor++];
    return true;
  }
  argument(name, fallback = undefined) { return this.args[name] ?? fallback; }
  option(name, fallback = undefined) { return this.flags[name] ?? fallback; }
  runtime() { const value = safeResolve(this.app, 'monitor.runtime') || safeResolve(this.app, 'monitor'); if (!value) throw new Error('RawNode Monitor runtime is not registered.'); return typeof value.default === 'function' && !value.configuration ? value.default() : value; }
  output(value, options = {}) {
    const json = boolean(this.option('json'), options.json === true);
    if (typeof value === 'string' && !json) process.stdout.write(value.endsWith('\n') ? value : `${value}\n`);
    else process.stdout.write(`${JSON.stringify(value, null, json ? 2 : 2)}\n`);
    return value;
  }
}

export class MonitorStatusCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:status'; this.description = 'Show RawNode Monitor runtime, health, pipeline, fleet, and incident status.'; }
  async handle() { return this.output(this.runtime().snapshot({ limit: integer(this.option('limit'), 25) })); }
}
export class MonitorDoctorCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:doctor'; this.description = 'Run production-readiness diagnostics for RawNode Monitor.'; }
  async handle() { const report = await this.runtime().doctor({ deep: boolean(this.option('deep')) }); this.output(report); if (!report.ok) process.exitCode = 1; return report; }
}
export class MonitorMetricsCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:metrics {name}'; this.description = 'Inspect metric instruments, series, and optional history.'; }
  async handle() { const value = this.runtime().metricsSnapshot({ history: boolean(this.option('history')), name: this.argument('name'), limit: integer(this.option('limit'), 100) }); return this.output(value); }
}
export class MonitorPrometheusCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:prometheus'; this.description = 'Print Prometheus text exposition for the current runtime.'; }
  async handle() { return this.output(this.runtime().prometheus(), { json: false }); }
}
export class MonitorHealthCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:health'; this.description = 'Run Monitor readiness, liveness, and dependency checks.'; }
  async handle() { const runtime = this.runtime(); const mode = this.option('readiness') ? 'readiness' : this.option('liveness') ? 'liveness' : 'health'; const report = mode === 'readiness' ? await runtime.readiness({ fresh: true }) : mode === 'liveness' ? await runtime.liveness({ fresh: true }) : await runtime.health({ fresh: true }); this.output(report); if (report.ok === false) process.exitCode = 1; return report; }
}
export class MonitorResourcesCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:resources {name}'; this.description = 'Collect or inspect registered RawNode resource telemetry.'; }
  async handle() { const runtime = this.runtime(); const name = this.argument('name'); const value = boolean(this.option('collect')) ? await runtime.collectResources({ fresh: true }) : name ? runtime.resources.latestSnapshot(name) : runtime.resources.snapshot(); return this.output(value); }
}
export class MonitorTracesCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:traces {traceId}'; this.description = 'Query recent traces or inspect one trace waterfall.'; }
  async handle() { const runtime = this.runtime(); const traceId = this.argument('traceId'); const value = traceId ? runtime.tracer.traceById(traceId) : runtime.tracer.query({ limit: integer(this.option('limit'), 100), status: this.option('status'), minDurationMs: this.option('min-duration-ms') }); return this.output(value); }
}
export class MonitorAlertsCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:alerts {action} {id}'; this.description = 'List, evaluate, acknowledge, or silence monitor alerts.'; }
  async handle() {
    const runtime = this.runtime(); const action = this.argument('action', 'list'); const id = this.argument('id');
    let value;
    if (action === 'evaluate') value = await runtime.alerts.evaluate();
    else if (action === 'acknowledge') value = { ok: runtime.alerts.acknowledge(id, this.option('actor') || 'console') };
    else if (action === 'silence') value = runtime.alerts.silences.create({ ruleIds: id ? [id] : [], durationMs: integer(this.option('duration-ms'), 60 * 60_000, 1, 30 * 24 * 60 * 60_000), reason: this.option('reason', 'Console maintenance'), createdBy: this.option('actor', 'console') });
    else value = { current: runtime.alerts.current({ state: this.option('state'), severity: this.option('severity') }), history: runtime.alerts.historySnapshot({ limit: integer(this.option('limit'), 100) }), silences: runtime.alerts.silences.snapshot() };
    return this.output(value);
  }
}
export class MonitorSlosCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:slos {id}'; this.description = 'Evaluate and inspect SLO compliance, error budgets, and burn rates.'; }
  async handle() { const runtime = this.runtime(); if (boolean(this.option('evaluate'))) await runtime.slos.evaluate(); const id = this.argument('id'); return this.output(id ? runtime.slos.get(id) : runtime.slos.snapshot()); }
}
export class MonitorIncidentsCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:incidents {action} {id}'; this.description = 'List, acknowledge, annotate, resolve, or close incidents.'; }
  async handle() {
    const manager = this.runtime().incidents; const action = this.argument('action', 'list'); const id = this.argument('id'); const actor = this.option('actor', 'console'); let value;
    if (action === 'acknowledge') value = manager.acknowledge(id, { actor, message: this.option('message') });
    else if (action === 'annotate') value = manager.annotate(id, { actor, message: this.option('message', 'Console annotation') });
    else if (action === 'resolve') value = manager.resolve(id, { actor, message: this.option('message', 'Resolved from console') });
    else if (action === 'close') value = manager.closeIncident(id, { actor, message: this.option('message') });
    else value = { incidents: manager.list({ state: this.option('state'), severity: this.option('severity'), limit: integer(this.option('limit'), 100) }), history: manager.historySnapshot({ limit: integer(this.option('limit'), 100) }) };
    return this.output(value);
  }
}
export class MonitorAnomaliesCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:anomalies {kind}'; this.description = 'Inspect adaptive anomaly baselines and leak-trend detections.'; }
  async handle() { const runtime = this.runtime(); const kind = this.argument('kind', 'all'); const options = { includeBaselines: boolean(this.option('baselines')), includeSeries: boolean(this.option('series')) }; const value = kind === 'leaks' ? runtime.leaks.snapshot(options) : kind === 'adaptive' ? runtime.anomalies.snapshot(options) : { anomalies: runtime.anomalies.snapshot(options), leaks: runtime.leaks.snapshot(options) }; return this.output(value); }
}
export class MonitorSyntheticsCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:synthetics {action} {id}'; this.description = 'List or execute HTTP, TCP, DNS, and custom synthetic checks.'; }
  async handle() { const runtime = this.runtime(); const action = this.argument('action', 'list'); const id = this.argument('id'); let value; if (action === 'run') value = id ? await runtime.synthetics.run(id, { force: boolean(this.option('force')) }) : await runtime.synthetics.runAll({ force: boolean(this.option('force')) }); else value = runtime.synthetics.snapshot({ includeHistory: boolean(this.option('history')), limit: integer(this.option('limit'), 100) }); return this.output(value); }
}
export class MonitorCorrelateCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:correlate {traceId}'; this.description = 'Build a ranked cross-signal timeline around a trace, request, incident, or timestamp.'; }
  async handle() { const value = await this.runtime().correlate({ traceId: this.argument('traceId'), requestId: this.option('request-id'), tenantId: this.option('tenant'), timestamp: this.option('timestamp') ? Number(this.option('timestamp')) : Date.now() }, { windowMs: this.option('window-ms') ? Number(this.option('window-ms')) : undefined, limit: integer(this.option('limit'), 500) }); return this.output(value); }
}

export class MonitorDiagnosticsCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:diagnostics'; this.description = 'Print a redacted, bounded Monitor diagnostics snapshot.'; }
  async handle() { return this.output(await this.runtime().diagnostics({ includeSignals: boolean(this.option('signals')), signalLimit: integer(this.option('limit'), 100), includeRecentTraces: boolean(this.option('traces')) })); }
}
export class MonitorBundleCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:bundle'; this.description = 'Create a compressed, redacted incident diagnostics bundle.'; }
  async handle() { return this.output(await this.runtime().diagnosticBundle({ reason: this.option('reason', 'console-manual'), includeSignals: boolean(this.option('signals'), true) })); }
}
export class MonitorDeploymentCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:deployment {status}'; this.description = 'Record a deployment marker for metric, trace, and incident correlation.'; }
  async handle() { return this.output(this.runtime().recordDeployment({ status: this.argument('status', 'deployed'), version: this.option('version'), buildId: this.option('build'), commit: this.option('commit'), actor: this.option('actor'), strategy: this.option('strategy') })); }
}
export class MonitorFlushCommand extends BaseMonitorCommand {
  constructor(app) { super(app); this.signature = 'monitor:flush'; this.description = 'Flush bounded telemetry queues and exporters.'; }
  async handle() { return this.output(await this.runtime().flush({ timeoutMs: integer(this.option('timeout-ms'), 10_000, 100, 600_000) })); }
}

export const RAWNODE_MONITOR_COMMANDS = Object.freeze([
  MonitorStatusCommand,
  MonitorDoctorCommand,
  MonitorMetricsCommand,
  MonitorPrometheusCommand,
  MonitorHealthCommand,
  MonitorResourcesCommand,
  MonitorTracesCommand,
  MonitorAlertsCommand,
  MonitorSlosCommand,
  MonitorIncidentsCommand,
  MonitorAnomaliesCommand,
  MonitorSyntheticsCommand,
  MonitorCorrelateCommand,
  MonitorDiagnosticsCommand,
  MonitorBundleCommand,
  MonitorDeploymentCommand,
  MonitorFlushCommand,
]);
