'use strict';

import os from 'node:os';
import { EventEmitter } from 'node:events';
import { MonitorState, SignalKind } from './constants.js';
import MonitorConfiguration from './config/MonitorConfiguration.js';
import MonitorContextManager from './core/MonitorContextManager.js';
import MonitorLifecycle from './core/MonitorLifecycle.js';
import { createTelemetryEnvelope } from './core/TelemetryEnvelope.js';
import SafeTelemetrySerializer from './security/SafeTelemetrySerializer.js';
import TelemetryRedactor from './security/TelemetryRedactor.js';
import TelemetryAuthenticator from './security/TelemetryAuthenticator.js';
import SignalPipeline from './pipeline/SignalPipeline.js';
import MetricRegistry from './metrics/MetricRegistry.js';
import MetricHistory from './metrics/MetricHistory.js';
import { formatPrometheus } from './metrics/PrometheusFormatter.js';
import Tracer from './tracing/Tracer.js';
import SignalSpanProcessor from './tracing/SignalSpanProcessor.js';
import HealthRegistry from './health/HealthRegistry.js';
import ResourceRegistry, { flattenResourceNumbers } from './resources/ResourceRegistry.js';
import { createTelemetryStore } from './storage/createTelemetryStore.js';
import RetentionManager from './storage/RetentionManager.js';
import ExporterRegistry from './exporters/ExporterRegistry.js';
import EventExporter from './exporters/EventExporter.js';
import HttpJsonExporter from './exporters/HttpJsonExporter.js';
import OtlpJsonExporter from './exporters/OtlpJsonExporter.js';
import StatsdExporter from './exporters/StatsdExporter.js';
import CallbackExporter from './exporters/CallbackExporter.js';
import AlertEngine from './alerts/AlertEngine.js';
import NotificationRouter, { CallbackNotificationChannel, EventNotificationChannel, LoggerNotificationChannel } from './alerts/NotificationRouter.js';
import SloRegistry from './slo/SloRegistry.js';
import IncidentManager from './incidents/IncidentManager.js';
import RunbookRegistry from './incidents/RunbookRegistry.js';
import SystemMetricsCollector from './system/SystemMetricsCollector.js';
import AnomalyDetector from './analysis/AnomalyDetector.js';
import LeakDetector from './analysis/LeakDetector.js';
import CorrelationEngine from './analysis/CorrelationEngine.js';
import SyntheticMonitor from './synthetics/SyntheticMonitor.js';
import MonitorPluginManager from './plugins/MonitorPluginManager.js';
import FleetRegistry from './cluster/FleetRegistry.js';
import LeaderLease from './cluster/LeaderLease.js';
import RedisMonitorBridge from './cluster/RedisMonitorBridge.js';
import DeploymentRegistry from './deployments/DeploymentRegistry.js';
import MonitorQueryEngine from './query/MonitorQueryEngine.js';
import MonitorDoctor from './diagnostics/MonitorDoctor.js';
import DiagnosticBundleBuilder from './diagnostics/DiagnosticBundleBuilder.js';
import RawNodeIntegrationManager from './integrations/RawNodeIntegrationManager.js';
import { deepFreeze, dispatchEvent, errorRecord, randomId, safeResolve, withTimeout } from './support.js';

/**
 * RawNode Monitor's embeddable observability control plane.
 *
 * The runtime owns no network listener. Studio/API routes, remote ingestion,
 * and exporters are optional adapters. Every signal enters a bounded pipeline,
 * so application work never waits for disk or network telemetry delivery.
 */
export class MonitorRuntime extends EventEmitter {
  constructor(options = {}) {
    super();
    this.app = options.app || options.application || null;
    this.root = options.root || this.app?.rootPath || this.app?.basePath || process.cwd();
    this.configuration = options.configuration instanceof MonitorConfiguration
      ? options.configuration
      : new MonitorConfiguration(options.config || options, { root: this.root, profile: options.profile, profileOverrides: options.profileOverrides });
    const config = this.configuration.snapshot();
    this.lifecycle = service(options.lifecycle, ['transition', 'snapshot']) || new MonitorLifecycle();
    this.context = service(options.context, ['run', 'active']) || new MonitorContextManager({ base: identityContext(config) });
    this.serializer = service(options.serializer, ['sanitize', 'stringify']) || new SafeTelemetrySerializer({ ...config.security, includeErrorStack: config.compatibility.captureErrorStacks });
    this.redactor = service(options.redactor, ['redact']) || new TelemetryRedactor({ enabled: config.security.redact, ...config.security });
    this.authenticator = service(options.authenticator, ['verify', 'sign']) || new TelemetryAuthenticator({ secret: config.security.ingestSecret, ...config.security });
    this.sequence = 0;
    this.closed = false;
    this.startPromise = null;
    this.closePromise = null;
    this.timers = new Map();
    this.startController = null;
    this.closeRequested = false;
    this.activeCollections = new Map();
    this.collectionController = new AbortController();
    this.logger = options.logger || safeResolve(this.app, 'logger') || this.app?.logger || console;
    this.events = options.events || safeResolve(this.app, 'events');
    this.database = options.database || safeResolve(this.app, 'database') || safeResolve(this.app, 'rawmongo') || safeResolve(this.app, 'mongo');
    this.redis = options.redis || safeResolve(this.app, 'redis') || safeResolve(this.app, 'redis.client');

    this.pipeline = service(options.pipeline, ['admit', 'flush']) || new SignalPipeline({ ...config.pipeline, errorPolicy: config.compatibility.exporterErrorPolicy });
    this.metrics = service(options.metricsRegistry || options.metrics, ['counter', 'snapshot']) || new MetricRegistry({
      ...config.metrics,
      allowLateRegistration: config.compatibility.allowLateRegistration,
      allowLateSeries: config.compatibility.allowLateRegistration,
      cardinalityPolicy: config.compatibility.cardinalityPolicy,
      contextProvider: () => this.context.active(),
    });
    this.metricHistory = service(options.metricHistory, ['push', 'latest']) || new MetricHistory({ limit: config.metrics.historyLimit });
    this.spanProcessor = service(options.spanProcessor, ['onEnd']) || new SignalSpanProcessor((kind, payload, signalOptions) => this.emitSignal(kind, payload, signalOptions));
    this.tracer = service(options.tracer, ['startSpan', 'trace']) || new Tracer({ ...config.tracing, contextManager: this.context, processor: this.spanProcessor, sanitize: (value) => this.sanitizeTelemetry(value), resource: identityResource(config) });
    this.healthRegistry = service(options.healthRegistry, ['register', 'all']) || new HealthRegistry(config.health);
    this.resources = service(options.resourceRegistry || options.resources, ['register', 'collect']) || new ResourceRegistry({ ...config.resources, app: this.app, serializer: this.serializer, healthRegistry: this.healthRegistry });
    this.store = service(options.store, ['writeMany', 'query']) || createTelemetryStore(config.storage, { database: this.database, serializer: this.serializer });
    this.retention = service(options.retention, ['start', 'run']) || new RetentionManager(this.store, { retentionMs: config.storage.retentionMs });
    this.exporters = options.exporters instanceof ExporterRegistry ? options.exporters : new ExporterRegistry();
    this.notifications = service(options.notifications, ['register', 'notify']) || new NotificationRouter({ errorPolicy: config.compatibility.exporterErrorPolicy });
    this.runbooks = service(options.runbookRegistry || options.runbooks, ['register', 'get']) || new RunbookRegistry();
    this.incidents = service(options.incidentManager || options.incidents, ['open', 'list']) || new IncidentManager({ ...config.incidents, runbooks: this.runbooks, signal: (kind, payload, signalOptions) => this.emitSignal(kind, payload, signalOptions), diagnosticsProvider: (input) => this.diagnostics({ incident: input.incident, includeSignals: true, signalLimit: 250 }) });
    this.slos = service(options.sloRegistry || options.slos, ['register', 'evaluate']) || new SloRegistry({ ...config.slo, signal: (kind, payload, signalOptions) => this.emitSignal(kind, payload, signalOptions), contextProvider: () => this._evaluationContext() });
    this.leader = service(options.leader, ['acquire', 'isLeader']) || new LeaderLease({ redis: config.cluster.enabled ? this.redis : null, key: config.cluster.leaderKey || `rawnode:monitor:${config.service}:${config.environment}:leader`, owner: config.instanceId || `${os.hostname()}:${process.pid}`, ttlMs: config.cluster.leaseMs });
    this.alerts = service(options.alertEngine || options.alerts, ['register', 'evaluate']) || new AlertEngine({ ...config.alerts, notifications: this.notifications, incidents: this.incidents, leader: config.cluster.enabled ? this.leader : null, signal: (kind, payload, signalOptions) => this.emitSignal(kind, payload, signalOptions), contextProvider: () => this._evaluationContext() });
    this.system = service(options.systemCollector || options.system, ['start', 'collect']) || new SystemMetricsCollector({ ...config.system, intervalMs: config.collectionIntervalMs, registry: this.metrics, signal: (kind, payload, signalOptions) => this.emitSignal(kind, payload, signalOptions) });
    this.fleet = service(options.fleet, ['heartbeat', 'topology']) || new FleetRegistry({ leaseMs: config.cluster.leaseMs });
    this.clusterBridge = service(options.clusterBridge, ['start', 'publish']) || (config.cluster.enabled && this.redis && config.cluster.mode !== 'standalone'
      ? new RedisMonitorBridge(this.redis, { ...config.cluster, source: config.instanceId || `${os.hostname()}:${process.pid}`, namespace: `${config.service}:${config.environment}`, secret: config.cluster.secret || config.security.ingestSecret })
      : null);
    this.deployments = service(options.deploymentRegistry || options.deployments, ['record', 'list']) || new DeploymentRegistry({ signal: (kind, payload, signalOptions) => this.emitSignal(kind, payload, signalOptions) });
    this.anomalies = service(options.anomalyDetector || options.anomalies, ['register', 'observeSnapshot']) || new AnomalyDetector({ ...config.analysis, signal: (kind, payload, signalOptions) => this.emitSignal(kind, payload, signalOptions) });
    this.leaks = service(options.leakDetector || options.leaks, ['register', 'observeSnapshot']) || new LeakDetector({ ...config.analysis, signal: (kind, payload, signalOptions) => this.emitSignal(kind, payload, signalOptions) });
    this.correlations = service(options.correlationEngine || options.correlations, ['correlate', 'snapshot']) || new CorrelationEngine({ store: this.store, tracer: this.tracer, deployments: this.deployments, windowMs: config.analysis.correlationWindowMs, maxCandidates: config.analysis.correlationMaxCandidates });
    this.synthetics = service(options.syntheticMonitor || options.synthetics, ['register', 'run']) || new SyntheticMonitor({ ...config.synthetics, registry: this.metrics, signal: (kind, payload, signalOptions) => this.emitSignal(kind, payload, signalOptions) });
    this.plugins = service(options.pluginManager, ['register', 'setup']) || new MonitorPluginManager({ ...config.plugins, errorPolicy: config.plugins.errorPolicy || config.compatibility.exporterErrorPolicy });
    for (const plugin of options.plugins || []) this.plugins.register(plugin);
    this.query = service(options.queryEngine || options.query, ['signals', 'aggregate']) || new MonitorQueryEngine({ store: this.store, tracer: this.tracer, metrics: this.metrics, alerts: this.alerts, incidents: this.incidents, slos: this.slos, resources: this.resources, maxLimit: config.studio.maxQueryLimit });
    this.doctorService = service(options.doctor, ['inspect']) || new MonitorDoctor(this);
    this.bundleBuilder = service(options.bundleBuilder, ['build']) || new DiagnosticBundleBuilder(this, { path: config.incidents.path });
    this.integrations = service(options.integrationManager, ['start', 'snapshot']) || new RawNodeIntegrationManager(this.app, this, { failFast: config.failFast, services: { events: options.events, logger: options.logger, pm: options.pm, unified: options.unified, websocket: options.websocket, tcp: options.tcp, udp: options.udp } });
    this.stats = { admitted: 0, rejected: 0, disabled: 0, emitted: Object.create(null), collections: 0, collectionErrors: 0, starts: 0, closes: 0 };

    this._registerSelfMetrics();
    this._registerHealthChecks();
    this._registerConfiguredDefinitions(options);
    this._configureNotifications(options);
    this._configureExporters(options);
    this._attachPipelineSinks();
    this._wireEvents();
  }

  get state() { return this.lifecycle.state; }
  get enabled() { return this.configuration.get('enabled') === true; }

  _registerSelfMetrics() {
    this.selfMetrics = {
      admitted: this.metrics.counter('monitor_signals_admitted_total'),
      rejected: this.metrics.counter('monitor_signals_rejected_total'),
      queueItems: this.metrics.gauge('monitor_pipeline_queue_items'),
      queueBytes: this.metrics.gauge('monitor_pipeline_queue_bytes', { unit: 'bytes' }),
      collectionErrors: this.metrics.counter('monitor_collection_errors_total'),
      resourceValue: this.metrics.gauge('monitor_resource_value', { maxSeries: Math.min(20_000, this.configuration.get('metrics.maxSeriesPerInstrument', 2_000) * 10) }),
      health: this.metrics.gauge('monitor_health_status', { description: '1 healthy, 0 unhealthy.' }),
      fleet: this.metrics.gauge('monitor_fleet_instances'),
    };
  }

  _registerHealthChecks() {
    this.healthRegistry.register('monitor.runtime', () => ({ ok: this.state === MonitorState.RUNNING || this.state === MonitorState.STARTING, ready: this.state === MonitorState.RUNNING, live: ![MonitorState.FAILED, MonitorState.STOPPED].includes(this.state), details: this.lifecycle.snapshot() }), { kind: 'liveness', critical: true });
    this.healthRegistry.register('monitor.pipeline', () => { const snapshot = this.pipeline.snapshot(); return { ok: !snapshot.closed && snapshot.queue.closed !== true, degraded: snapshot.queue.length > snapshot.queue.maxItems * 0.8, details: snapshot }; }, { kind: 'readiness', critical: true });
    this.healthRegistry.register('monitor.store', () => { const snapshot = this.store.snapshot?.() || {}; return { ok: snapshot.closed !== true, details: snapshot }; }, { kind: 'dependency', critical: this.configuration.get('storage.enabled') === true });
    this.healthRegistry.register('monitor.cardinality', () => { const snapshot = this.metrics.snapshot(); return { ok: snapshot.series < this.configuration.get('metrics.maxSeries'), degraded: snapshot.series > this.configuration.get('metrics.maxSeries') * 0.8, details: { series: snapshot.series, maximum: this.configuration.get('metrics.maxSeries') } }; }, { kind: 'readiness', critical: false });
    this.healthRegistry.register('monitor.synthetics', () => this.synthetics.health(), { kind: 'dependency', critical: false });
  }

  _registerConfiguredDefinitions(options) {
    const runbooks = Array.isArray(options.runbooks) ? options.runbooks : this.configuration.get('incidents.runbooks', []);
    const slos = Array.isArray(options.slos) ? options.slos : this.configuration.get('slo.definitions', []);
    const rules = Array.isArray(options.alertRules) ? options.alertRules : this.configuration.get('alerts.rules', []);
    const anomalyRules = Array.isArray(options.anomalyRules) ? options.anomalyRules : this.configuration.get('analysis.rules', []);
    const leakRules = Array.isArray(options.leakRules) ? options.leakRules : this.configuration.get('analysis.leakRules', []);
    const syntheticChecks = Array.isArray(options.syntheticChecks) ? options.syntheticChecks : this.configuration.get('synthetics.checks', []);
    for (const runbook of runbooks) this.runbooks.register(runbook);
    for (const definition of slos) this.slos.register(definition);
    for (const rule of rules) this.alerts.register(rule);
    for (const definition of anomalyRules) {
      const rule = this.anomalies.register(definition);
      if (rule.alert) this.alerts.register(this.anomalies.alertRule(rule.id), { replace: true });
    }
    for (const definition of leakRules) {
      const rule = this.leaks.register(definition);
      if (rule.alert) this.alerts.register(this.leaks.alertRule(rule.id), { replace: true });
    }
    for (const definition of syntheticChecks) { const check = this.synthetics.register(definition); if (check.alert) this.alerts.register(this.synthetics.alertRule(check.id), { replace: true }); }
    if (this.configuration.get('analysis.enabled') && this.configuration.get('analysis.defaults', true) !== false) this._registerDefaultAnalysis();
    if (this.configuration.get('alerts.defaults', true) !== false) this._registerDefaultRules();
    for (const rule of this.slos.alertRules({ rates: this.configuration.get('slo.burnRates') })) this.alerts.register(rule, { replace: true });
  }

  _registerDefaultAnalysis() {
    const loopMetric = this.metrics.get('monitor_event_loop_delay_seconds')?.name || `${this.configuration.get('metrics.prefix')}_monitor_event_loop_delay_seconds`;
    const cpuMetric = this.metrics.get('monitor_process_cpu_percent')?.name || `${this.configuration.get('metrics.prefix')}_monitor_process_cpu_percent`;
    const memoryMetric = this.metrics.get('monitor_process_memory_bytes')?.name || `${this.configuration.get('metrics.prefix')}_monitor_process_memory_bytes`;
    this.anomalies.register({ id: 'monitor-adaptive-event-loop-p99', name: 'Adaptive event-loop p99 anomaly', metric: loopMetric, labels: { quantile: 'p99' }, method: 'mad', threshold: 6, minimum: 0.05, warmupSamples: 30, cooldownMs: 5 * 60_000, severity: 'warning', alert: false, tags: ['runtime', 'adaptive', 'event-loop'] }, { replace: true });
    this.anomalies.register({ id: 'monitor-adaptive-cpu', name: 'Adaptive process CPU anomaly', metric: cpuMetric, method: 'mad', threshold: 6, minimum: 30, warmupSamples: 30, cooldownMs: 5 * 60_000, severity: 'warning', alert: false, tags: ['runtime', 'adaptive', 'cpu'] }, { replace: true });
    const leaks = [
      { id: 'monitor-rss-leak-trend', name: 'Process RSS leak trend', kind: 'rss', slope: 64 * 1024 * 1024 },
      { id: 'monitor-heap-leak-trend', name: 'Process heap leak trend', kind: 'heapUsed', slope: 32 * 1024 * 1024 },
    ];
    for (const definition of leaks) this.registerLeak({ id: definition.id, name: definition.name, metric: memoryMetric, labels: { kind: definition.kind }, windowSamples: 60, minSamples: 30, minSlopePerMinute: definition.slope, minGrowthRatio: 0.25, minR2: 0.9, cooldownMs: 30 * 60_000, severity: 'warning', incident: false, runbook: 'monitor.memory-leak', tags: ['runtime', 'memory', 'leak'] }, { replace: true });
    this.runbooks.register({ id: 'monitor.memory-leak', title: 'Memory growth or leak trend', summary: 'Confirm sustained process memory growth before replacing an instance.', steps: ['Compare RSS, heap-used, external, array-buffer, GC, and active-resource trends.', 'Correlate the first growth inflection with deployments and high-allocation traces.', 'Capture a diagnostics bundle and a Node diagnostic report before restart.', 'Use RawNode PM for a graceful instance replacement only after evidence is preserved.'] }, { replace: true });
  }

  _registerDefaultRules() {
    const loopMetric = this.metrics.get('monitor_event_loop_delay_seconds')?.name || `${this.configuration.get('metrics.prefix')}_monitor_event_loop_delay_seconds`;
    const queueMetric = this.selfMetrics.queueItems.name;
    this.alerts.register({ id: 'monitor-event-loop-p99-high', name: 'Event-loop p99 delay high', description: 'Sustained event-loop p99 delay threatens application latency.', severity: 'warning', metric: loopMetric, labels: { quantile: 'p99' }, comparator: 'gt', threshold: this.configuration.get('alerts.eventLoopP99Seconds', 0.2), recoveryThreshold: this.configuration.get('alerts.eventLoopRecoverySeconds', 0.1), pendingForMs: this.configuration.get('alerts.eventLoopPendingMs', 30_000), runbook: 'monitor.event-loop', tags: ['runtime', 'event-loop'] });
    this.alerts.register({ id: 'monitor-pipeline-pressure', name: 'Monitor telemetry pipeline pressure', severity: 'warning', metric: queueMetric, comparator: 'gt', threshold: Math.max(1, Math.floor(this.configuration.get('pipeline.maxItems') * 0.8)), recoveryThreshold: Math.max(0, Math.floor(this.configuration.get('pipeline.maxItems') * 0.5)), pendingForMs: 15_000, tags: ['monitor', 'backpressure'] });
    this.alerts.register({ id: 'monitor-critical-health-failure', name: 'Critical RawNode health check failure', severity: 'critical', source: 'custom', pendingForMs: 5_000, incident: true, runbook: 'monitor.health', evaluate: ({ health }) => ({ firing: health?.ok === false, value: health?.ok === false ? 1 : 0, details: health }) });
    this.runbooks.register({ id: 'monitor.event-loop', title: 'High event-loop delay', summary: 'Identify synchronous work, excessive allocations, blocking callbacks, or CPU saturation.', steps: ['Inspect the trace explorer for long server/internal spans.', 'Compare CPU, GC duration, active resources, and deployment markers.', 'Capture a diagnostics bundle before any restart.', 'If configured, let RawNode PM perform a graceful replacement.'] });
    this.runbooks.register({ id: 'monitor.health', title: 'Critical health failure', summary: 'Determine which required dependency or runtime check failed.', steps: ['Open the health report and inspect the first critical failure.', 'Correlate nearby logs, traces, deployments, and resource snapshots.', 'Validate whether the failure is local or fleet-wide.', 'Mitigate or gracefully replace the affected instance.'] });
  }

  _configureNotifications(options) {
    if (this.logger) this.notifications.register('logger', new LoggerNotificationChannel(this.logger));
    if (this.events) this.notifications.register('events', new EventNotificationChannel(this.events));
    for (const [name, channel] of Object.entries(options.notificationChannels || {})) this.notifications.register(name, typeof channel === 'function' ? new CallbackNotificationChannel(channel) : channel);
    const routes = options.notificationRoutes || this.configuration.get('alerts.routes', []);
    for (const route of routes) this.notifications.route(route.match || {}, route.channels || []);
  }

  _configureExporters(options) {
    const config = this.configuration.get('exporters', {});
    if (this.events && this.configuration.get('integrations.events') !== false) this.exporters.register('events', new EventExporter(this.events, { eventName: 'monitor:signals' }), { priority: 20 });
    if (config.http?.enabled && config.http.url) this.exporters.register('http', new HttpJsonExporter({ ...config.http, secret: config.http.secret || this.configuration.get('security.ingestSecret') }), { required: config.http.required === true, priority: 30 });
    if (config.otlp?.enabled && config.otlp.url) this.exporters.register('otlp', new OtlpJsonExporter(config.otlp), { required: config.otlp.required === true, priority: 30 });
    if (config.statsd?.enabled) this.exporters.register('statsd', new StatsdExporter(config.statsd), { signals: [SignalKind.METRICS], priority: 40 });
    for (const [name, exporter] of Object.entries(options.customExporters || {})) this.exporters.register(name, typeof exporter === 'function' ? new CallbackExporter(exporter, { name }) : exporter);
  }

  _attachPipelineSinks() {
    if (this.store.snapshot?.().driver !== 'none') this.pipeline.addSink('store', this.store, { required: this.configuration.get('storage.enabled') && this.configuration.get('storage.required') === true, priority: 0 });
    this.exporters.attach(this.pipeline);
  }

  _wireEvents() {
    this.alerts.on('error', (error) => this._log('error', 'Monitor alert evaluation failed.', { error: errorRecord(error) }));
    this.slos.on('error', (error) => this._log('error', 'Monitor SLO evaluation failed.', { error: errorRecord(error) }));
    this.notifications.on('error', (error, channel) => this._log('error', 'Monitor notification failed.', { channel, error: errorRecord(error) }));
    this.system.on('collectorError', (error) => this._log('warn', 'Monitor system collector failed.', { error: errorRecord(error) }));
    this.plugins.on('pluginError', (record) => this._log('warn', 'Monitor plugin lifecycle failed.', record));
    this.synthetics.on('failureThreshold', (event) => dispatchEvent(this.events, 'monitor:synthetic:firing', event));
    this.synthetics.on('recovery', (event) => dispatchEvent(this.events, 'monitor:synthetic:recovered', event));
    this.anomalies.on('anomaly', (event) => dispatchEvent(this.events, 'monitor:anomaly:firing', event));
    this.anomalies.on('recovery', (event) => dispatchEvent(this.events, 'monitor:anomaly:recovered', event));
    this.leaks.on('leak', (event) => dispatchEvent(this.events, 'monitor:leak:firing', event));
    this.leaks.on('recovery', (event) => dispatchEvent(this.events, 'monitor:leak:recovered', event));
    this.pipeline.on('dropped', (_signal, reason) => { this.selfMetrics.rejected.inc({ reason: String(reason || 'overflow') }); });
    this.pipeline.on('sinkError', (error, sink) => { this.selfMetrics.collectionErrors.inc({ source: `sink:${sink}` }); this._log('error', 'Monitor sink failed.', { sink, error: errorRecord(error) }); });
    this.pipeline.on('pipelineError', (error) => this._log('error', 'Monitor pipeline failed.', error));
    this.healthRegistry.on('report', (report) => { this.selfMetrics.health.set(report.ok ? 1 : 0, { status: report.status }); this.emitSignal(SignalKind.HEALTH, report, { priority: report.ok ? 1 : 10 }); });
    this.resources.on('snapshot', (snapshot) => this._recordResourceNumbers(snapshot));
    this.fleet.on('expired', (instance) => this.emitEvent('monitor.fleet.instance.expired', instance, { priority: 10 }));
    this.clusterBridge?.on('heartbeat', (payload) => this.fleet.heartbeat(payload));
    this.clusterBridge?.on('signal', (payload) => this.ingest(payload, { remote: true }));
    this.lifecycle.on('transition', (transition) => { this.emit('state', transition); dispatchEvent(this.events, 'monitor:state', transition); });
  }

  async start(options = {}) {
    if (this.closeRequested || this.closed) throw Object.assign(new Error('Monitor runtime is closed; create a new runtime to restart.'), { code: 'MONITOR_CLOSED' });
    if (this.state === MonitorState.RUNNING) return this;
    if (this.startPromise) return await this.startPromise;
    if (this.closed && options.restart !== true) throw Object.assign(new Error('Monitor runtime is closed.'), { code: 'MONITOR_CLOSED' });
    this.startController = new AbortController();
    this.startPromise = this._start({ ...options, signal: this.startController.signal }).finally(() => { this.startPromise = null; });
    return await this.startPromise;
  }

  async _start(options) {
    this.lifecycle.transition(MonitorState.STARTING);
    this.stats.starts++;
    const phase = (task) => withTimeout(task, options.timeoutMs || this.configuration.get('shutdownTimeoutMs'), { signal: options.signal });
    try {
      await phase(() => this.store.initialize?.());
      this.pipeline.start();
      await phase(() => this.plugins.setup(this));
      await phase(() => this.plugins.start(this));
      if (this.configuration.get('resources.autoDiscover')) this.resources.discover(this.app, this.configuration.get('resources'));
      this.integrations.start();
      if (this.configuration.get('cluster.enabled')) {
        await phase(() => this.leader.acquire()).catch((error) => { if (this.configuration.get('failFast')) throw error; this._log('warn', 'Monitor leader lease unavailable.', { error: errorRecord(error) }); });
        await phase(() => this.clusterBridge?.start?.());
      }
      if (this.configuration.get('system.enabled')) this.system.start();
      if (this.configuration.get('synthetics.enabled')) this.synthetics.start();
      if (this.configuration.get('storage.enabled')) this.retention.start();
      if (this.configuration.get('slo.enabled')) this.slos.start();
      if (this.configuration.get('alerts.enabled')) this.alerts.start();
      this._schedule('metrics', this.configuration.get('collectionIntervalMs'), () => this.collectMetrics());
      this._schedule('resources', this.configuration.get('resources.intervalMs'), () => this.collectResources());
      this._schedule('health', this.configuration.get('alerts.intervalMs'), () => this.healthRegistry.all({ fresh: true }));
      if (this.configuration.get('cluster.enabled')) this._schedule('fleet', this.configuration.get('cluster.heartbeatMs'), () => this._fleetHeartbeat());
      await phase(() => this.collectMetrics({ initial: true, signal: options.signal }));
      await phase(() => this.collectResources({ initial: true, signal: options.signal }));
      await phase(() => this.healthRegistry.all({ fresh: true, signal: options.signal }));
      if (this.configuration.get('compatibility.freezeDefinitions')) this.freezeDefinitions();
      this.closed = false;
      this.lifecycle.transition(MonitorState.RUNNING);
      this.recordDeployment({ status: 'started', version: this.configuration.get('version'), buildId: this.configuration.get('buildId'), commit: this.configuration.get('commit') });
      this.emitEvent('monitor.started', { runtime: this.lifecycle.snapshot(), configuration: publicConfiguration(this.configuration.snapshot()) }, { priority: 5 });
      this.plugins.notify('runtime.started', this.snapshot());
      return this;
    } catch (error) {
      if (!this.closeRequested) {
        this.lifecycle.transition(MonitorState.FAILED, { error });
        this.closed = true;
        await this._closeComponents({ flush: false }).catch(() => {});
      }
      if (this.configuration.get('failFast') || options.throwOnError !== false) throw error;
      return this;
    }
  }

  _schedule(name, intervalMs, callback) {
    if (this.timers.has(name) || intervalMs <= 0) return;
    let pending = false;
    const timer = setInterval(() => {
      if (pending || this.closeRequested) return;
      pending = true;
      Promise.resolve().then(callback).catch((error) => { if (!this.closeRequested) { this.stats.collectionErrors++; this.selfMetrics.collectionErrors.inc({ source: name }); this.emit('collectionError', error, name); } }).finally(() => { pending = false; });
    }, intervalMs);
    timer.unref?.(); this.timers.set(name, timer);
  }

  emitSignal(kind, payload, options = {}) {
    if (!this.enabled || this.closed || this.state === MonitorState.STOPPING || this.state === MonitorState.STOPPED) { this.stats.disabled++; return Object.freeze({ accepted: false, reason: 'disabled' }); }
    if (!Object.values(SignalKind).includes(kind)) return Object.freeze({ accepted: false, reason: 'invalid-kind' });
    const active = this.context.active() || {};
    // Span objects are runtime controls, not telemetry attributes. Preserve only
    // their stable identifiers to avoid circular graphs and oversized signals.
    const { span: _activeSpan, ...activeContext } = active;
    const optionContext = options.context || {};
    const { span: _optionSpan, ...explicitContext } = optionContext;
    const context = this.serializer.sanitize({ ...activeContext, ...explicitContext }, { maxPayloadBytes: 64 * 1024 });
    const sanitized = this.serializer.sanitize(payload, { maxPayloadBytes: this.configuration.get('security.maxPayloadBytes') });
    const redacted = this.redactor.redact(sanitized);
    const envelope = createTelemetryEnvelope(kind, redacted, {
      ...identityContext(this.configuration.snapshot()),
      ...this.redactor.redact(this.serializer.sanitize(options)),
      context: this.redactor.redact(context),
      sequence: ++this.sequence,
    });
    const result = this.pipeline.admit(envelope, { priority: envelope.priority });
    const label = String(kind);
    this.stats.emitted[label] = (this.stats.emitted[label] || 0) + 1;
    if (result.accepted) { this.stats.admitted++; this.selfMetrics.admitted.inc({ kind: label }); }
    else { this.stats.rejected++; this.selfMetrics.rejected.inc({ kind: label, reason: String(result.reason || result.code || 'rejected') }); }
    this._updatePipelineMetrics();
    this.emit('signal', envelope, result);
    if (result.accepted) this.plugins.notify('signal.admitted', envelope, { admission: result });
    else this.plugins.notify('signal.rejected', envelope, { admission: result });
    return result;
  }

  emitEvent(name, payload = null, options = {}) { return this.emitSignal(SignalKind.EVENT, { name: String(name), payload, timestamp: Date.now() }, options); }
  emitLog(level, message, context = {}, options = {}) { return this.emitSignal(SignalKind.LOG, { level, message, context, timestamp: Date.now() }, options); }

  async ingest(signals, options = {}) {
    if (options.remote && !this.configuration.get('security.allowRemoteIngest')) return { accepted: 0, rejected: Array.isArray(signals) ? signals.length : 1, reason: 'remote-ingest-disabled' };
    const list = Array.isArray(signals) ? signals : signals?.signals || [signals];
    let accepted = 0; let rejected = 0;
    for (const input of list) {
      if (!input?.kind) { rejected++; continue; }
      const result = this.emitSignal(input.kind, input.payload, { context: { ...(input.context || {}), remote: options.remote === true }, traceId: input.traceId, spanId: input.spanId, priority: input.priority });
      if (result.accepted) accepted++; else rejected++;
    }
    return { accepted, rejected };
  }

  collectMetrics(options = {}) {
    if (this.closeRequested || this.closed) return Promise.resolve(null);
    if (this.activeCollections.has('Metrics')) return this.activeCollections.get('Metrics');
    const task = this._collectMetrics({ ...options, signal: options.signal || this.collectionController.signal }).finally(() => this.activeCollections.delete('Metrics'));
    this.activeCollections.set('Metrics', task);
    return task;
  }

  async _collectMetrics(options = {}) {
    if (!this.enabled || this.closed) return null;
    try {
      const snapshot = await withTimeout((signal) => this.metrics.collect({ monitor: this, options, signal }), this.configuration.get('health.timeoutMs'), { signal: options.signal });
      if (this.closeRequested) return null;
      this.metricHistory.push(snapshot);
      if (this.configuration.get('analysis.enabled')) {
        this.anomalies.observeSnapshot(snapshot, { source: 'metrics' });
        this.leaks.observeSnapshot(snapshot, { source: 'metrics' });
      }
      this.emitSignal(SignalKind.METRICS, snapshot, { priority: options.initial ? 2 : 0 });
      this.plugins.notify('metrics.collected', snapshot, { options });
      this.stats.collections++;
      this._updatePipelineMetrics();
      return snapshot;
    } catch (error) { this.stats.collectionErrors++; this.selfMetrics.collectionErrors.inc({ source: 'metrics' }); throw error; }
  }

  collectResources(options = {}) {
    if (this.closeRequested || this.closed) return Promise.resolve(null);
    if (this.activeCollections.has('Resources')) return this.activeCollections.get('Resources');
    const task = this._collectResources({ ...options, signal: options.signal || this.collectionController.signal }).finally(() => this.activeCollections.delete('Resources'));
    this.activeCollections.set('Resources', task);
    return task;
  }

  async _collectResources(options = {}) {
    if (!this.configuration.get('resources.enabled') || this.closed) return null;
    try {
      const snapshot = await this.resources.collect({ throwOnRequired: this.configuration.get('compatibility.resourceErrorPolicy') === 'propagate', ...options });
      if (this.closeRequested) return null;
      this.emitSignal(SignalKind.RESOURCE, snapshot, { priority: 1 });
      this.stats.collections++;
      return snapshot;
    } catch (error) { this.stats.collectionErrors++; this.selfMetrics.collectionErrors.inc({ source: 'resources' }); throw error; }
  }

  _recordResourceNumbers(snapshot) {
    for (const item of flattenResourceNumbers(snapshot.metrics || snapshot.health || {}, { maxDepth: 6, maxItems: 500 })) {
      this.selfMetrics.resourceValue.set(item.value, { resource: snapshot.name, path: item.path.slice(0, 192) });
    }
  }

  _updatePipelineMetrics() { const queue = this.pipeline.queue.snapshot(); this.selfMetrics.queueItems.set(queue.length); this.selfMetrics.queueBytes.set(queue.bytes); }

  async _evaluationContext() {
    const health = this.healthRegistry.latest() || await this.healthRegistry.all({ fresh: false });
    return { monitor: this, metrics: this.metricHistory.latest() || this.metrics.snapshot(), health, resources: this.resources.latestSnapshot(), slos: this.slos.all(), anomalies: this.anomalies.current(), leaks: this.leaks.current(), synthetics: this.synthetics.snapshot(), fleet: this.fleet.snapshot(), deployments: this.deployments.snapshot() };
  }

  async _fleetHeartbeat() {
    const config = this.configuration.snapshot();
    const heartbeat = { instanceId: config.instanceId || `${os.hostname()}:${process.pid}`, service: config.service, environment: config.environment, version: config.version, region: config.region, zone: config.zone, host: os.hostname(), pid: process.pid, state: this.state, health: this.healthRegistry.latest(), expiresAt: Date.now() + config.cluster.leaseMs };
    this.fleet.heartbeat(heartbeat); this.fleet.prune(); this.selfMetrics.fleet.set(this.fleet.instances.size);
    await this.clusterBridge?.publish?.('heartbeat', heartbeat).catch((error) => this._log('warn', 'Monitor fleet heartbeat publish failed.', { error: errorRecord(error) }));
    return heartbeat;
  }

  registerResource(name, resource, options = {}) { return this.resources.register(name, resource, options); }
  registerHealth(name, check, options = {}) { return this.healthRegistry.register(name, check, options); }
  registerAlert(rule, options = {}) { return this.alerts.register(rule, options); }
  registerSlo(definition, options = {}) { const value = this.slos.register(definition, options); for (const rule of this.slos.alertRules()) this.alerts.register(rule, { replace: true }); return value; }
  registerRunbook(runbook, options = {}) { return this.runbooks.register(runbook, options); }
  registerAnomaly(definition, options = {}) { const rule = this.anomalies.register(definition, options); if (rule.alert) this.alerts.register(this.anomalies.alertRule(rule.id), { replace: true }); return rule; }
  registerLeak(definition, options = {}) { const rule = this.leaks.register(definition, options); if (rule.alert) this.alerts.register(this.leaks.alertRule(rule.id), { replace: true }); return rule; }
  registerSynthetic(definition, options = {}) { const check = this.synthetics.register(definition, options); if (check.alert) this.alerts.register(this.synthetics.alertRule(check.id), { replace: true }); return check; }
  registerPlugin(plugin, options = {}) { return this.plugins.register(plugin, options); }
  registerExporter(name, exporter, options = {}) { const value = this.exporters.register(name, exporter, options); this.pipeline.addSink(`exporter:${name}`, exporter, options); return value; }
  recordDeployment(input = {}) { const config = this.configuration.snapshot(); return this.deployments.record({ service: config.service, environment: config.environment, instanceId: config.instanceId || `${os.hostname()}:${process.pid}`, region: config.region, ...input }); }
  correlate(input = {}, options = {}) { return this.correlations.correlate(input, options); }
  trace(name, options, callback) { return this.tracer.trace(name, options, callback); }
  startSpan(name, options = {}) { return this.tracer.startSpan(name, options); }
  run(context, callback, ...args) { return this.context.run(context, callback, ...args); }
  bind(callback, context) { return this.context.bind(callback, context); }

  freezeDefinitions() { this.metrics.freeze(); this.resources.freeze(); this.healthRegistry.freeze(); this.slos.freeze(); this.alerts.freeze(); this.runbooks.freeze(); this.exporters.freeze(); this.anomalies.freeze(); this.leaks.freeze(); this.synthetics.freeze(); this.plugins.freeze(); return this; }

  sanitizeTelemetry(value) { return this.redactor.redact(this.serializer.sanitize(value)); }
  metricsSnapshot(options = {}) { return this.sanitizeTelemetry(options.history ? { current: this.metrics.snapshot(), history: this.metricHistory.all(options) } : this.metrics.snapshot(options)); }
  prometheus(options = {}) { return formatPrometheus(this.metricsSnapshot(), options); }
  async health(options = {}) { return this.sanitizeTelemetry(await this.healthRegistry.all(options)); }
  async readiness(options = {}) { const report = this.sanitizeTelemetry(await this.healthRegistry.ready(options)); return this.state === MonitorState.RUNNING ? report : { ...report, ok: false, ready: false, status: 'unhealthy' }; }
  async liveness(options = {}) { return this.sanitizeTelemetry(await this.healthRegistry.live(options)); }
  doctor(options = {}) { return this.doctorService.inspect(options); }
  diagnosticBundle(options = {}) { return this.bundleBuilder.build(options); }

  async diagnostics(options = {}) {
    const signals = options.includeSignals ? await this.store.query({ limit: Math.max(1, Number(options.signalLimit) || 250) }).catch((error) => ({ error: errorRecord(error) })) : null;
    return deepFreeze(this.sanitizeTelemetry({
      timestamp: Date.now(),
      identity: identityContext(this.configuration.snapshot()),
      lifecycle: this.lifecycle.snapshot(),
      configuration: publicConfiguration(this.configuration.snapshot()),
      pipeline: this.pipeline.snapshot(),
      metrics: this.metrics.snapshot(),
      metricHistory: this.metricHistory.snapshot(),
      tracing: this.tracer.snapshot({ includeRecent: options.includeRecentTraces === true, limit: options.traceLimit || 100 }),
      health: this.healthRegistry.snapshot(),
      resources: this.resources.snapshot(),
      store: this.store.snapshot?.() || null,
      exporters: this.exporters.snapshot(),
      alerts: this.alerts.snapshot(),
      slos: this.slos.snapshot(),
      incidents: this.incidents.snapshot(),
      system: this.system.snapshot(),
      analysis: { anomalies: this.anomalies.snapshot(options), leaks: this.leaks.snapshot(options), correlations: this.correlations.snapshot() },
      synthetics: this.synthetics.snapshot({ includeHistory: options.includeSyntheticHistory === true, limit: options.syntheticLimit || 100 }),
      plugins: this.plugins.snapshot(),
      fleet: this.fleet.snapshot(),
      leader: this.leader.snapshot(),
      cluster: this.clusterBridge?.snapshot?.() || null,
      deployments: this.deployments.snapshot(),
      integrations: this.integrations.snapshot(),
      query: this.query.snapshot(),
      security: { serializer: this.serializer.snapshot(), redactor: this.redactor.snapshot() },
      signals,
      stats: { ...this.stats, emitted: { ...this.stats.emitted } },
    }));
  }

  snapshot(options = {}) {
    return deepFreeze(this.sanitizeTelemetry({
      state: this.state,
      enabled: this.enabled,
      identity: identityContext(this.configuration.snapshot()),
      lifecycle: this.lifecycle.snapshot(),
      health: this.healthRegistry.latest(),
      pipeline: this.pipeline.snapshot(),
      metrics: this.metrics.snapshot(),
      traces: this.tracer.snapshot({ includeRecent: options.includeRecent === true, limit: options.limit || 50 }),
      resources: this.resources.latestSnapshot(),
      alerts: this.alerts.current(),
      slos: this.slos.all(),
      incidents: this.incidents.list({ limit: options.limit || 50 }),
      anomalies: this.anomalies.current(),
      leaks: this.leaks.current(),
      synthetics: this.synthetics.snapshot({ includeHistory: options.includeRecent === true, limit: options.limit || 50 }),
      plugins: this.plugins.snapshot(),
      fleet: this.fleet.topology(),
      deployment: this.deployments.latest(),
      stats: { ...this.stats, emitted: { ...this.stats.emitted } },
    }));
  }

  async flush(options = {}) {
    await this.plugins.flush(options).catch((error) => { if (options.throwOnError === true) throw error; this._log('warn', 'Monitor plugin flush failed.', { error: errorRecord(error) }); });
    return await this.pipeline.flush({ timeoutMs: options.timeoutMs || this.configuration.get('flushTimeoutMs'), ...options });
  }

  async close(options = {}) {
    if (this.closePromise) return await this.closePromise;
    if (this.state === MonitorState.STOPPED) return this.snapshot();
    this.closeRequested = true;
    const reason = Object.assign(new Error('Monitor shutdown requested.'), { code: 'MONITOR_CLOSED' });
    this.startController?.abort(reason);
    this.collectionController.abort(reason);
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    this.closePromise = this._close(options).finally(() => { this.closePromise = null; });
    return await this.closePromise;
  }

  async _close(options) {
    if (this.startPromise) await this.startPromise.catch(() => {});
    if (this.state === MonitorState.IDLE) this.lifecycle.transition(MonitorState.STARTING);
    if (![MonitorState.STOPPING, MonitorState.STOPPED].includes(this.state)) this.lifecycle.transition(MonitorState.STOPPING);
    this.stats.closes++;
    const timeoutMs = options.timeoutMs || this.configuration.get('shutdownTimeoutMs');
    let failure;
    try { await withTimeout(() => this._closeComponents({ ...options, timeoutMs }), timeoutMs, { message: `Monitor shutdown exceeded ${timeoutMs}ms.` }); } catch (error) { failure = error; }
    this.closed = true;
    if (this.state !== MonitorState.STOPPED) this.lifecycle.transition(MonitorState.STOPPED);
    if (failure && options.throwOnError) throw failure;
    return this.snapshot();
  }

  async _closeComponents(options = {}) {
    for (const timer of this.timers.values()) clearInterval(timer); this.timers.clear();
    const timeoutMs = options.timeoutMs || this.configuration.get('shutdownTimeoutMs');
    const failures = [];
    const close = async (component) => {
      try { await withTimeout(() => component?.close?.(options), timeoutMs); }
      catch (error) { failures.push(error); }
    };
    // Start every independent cleanup before awaiting user-controlled hooks.
    await Promise.all([this.synthetics, this.plugins, this.anomalies, this.leaks,
      this.alerts, this.slos, this.system, this.integrations, this.clusterBridge,
      this.leader, this.retention, this.pipeline, this.tracer].map(close));
    this.context.disable();
    if (failures.length && options.throwOnError) throw new AggregateError(failures, 'Monitor cleanup failed.');
  }

  _log(level, message, context = null) { try { (this.logger?.[level] || this.logger?.log || console.log).call(this.logger || console, message, context); } catch {} }
  async [Symbol.asyncDispose]() { await this.close(); }
}

function service(value, methods) { return value && methods.every((method) => typeof value?.[method] === 'function') ? value : null; }
function identityContext(config) { return { service: config.service, environment: config.environment, version: config.version || null, instanceId: config.instanceId || `${os.hostname()}:${process.pid}`, region: config.region || null, zone: config.zone || null }; }
function identityResource(config) { return { 'service.name': config.service, 'service.version': config.version || '', 'deployment.environment': config.environment, 'service.instance.id': config.instanceId || `${os.hostname()}:${process.pid}`, 'cloud.region': config.region || '', 'cloud.availability_zone': config.zone || '', 'process.pid': process.pid, 'host.name': os.hostname(), 'telemetry.sdk.name': 'rawnode-monitor', 'telemetry.sdk.version': '1.0.0' }; }
function publicConfiguration(config) { return { enabled: config.enabled, profile: config.profile, service: config.service, environment: config.environment, version: config.version, instanceId: config.instanceId, region: config.region, zone: config.zone, metrics: config.metrics, tracing: config.tracing, pipeline: config.pipeline, health: config.health, resources: config.resources, storage: { ...config.storage, credentials: undefined }, exporters: { ...config.exporters, http: config.exporters?.http ? { ...config.exporters.http, headers: undefined, secret: undefined } : undefined }, alerts: config.alerts, slo: config.slo, incidents: config.incidents, system: config.system, analysis: config.analysis, synthetics: { ...config.synthetics, checks: (config.synthetics?.checks || []).map((check) => ({ ...check, headers: undefined, body: undefined })) }, plugins: config.plugins, studio: { ...config.studio, token: config.studio?.token ? '[configured]' : null }, cluster: { ...config.cluster, secret: config.cluster?.secret ? '[configured]' : null }, validation: config.validation }; }

export function createMonitor(options = {}) { return new MonitorRuntime(options); }
export default MonitorRuntime;
