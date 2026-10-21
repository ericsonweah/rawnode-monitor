# API reference

All exported ESM symbols are listed below from actual loaded modules. Signatures retain JavaScript defaults; options objects are described in the configuration reference and concrete source. Methods beginning with `_` are private implementation details. Low-level objects expose trusted application control; only the documented runtime/Studio boundaries sanitize outward telemetry. All capability exports remain available from the root for compatibility.

## @rawnode/monitor

`ALERT_COMPARATORS`, `AlertEngine`, `AlertRule`, `AlertRuleError`, `AlertState`, `AlwaysOffSampler`, `AlwaysOnSampler`, `AnomalyDetector`, `BLOCKED_OBJECT_KEYS`, `BaseInstrument`, `BaseMonitorCommand`, `BoundedSignalQueue`, `CallbackExporter`, `CallbackNotificationChannel`, `CardinalityLimitError`, `CompositeTelemetryStore`, `CorrelationEngine`, `Counter`, `DEFAULT_HISTOGRAM_BUCKETS`, `DeploymentRegistry`, `DiagnosticBundleBuilder`, `EventExporter`, `EventMonitorBridge`, `EventNotificationChannel`, `ExporterRegistry`, `FakeMonitorClock`, `FleetRegistry`, `Gauge`, `HealthRegistry`, `HealthStatus`, `Histogram`, `HttpJsonExporter`, `InMemorySpanStore`, `IncidentManager`, `IncidentState`, `JsonlTelemetryStore`, `LeaderLease`, `LeakDetector`, `LoggerMonitorBridge`, `LoggerNotificationChannel`, `MONITOR_COMPATIBILITY_PROFILES`, `MONITOR_DEFAULTS`, `MONITOR_SCHEMA_VERSION`, `MONITOR_VERSION`, `MemoryTelemetryStore`, `MetricDefinitionError`, `MetricHistory`, `MetricRegistry`, `MonitorAlertsCommand`, `MonitorAnomaliesCommand`, `MonitorBundleCommand`, `MonitorCapacityError`, `MonitorClosedError`, `MonitorConfiguration`, `MonitorConfigurationError`, `MonitorContextManager`, `MonitorCorrelateCommand`, `MonitorDeploymentCommand`, `MonitorDiagnosticsCommand`, `MonitorDoctor`, `MonitorDoctorCommand`, `MonitorError`, `MonitorFlushCommand`, `MonitorHealthCommand`, `MonitorIncidentsCommand`, `MonitorLifecycle`, `MonitorLogTransport`, `MonitorManager`, `MonitorMetricsCommand`, `MonitorPluginManager`, `MonitorPrometheusCommand`, `MonitorQueryEngine`, `MonitorRecorder`, `MonitorResourcesCommand`, `MonitorRuntime`, `MonitorSecurityError`, `MonitorSlosCommand`, `MonitorState`, `MonitorStatusCommand`, `MonitorStudioAssets`, `MonitorStudioAuthorizer`, `MonitorStudioController`, `MonitorStudioManager`, `MonitorStudioRateLimiter`, `MonitorSyntheticsCommand`, `MonitorTimeoutError`, `MonitorTracesCommand`, `NoopSpan`, `NoopTelemetryStore`, `NotificationRouter`, `ObservableGauge`, `OperationInstrumentor`, `OtlpJsonExporter`, `OverflowPolicy`, `PMMonitorBridge`, `ParentBasedSampler`, `ProcessMetricsCollector`, `ProtocolMonitorBridge`, `RAWNODE_MONITOR_COMMANDS`, `RAWNODE_RESOURCE_CATALOG`, `RawMongoTelemetryStore`, `RawNodeIntegrationManager`, `RedisMonitorBridge`, `ResourceRegistry`, `RetentionManager`, `RunbookRegistry`, `SafeTelemetrySerializer`, `SamplingDecision`, `SignalKind`, `SignalPipeline`, `SignalSpanProcessor`, `SilenceManager`, `SloDefinition`, `SloRegistry`, `Span`, `SpanKind`, `SpanStatus`, `StatsdExporter`, `StreamingBaseline`, `SyntheticCheck`, `SyntheticMonitor`, `SystemMetricsCollector`, `TelemetryAuthenticator`, `TelemetryEnvelope`, `TelemetryRedactor`, `Timer`, `TraceContext`, `TraceContextError`, `TraceIdRatioSampler`, `Tracer`, `UpDownCounter`, `bool`, `boundedInteger`, `boundedNumber`, `bytesOf`, `callFirst`, `cloneValue`, `cooperativeYield`, `createMonitor`, `createMonitorClusterEnvelope`, `createMonitorFetch`, `createMonitorHttpMiddleware`, `createTelemetryEnvelope`, `createTelemetryStore`, `deepFreeze`, `dispatchEvent`, `elapsedMs`, `epochNanos`, `errorRecord`, `extractTraceContext`, `flattenResourceNumbers`, `formatBaggage`, `formatOtlpJson`, `formatPrometheus`, `globalMonitorContext`, `hasBinding`, `injectTraceContext`, `instrumentOperations`, `isPlainObject`, `labelsKey`, `list`, `metricValue`, `noop`, `normalizeLabels`, `nowNs`, `parseBaggage`, `parseBytes`, `parseDuration`, `parseTraceParent`, `randomHex`, `randomId`, `registerMonitorStudioRoutes`, `registerRawNodeIntegrations`, `renderMonitorStudioPage`, `resolveMonitorCompatibilityProfile`, `resolveMonitorConfiguration`, `resolveSampler`, `retry`, `safeGet`, `safeResolve`, `sanitizeLabelName`, `sanitizeMetricName`, `sha256`, `signEnvelope`, `stableJson`, `stableValue`, `verifyMonitorClusterEnvelope`, `withTimeout`.

## @rawnode/monitor/metrics

`BaseInstrument`, `Counter`, `Gauge`, `Histogram`, `MetricHistory`, `MetricRegistry`, `ObservableGauge`, `Timer`, `UpDownCounter`, `formatPrometheus`.

## @rawnode/monitor/pipeline

`BoundedSignalQueue`, `SignalPipeline`.

## @rawnode/monitor/studio

`MonitorStudioAssets`, `MonitorStudioAuthorizer`, `MonitorStudioController`, `MonitorStudioManager`, `MonitorStudioRateLimiter`, `registerMonitorStudioRoutes`, `renderMonitorStudioPage`.

## @rawnode/monitor/tracing

`AlwaysOffSampler`, `AlwaysOnSampler`, `InMemorySpanStore`, `NoopSpan`, `ParentBasedSampler`, `SamplingDecision`, `SignalSpanProcessor`, `Span`, `TraceContext`, `TraceIdRatioSampler`, `Tracer`, `extractTraceContext`, `formatBaggage`, `injectTraceContext`, `parseBaggage`, `parseTraceParent`, `resolveSampler`.

## @rawnode/monitor/cluster

`FleetRegistry`, `LeaderLease`, `RedisMonitorBridge`, `createMonitorClusterEnvelope`, `signEnvelope`, `verifyMonitorClusterEnvelope`.

## @rawnode/monitor/core

`MonitorContextManager`, `MonitorLifecycle`, `TelemetryEnvelope`, `createTelemetryEnvelope`, `globalMonitorContext`.

## @rawnode/monitor/analysis

`AnomalyDetector`, `CorrelationEngine`, `LeakDetector`, `StreamingBaseline`.

## @rawnode/monitor/security

`SafeTelemetrySerializer`, `TelemetryAuthenticator`, `TelemetryRedactor`.

## @rawnode/monitor/plugins

`MonitorPluginManager`.

## @rawnode/monitor/synthetics

`SyntheticCheck`, `SyntheticMonitor`.

## @rawnode/monitor/exporters

`CallbackExporter`, `EventExporter`, `ExporterRegistry`, `HttpJsonExporter`, `OtlpJsonExporter`, `StatsdExporter`, `formatOtlpJson`.

## @rawnode/monitor/health

`HealthRegistry`.

## @rawnode/monitor/resources

`RAWNODE_RESOURCE_CATALOG`, `ResourceRegistry`, `flattenResourceNumbers`.

## @rawnode/monitor/storage

`CompositeTelemetryStore`, `JsonlTelemetryStore`, `MemoryTelemetryStore`, `NoopTelemetryStore`, `RawMongoTelemetryStore`, `RetentionManager`, `createTelemetryStore`.

## @rawnode/monitor/alerts

`ALERT_COMPARATORS`, `AlertEngine`, `AlertRule`, `CallbackNotificationChannel`, `EventNotificationChannel`, `LoggerNotificationChannel`, `NotificationRouter`, `SilenceManager`, `metricValue`.

## @rawnode/monitor/integrations

`EventMonitorBridge`, `LoggerMonitorBridge`, `MonitorLogTransport`, `OperationInstrumentor`, `PMMonitorBridge`, `ProtocolMonitorBridge`, `RawNodeIntegrationManager`, `createMonitorFetch`, `createMonitorHttpMiddleware`, `instrumentOperations`, `registerRawNodeIntegrations`.

## @rawnode/monitor/testing

`FakeMonitorClock`, `MonitorRecorder`.

## @rawnode/monitor/system

`ProcessMetricsCollector`, `SystemMetricsCollector`.

## @rawnode/monitor/diagnostics

`DiagnosticBundleBuilder`, `MonitorDoctor`.

## @rawnode/monitor/slo

`SloDefinition`, `SloRegistry`.

## @rawnode/monitor/query

`MonitorQueryEngine`.

## @rawnode/monitor/incidents

`IncidentManager`, `RunbookRegistry`.

## @rawnode/monitor/deployments

`DeploymentRegistry`.

## @rawnode/monitor/console

`BaseMonitorCommand`, `MonitorAlertsCommand`, `MonitorAnomaliesCommand`, `MonitorBundleCommand`, `MonitorCorrelateCommand`, `MonitorDeploymentCommand`, `MonitorDiagnosticsCommand`, `MonitorDoctorCommand`, `MonitorFlushCommand`, `MonitorHealthCommand`, `MonitorIncidentsCommand`, `MonitorMetricsCommand`, `MonitorPrometheusCommand`, `MonitorResourcesCommand`, `MonitorSlosCommand`, `MonitorStatusCommand`, `MonitorSyntheticsCommand`, `MonitorTracesCommand`, `RAWNODE_MONITOR_COMMANDS`.

## Optional entrypoints

`/config` exports the environment-derived default configuration. `/provider` exports `MonitorServiceProvider(app, {allowsBackgroundAutoStart?, assetsRoot?})`, with `register`, `boot`, `teardown` and preserved Foundation bindings. `/studio/client` exports `mountMonitorStudio(root, {fetch?, EventSource?})`; its returned handle supports `refresh(): Promise<void>`, `navigate(view): Promise<void>`, `snapshot()` and idempotent `destroy()`. It also auto-mounts when its standard DOM root exists.

## Concrete constructor and method signatures

These complete source signatures document optional component APIs without dropping extension features. Synchronous registration validates definitions and returns the component/record or disposer shown in source; asynchronous operations return promises. Runtime startup/flush/close behavior and error policies are detailed in LIFECYCLE.md.

### src/MonitorManager.js

```js
constructor(options = {})
create(name = this.defaultName, options = {})
runtime(name = this.defaultName)
default()
register(name, runtime, options = {})
names()
async start(options = {})
async close(options = {})
health(options = {})
metrics(options = {})
prometheus(options = {})
snapshot(options = {})
get tracer()
get alerts()
get incidents()
get slos()
get query()
```

### src/MonitorRuntime.js

```js
export function createMonitor(options = {})
constructor(options = {})
get state()
get enabled()
async start(options = {})
emitSignal(kind, payload, options = {})
emitEvent(name, payload = null, options = {})
emitLog(level, message, context = {}, options = {})
async ingest(signals, options = {})
collectMetrics(options = {})
collectResources(options = {})
registerResource(name, resource, options = {})
registerHealth(name, check, options = {})
registerAlert(rule, options = {})
registerSlo(definition, options = {})
registerRunbook(runbook, options = {})
registerAnomaly(definition, options = {})
registerLeak(definition, options = {})
registerSynthetic(definition, options = {})
registerPlugin(plugin, options = {})
registerExporter(name, exporter, options = {})
recordDeployment(input = {})
correlate(input = {}, options = {})
trace(name, options, callback)
startSpan(name, options = {})
run(context, callback, ...args)
bind(callback, context)
freezeDefinitions()
sanitizeTelemetry(value)
metricsSnapshot(options = {})
prometheus(options = {})
async health(options = {})
async readiness(options = {})
async liveness(options = {})
doctor(options = {})
diagnosticBundle(options = {})
async diagnostics(options = {})
snapshot(options = {})
async flush(options = {})
async close(options = {})
```

### src/alerts/AlertEngine.js

```js
constructor(options = {})
register(input, options = {})
unregister(id)
freeze()
start()
async evaluate(options = {})
acknowledge(ruleId, actor = null)
async close(options = {})
current(options = {})
historySnapshot(options = {})
snapshot()
```

### src/alerts/AlertRule.js

```js
export function metricValue(snapshot, rule)
constructor(options = {})
validate()
async test(context = {})
recovered(value)
toJSON()
```

### src/alerts/NotificationRouter.js

```js
constructor(options = {})
register(name, channel, options = {})
route(match = {}, channels = [])
async notify(notification, options = {})
async close(options = {})
snapshot()
constructor(logger)
async send(notification)
constructor(events, event = 'monitor:notification')
async send(notification)
```

### src/alerts/SilenceManager.js

```js
constructor(options = {})
create(options = {})
remove(id)
match(rule, now = Date.now())
prune(now = Date.now())
snapshot()
```

### src/analysis/AnomalyDetector.js

```js
constructor(options = {})
register(input = {}, options = {})
unregister(id)
observe(metric, input, labels = {}, context = {})
observeSnapshot(snapshot = {}, context = {})
current(ruleId = null)
alertRule(id, options = {})
freeze()
close()
snapshot(options = {})
```

### src/analysis/CorrelationEngine.js

```js
constructor(options = {})
async correlate(input = {}, options = {})
snapshot()
```

### src/analysis/LeakDetector.js

```js
constructor(options = {})
register(input = {}, options = {})
observe(metric, value, labels = {}, timestamp = Date.now(), context = {})
observeSnapshot(snapshot = {}, context = {})
alertRule(id, options = {})
current()
freeze()
close()
snapshot(options = {})
```

### src/analysis/StreamingBaseline.js

```js
constructor(options = {})
observe(input, timestamp = Date.now())
analyze(input, options = {})
observeAndAnalyze(input, options = {})
samples()
statistics()
reset()
snapshot(options = {})
```

### src/cluster/FleetRegistry.js

```js
constructor(options = {})
heartbeat(input = {})
leave(instanceId, reason = 'graceful')
prune(now = Date.now())
get(instanceId)
list(options = {})
topology()
snapshot()
```

### src/cluster/LeaderLease.js

```js
constructor(options = {})
async acquire()
async renew()
async release()
isLeader()
snapshot()
async close()
```

### src/cluster/MonitorClusterEnvelope.js

```js
export function createMonitorClusterEnvelope(type, payload, options = {})
export function signEnvelope(envelope, secret)
export function verifyMonitorClusterEnvelope(envelope, options = {})
```

### src/cluster/RedisMonitorBridge.js

```js
constructor(redis, options = {})
async start()
async publish(type, payload, options = {})
snapshot()
async close()
```

### src/compatibility/CompatibilityProfile.js

```js
export function resolveMonitorCompatibilityProfile(profile = 'compat', overrides = {})
```

### src/config/MonitorConfiguration.js

```js
export function resolveMonitorConfiguration(input = {}, options = {})
constructor(input = {}, options = {})
get(pathValue, fallback = undefined)
snapshot()
validate()
```

### src/console/MonitorCommands.js

```js
constructor(app)
parse(argv = [])
argument(name, fallback = undefined)
option(name, fallback = undefined)
runtime()
output(value, options = {})
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
constructor(app)
async handle()
```

### src/core/MonitorContextManager.js

```js
constructor(options = {})
active()
merge(values = {})
run(context, callback, ...args)
enter(context)
bind(callback, context = this.active())
createRequestContext(req = {}, extra = {})
createJobContext(job = {}, extra = {})
disable()
```

### src/core/MonitorLifecycle.js

```js
constructor()
transition(next, meta = null)
snapshot()
```

### src/core/TelemetryEnvelope.js

```js
export function createTelemetryEnvelope(kind, payload, options = {})
constructor(kind, payload, options = {})
toJSON()
```

### src/deployments/DeploymentRegistry.js

```js
constructor(options = {})
record(input = {})
latest()
around(timestamp = Date.now(), options = {})
list(options = {})
compare(leftId, rightId)
snapshot()
```

### src/diagnostics/DiagnosticBundleBuilder.js

```js
constructor(monitor, options = {})
async build(options = {})
```

### src/diagnostics/MonitorDoctor.js

```js
constructor(monitor)
async inspect(options = {})
```

### src/errors.js

```js
constructor(message, options = {})
toJSON()
constructor(message, options = {})
constructor(message, options = {})
constructor(message, options = {})
constructor(message, options = {})
constructor(message = 'RawNode Monitor is closed.', options = {})
constructor(message, options = {})
constructor(message, options = {})
constructor(message, options = {})
constructor(message, options = {})
```

### src/exporters/CallbackExporter.js

```js
constructor(callback, options = {})
async export(signals, options = {})
async flush()
async close()
snapshot()
```

### src/exporters/EventExporter.js

```js
constructor(events, options = {})
async export(signals)
async close()
snapshot()
```

### src/exporters/ExporterRegistry.js

```js
constructor(options = {})
register(name, exporter, options = {})
remove(name)
get(name)
list()
freeze()
attach(pipeline)
async flush(options = {})
async close(options = {})
snapshot()
```

### src/exporters/HttpJsonExporter.js

```js
constructor(options = {})
async export(signals = [], options = {})
async flush()
async close()
snapshot()
```

### src/exporters/OtlpJsonExporter.js

```js
export function formatOtlpJson(signals = [], resource = {})
constructor(options = {})
```

### src/exporters/StatsdExporter.js

```js
constructor(options = {})
async export(signals)
async close()
snapshot()
```

### src/health/HealthRegistry.js

```js
constructor(options = {})
register(name, check, options = {})
unregister(name)
freeze()
list()
async ready(context = {})
async live(context = {})
async all(context = {})
async run(options = {})
latest()
historySnapshot(options = {})
snapshot()
```

### src/incidents/IncidentManager.js

```js
constructor(options = {})
async open(options = {})
async openFromAlert(alert)
async acknowledge(id, options = {})
async mitigate(id, options = {})
async resolve(id, options = {})
async closeIncident(id, options = {})
async annotate(id, options = {})
get(id)
list(options = {})
public(incident)
historySnapshot(options = {})
snapshot()
```

### src/incidents/RunbookRegistry.js

```js
constructor()
register(id, runbook = null, options = {})
get(id)
list()
freeze()
snapshot()
```

### src/integrations/EventMonitorBridge.js

```js
constructor(events, monitor, options = {})
start()
async close()
snapshot()
```

### src/integrations/HttpMonitorMiddleware.js

```js
export function createMonitorHttpMiddleware(monitor, options = {})
```

### src/integrations/LoggerMonitorBridge.js

```js
constructor(logger, monitor, options = {})
start()
async close()
snapshot()
```

### src/integrations/MonitorFetch.js

```js
export function createMonitorFetch(monitor, fetchImpl = globalThis.fetch, options = {})
```

### src/integrations/MonitorLogTransport.js

```js
constructor(monitor, options = {})
write(record)
log(record, callback)
handle(record)
async flush()
async close()
snapshot()
```

### src/integrations/OperationInstrumentor.js

```js
export function instrumentOperations(target, monitor, options = {})
constructor(monitor, options = {})
wrap(target)
invoke(target, method, operation, args, receiver = target)
```

### src/integrations/PMMonitorBridge.js

```js
constructor(pm, monitor, options = {})
start()
async close()
snapshot()
```

### src/integrations/ProtocolMonitorBridge.js

```js
constructor(protocol, monitor, options = {})
start()
observe(event, args)
async close()
snapshot()
```

### src/integrations/RawNodeIntegrationManager.js

```js
export function registerRawNodeIntegrations(app, monitor, options = {})
constructor(app, monitor, options = {})
attach(name, bridge)
start()
get(name)
async close()
snapshot()
```

### src/metrics/Instruments.js

```js
constructor(registry, type, name, options = {})
freeze()
reset()
definition()
constructor(registry, name, options = {})
add(value = 1, labels = {}, options = {})
inc(labels = {}, options = {})
labels(labels = {})
bind(labels = {})
snapshot()
constructor(registry, name, options = {})
add(value = 1, labels = {}, options = {})
inc(labels = {}, options = {})
dec(labels = {}, options = {})
labels(labels = {})
bind(labels = {})
snapshot()
constructor(registry, name, options = {})
set(value, labels = {}, options = {})
add(value, labels = {}, options = {})
labels(labels = {})
bind(labels = {})
snapshot()
constructor(registry, name, options = {})
record(value, labels = {}, options = {})
observe(value, labels = {}, options = {})
labels(labels = {})
bind(labels = {})
snapshot()
constructor(registry, name, options = {})
start(labels = {}, options = {})
async time(callback, labels = {}, options = {})
labels(labels = {})
bind(labels = {})
constructor(registry, name, callback, options = {})
async collect(context = {})
snapshot()
```

### src/metrics/MetricHistory.js

```js
constructor(options = {})
push(snapshot)
all(options = {})
latest()
clear()
snapshot()
```

### src/metrics/MetricRegistry.js

```js
constructor(options = {})
counter(name, options = {})
upDownCounter(name, options = {})
gauge(name, options = {})
histogram(name, options = {})
timer(name, options = {})
observableGauge(name, callback, options = {})
get(name)
has(name)
remove(name)
names()
freeze()
async collect(context = {})
snapshot(options = {})
reset(options = {})
definitionManifest()
```

### src/metrics/PrometheusFormatter.js

```js
export function formatPrometheus(snapshot, options = {})
```

### src/pipeline/BoundedSignalQueue.js

```js
constructor(options = {})
tryPush(value, options = {})
async push(value, options = {})
shift()
shiftMany(limit = 1_000)
clear(onDrop = null)
close()
snapshot()
```

### src/pipeline/SignalPipeline.js

```js
constructor(options = {})
addSink(name, sink, options = {})
removeSink(name)
start()
admit(envelope, options = {})
async admitAsync(envelope, options = {})
schedule()
async drain(options = {})
async flush(options = {})
async close(options = {})
snapshot()
```

### src/plugins/MonitorPluginManager.js

```js
constructor(options = {})
register(input, options = {})
hook(name, handler, options = {})
offHook(name, handler)
async setup(runtime)
async start(runtime = this.runtime)
async invoke(name, payload, context = {})
notify(name, payload, context = {})
async drainNotifications(options = {})
async flush(options = {})
freeze()
get(id)
list()
snapshot()
async close(options = {})
```

### src/provider/MonitorServiceProvider.js

```js
constructor(app, options = {})
register()
async boot()
async teardown()
```

### src/query/MonitorQueryEngine.js

```js
constructor(options = {})
async signals(options = {})
spans(options = {})
trace(traceId)
metric(name = null)
alertState(options = {})
incidentState(options = {})
sloState(id = null)
resourceState(name = null)
async aggregate(options = {})
async timeSeries(options = {})
snapshot()
```

### src/resources/ResourceRegistry.js

```js
export function flattenResourceNumbers(value, options = {}, prefix = '', output = [])
constructor(options = {})
register(name, resource, options = {})
unregister(name)
freeze()
list()
discover(app = this.app, options = {})
async collect(options = {})
async collectOne(name, options = {})
latestSnapshot(name = null)
snapshot()
```

### src/security/SafeTelemetrySerializer.js

```js
constructor(options = {})
sanitize(value, options = {})
stringify(value, options = {})
snapshot()
```

### src/security/TelemetryAuthenticator.js

```js
constructor(options = {})
sign(body, timestamp = Date.now())
verify(body, headers = {}, now = Date.now())
assert(body, headers = {})
```

### src/security/TelemetryRedactor.js

```js
constructor(options = {})
redact(value)
hash(value)
snapshot()
```

### src/slo/SloDefinition.js

```js
constructor(options = {})
async measure(context = {})
toJSON()
```

### src/slo/SloRegistry.js

```js
constructor(options = {})
register(input, options = {})
unregister(id)
freeze()
start()
async evaluate(options = {})
get(id)
all()
burnRate(id, windowMs = null, now = Date.now())
alertRules(options = {})
async close()
snapshot()
```

### src/storage/CompositeTelemetryStore.js

```js
constructor(stores = [], options = {})
add(name, store, options = {})
async writeMany(signals = [], options = {})
async write(signal, options = {})
async query(options = {})
async prune(options = {})
async flush(options = {})
async close(options = {})
snapshot()
```

### src/storage/JsonlTelemetryStore.js

```js
constructor(options = {})
async initialize()
async write(signal)
async writeMany(signals = [])
async query(options = {})
async prune(options = {})
async flush()
async close()
snapshot()
```

### src/storage/MemoryTelemetryStore.js

```js
constructor(options = {})
async write(signal)
async writeMany(signals = [])
all()
async query(options = {})
async prune(options = {})
async flush()
async close()
snapshot()
```

### src/storage/NoopTelemetryStore.js

```js
async write()
async writeMany()
async query(options = {})
async prune()
async flush()
async close()
snapshot()
```

### src/storage/RawMongoTelemetryStore.js

```js
constructor(database, options = {})
collection(kind)
async write(signal)
async writeMany(signals = [])
async query(options = {})
async prune(options = {})
async flush()
async close()
snapshot()
```

### src/storage/RetentionManager.js

```js
constructor(store, options = {})
start()
async run(now = Date.now())
async close()
snapshot()
```

### src/storage/createTelemetryStore.js

```js
export function createTelemetryStore(options = {}, dependencies = {})
```

### src/studio/MonitorStudioAssets.js

```js
constructor(options = {})
async read(name)
clear()
```

### src/studio/MonitorStudioAuthorizer.js

```js
constructor(options = {})
async check(req, options = {})
async assert(req, options = {})
```

### src/studio/MonitorStudioController.js

```js
constructor(options = {})
```

### src/studio/MonitorStudioManager.js

```js
constructor(options = {})
async authorize(req, options = {})
async overview(options = {})
metrics(options = {})
traces(options = {})
trace(traceId)
signals(options = {})
health(options = {})
resources(name = null)
alerts(options = {})
acknowledgeAlert(id, actor)
silence(input, actor)
removeSilence(id)
slos(id = null)
incidents(options = {})
acknowledgeIncident(id, input = {})
resolveIncident(id, input = {})
annotateIncident(id, input = {})
fleet()
deployments(options = {})
anomalies(options = {})
synthetics(options = {})
runSynthetic(id, options = {})
correlate(input = {}, options = {})
diagnostics(options = {})
bundle(options = {})
doctor(options = {})
stream(req, res)
broadcast(event, data)
async drainEvents()
snapshot()
async close()
```

### src/studio/MonitorStudioPage.js

```js
export function renderMonitorStudioPage(options = {})
```

### src/studio/MonitorStudioRateLimiter.js

```js
constructor(options = {})
consume(key, cost = 1, now = Date.now())
prune(now = Date.now())
snapshot()
```

### src/studio/registerMonitorStudioRoutes.js

```js
export function registerMonitorStudioRoutes(router, options = {})
```

### src/support.js

```js
export function isPlainObject(value)
export function deepFreeze(value, seen = new WeakSet())
export function cloneValue(value)
export function stableValue(value, seen = new WeakSet())
export function stableJson(value)
export function safeGet(value, path, fallback = undefined)
export function safeResolve(app, key, fallback = null)
export function hasBinding(app, key)
export function bytesOf(value, max = Number.MAX_SAFE_INTEGER)
export function boundedInteger(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER)
export function boundedNumber(value, fallback, minimum = -Infinity, maximum = Infinity)
export function bool(value, fallback = false)
export function list(value, fallback = [])
export function parseDuration(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER)
export function parseBytes(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER)
export function sanitizeMetricName(value, fallback = 'rawnode_monitor_metric')
export function sanitizeLabelName(value)
export function normalizeLabels(labels = {}, options = {})
export function labelsKey(labels = {})
export function errorRecord(error, options = {})
export async function withTimeout(task, timeoutMs, options = {})
export async function cooperativeYield(signal = null)
export async function retry(operation, options = {})
export function dispatchEvent(events, name, payload)
export function callFirst(value, methods, ...args)
```

### src/synthetics/SyntheticCheck.js

```js
constructor(input = {}, defaults = {})
```

### src/synthetics/SyntheticMonitor.js

```js
constructor(options = {})
register(input, options = {})
unregister(id)
start(options = {})
async run(id, options = {})
async runAll(options = {})
alertRule(id, options = {})
health()
freeze()
snapshot(options = {})
async close()
```

### src/system/ProcessMetricsCollector.js

```js
constructor(options = {})
start()
async collect(options = {})
snapshot()
async close()
```

### src/system/SystemMetricsCollector.js

```js
constructor(options = {})
start()
collect(options = {})
snapshot()
close()
```

### src/testing/MonitorRecorder.js

```js
constructor(options = {})
async start()
async flush()
async all(filter = {})
async kind(kind)
async traces()
async close()
constructor(now = 1_700_000_000_000)
advance(ms)
set(value)
```

### src/tracing/InMemorySpanStore.js

```js
constructor(options = {})
add(span)
trace(traceId)
query(options = {})
all()
prune(now = Date.now())
snapshot()
```

### src/tracing/Sampler.js

```js
export function resolveSampler(options = {})
constructor(ratio = 1)
shouldSample(context)
description()
constructor(root = new AlwaysOnSampler())
shouldSample(context, options = {})
description()
```

### src/tracing/SignalSpanProcessor.js

```js
constructor(emitter)
onEnd(span)
async forceFlush()
async shutdown()
snapshot()
```

### src/tracing/Span.js

```js
constructor(tracer, name, context, options = {})
get traceId()
get spanId()
isRecording()
spanContext()
setAttribute(key, value)
setAttributes(values = {})
addEvent(name, attributes = {}, timestamp = Date.now())
addLink(context, attributes = {})
setStatus(code, message = null)
updateName(name)
recordException(error, attributes = {})
end(options = {})
toJSON()
constructor(context)
get traceId()
get spanId()
isRecording()
spanContext()
setAttribute()
setStatus()
end()
toJSON()
```

### src/tracing/TraceContext.js

```js
export function parseTraceParent(value, options = {})
export function parseBaggage(value, options = {})
export function formatBaggage(baggage = {}, options = {})
export function extractTraceContext(carrier = {}, options = {})
export function injectTraceContext(context, carrier = {}, options = {})
constructor(options = {})
get sampled()
traceparent()
child(spanId = randomHex(8), options = {})
toJSON()
```

### src/tracing/Tracer.js

```js
constructor(options = {})
activeSpan()
activeContext()
startSpan(name, options = {})
startActiveSpan(name, options, callback)
async trace(name, options, callback)
onEnd(span)
sanitizeAttribute(value)
sanitizeAttributes(values = {})
query(options = {})
traceById(traceId)
snapshot(options = {})
async forceFlush()
async close()
```

## Error contracts

Errors derive from MonitorError where defined and carry `code`, `status`, `retryable`, `details`, optional `cause`, and `toJSON()`. Type/definition validation may throw TypeError or Error. Admission commonly returns `{accepted:false,reason}` rather than throwing; strict rejection may throw a capacity error. Registry health failures become structured unhealthy reports. Required delivery/close failures can produce AggregateError with a MONITOR_* code. The list below is derived from source and includes failure, timeout, closed and authentication codes.

- `MONITOR_ALERT_CALLBACK_BUSY`
- `MONITOR_ALERT_RULE_ERROR`
- `MONITOR_ASSET_NOT_FOUND`
- `MONITOR_BODY_TOO_LARGE`
- `MONITOR_CAPACITY_EXCEEDED`
- `MONITOR_CARDINALITY_LIMIT`
- `MONITOR_CLOSED`
- `MONITOR_CLUSTER_ENVELOPE_TOO_LARGE`
- `MONITOR_COLLECTOR_BUSY`
- `MONITOR_CONFIGURATION_ERROR`
- `MONITOR_DURABLE_STORAGE_UNAVAILABLE`
- `MONITOR_ERROR`
- `MONITOR_EXPORTER_CLOSED`
- `MONITOR_EXPORT_PAYLOAD_TOO_LARGE`
- `MONITOR_EXPORT_RESPONSE_ABORTED`
- `MONITOR_EXPORT_RESPONSE_TOO_LARGE`
- `MONITOR_EXPORT_SERIALIZATION_FAILED`
- `MONITOR_EXPORT_TIMEOUT`
- `MONITOR_INGEST_DISABLED`
- `MONITOR_INGEST_SECRET_MISSING`
- `MONITOR_INGEST_SECRET_REQUIRED`
- `MONITOR_INGEST_SIGNATURE_INVALID`
- `MONITOR_INVALID_BUNDLE_ID`
- `MONITOR_METRIC_DEFINITION_ERROR`
- `MONITOR_NOTIFICATION_BUSY`
- `MONITOR_NOTIFICATION_CLOSED`
- `MONITOR_NOTIFICATION_LIMIT`
- `MONITOR_PIPELINE_CLOSED`
- `MONITOR_PIPELINE_CLOSE_FAILED`
- `MONITOR_PIPELINE_FLUSH_FAILED`
- `MONITOR_PLUGIN_CALLBACK_BUSY`
- `MONITOR_PLUGIN_CALLBACK_LIMIT`
- `MONITOR_PLUGIN_CLOSED`
- `MONITOR_PLUGIN_CLOSE_FAILED`
- `MONITOR_PLUGIN_CYCLE`
- `MONITOR_PLUGIN_DEPENDENCY_MISSING`
- `MONITOR_PLUGIN_FLUSH_FAILED`
- `MONITOR_PLUGIN_HOOK_LIMIT`
- `MONITOR_QUEUE_CLOSED`
- `MONITOR_QUEUE_WAITER_LIMIT`
- `MONITOR_QUEUE_WAIT_TIMEOUT`
- `MONITOR_REQUIRED_STORAGE_FAILED`
- `MONITOR_REQUIRED_STORAGE_LIFECYCLE_FAILED`
- `MONITOR_RUNTIME_IN_USE`
- `MONITOR_SECURITY_ERROR`
- `MONITOR_SERIES_LIMIT_ORDER`
- `MONITOR_SIGNAL_EXCEEDS_QUEUE`
- `MONITOR_SINK_BUSY`
- `MONITOR_SINK_INCOMPLETE_WRITE`
- `MONITOR_STORAGE_DEPENDENCY_MISSING`
- `MONITOR_STORAGE_INCOMPLETE_WRITE`
- `MONITOR_STREAM_UNAVAILABLE`
- `MONITOR_STUDIO_CSRF`
- `MONITOR_STUDIO_FORBIDDEN`
- `MONITOR_STUDIO_HOST`
- `MONITOR_STUDIO_LOCAL_ONLY`
- `MONITOR_STUDIO_ORIGIN`
- `MONITOR_STUDIO_PUBLIC_UNAUTHORIZED`
- `MONITOR_STUDIO_RATE_LIMIT`
- `MONITOR_STUDIO_UNAUTHORIZED`
- `MONITOR_STUDIO_UNCONFIGURED`
- `MONITOR_SYNTHETIC_ABORTED`
- `MONITOR_SYNTHETIC_BODY`
- `MONITOR_SYNTHETIC_CLOSED`
- `MONITOR_SYNTHETIC_EXPECTATION`
- `MONITOR_SYNTHETIC_REDIRECT_BODY`
- `MONITOR_SYNTHETIC_REDIRECT_DOWNGRADE`
- `MONITOR_SYNTHETIC_REDIRECT_UNSAFE`
- `MONITOR_SYNTHETIC_RESPONSE_TOO_LARGE`
- `MONITOR_SYNTHETIC_STATUS`
- `MONITOR_SYNTHETIC_UNREGISTERED`
- `MONITOR_SYNTHETIC_WAITER_LIMIT`
- `MONITOR_TIMEOUT`
- `MONITOR_TRACE_CONTEXT_ERROR`

## Readiness behavior corrections

Trace ratio sampling compares a 52-bit trace-ID suffix to a matching 52-bit bound; a configured 0.5 no longer admits every suffix. Async context `bind(callback, context)` preserves the requested context across awaits. Malformed percent-encoded baggage keys are ignored. HTTP middleware uses `route: unmatched` when no template/resolver is available, avoiding request-specific series. Health/resource registration replacement, alert/notification callbacks, direct exporter shutdown and admitted file writes follow the ownership rules in LIFECYCLE.md. Concrete `TelemetryEnvelope`, `Tracer` and `Span.end({endTimeUnixNano})` declarations match runtime behavior. Broad advanced extension types remain available.
