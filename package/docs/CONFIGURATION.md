# Configuration reference

`new MonitorRuntime({config, ...injectedServices})` and `new MonitorConfiguration(config,{root,profile,profileOverrides})` accept explicit configuration. Without `config`, runtime options also form configuration. `/config` is the separate optional process.env reader; importing the runtime does not silently import that environment module. `configuration.get(path,fallback)`, `snapshot()` and `validate()` expose effective settings. Profiles compat/enterprise/production/strict/test overlay defaults; production-like profiles can freeze definitions and enforce validation. `test` disables system metrics and several background features, while keeping ordinary API capabilities.

Duration fields accept numeric milliseconds or strings with ms/s/m/h/d suffixes; byte fields accept numeric bytes or b/kb/kib/mb/mib/gb/gib suffixes where normalized. Out-of-range values are normalized to bounded defaults; strict profiles reject invalid security combinations. Explicit authorizers belong to MonitorStudioManager options. Config and executable callback options are trusted, not request payloads.

The table enumerates every source default; effective profiles can override these. Unknown extra object properties are preserved for extension compatibility.

| Key | Default |
| --- | --- |
| `enabled` | `true` |
| `profile` | `"compat"` |
| `service` | `"rawnode"` |
| `environment` | `"development"` |
| `version` | `null` |
| `instanceId` | `null` |
| `region` | `null` |
| `zone` | `null` |
| `tenant` | `null` |
| `bootSummary` | `true` |
| `failFast` | `null` |
| `collectionIntervalMs` | `10000` |
| `resourceIntervalMs` | `15000` |
| `shutdownTimeoutMs` | `15000` |
| `flushTimeoutMs` | `10000` |
| `metrics.enabled` | `null` |
| `metrics.prefix` | `"rawnode"` |
| `metrics.maxInstruments` | `10000` |
| `metrics.maxSeries` | `100000` |
| `metrics.maxSeriesPerInstrument` | `2000` |
| `metrics.maxLabels` | `24` |
| `metrics.maxLabelValueBytes` | `256` |
| `metrics.histogramBuckets` | `null` |
| `metrics.historyLimit` | `720` |
| `metrics.exemplars` | `true` |
| `tracing.enabled` | `null` |
| `tracing.sampleRate` | `null` |
| `tracing.parentBased` | `true` |
| `tracing.maxAttributes` | `64` |
| `tracing.maxAttributeBytes` | `4096` |
| `tracing.maxEvents` | `64` |
| `tracing.maxLinks` | `16` |
| `tracing.maxSpansInMemory` | `20000` |
| `tracing.maxTraceAgeMs` | `900000` |
| `tracing.captureStack` | `false` |
| `tracing.propagateBaggage` | `true` |
| `pipeline.maxItems` | `50000` |
| `pipeline.maxBytes` | `67108864` |
| `pipeline.maxWaiters` | `100000` |
| `pipeline.batchSize` | `512` |
| `pipeline.flushIntervalMs` | `500` |
| `pipeline.budgetMs` | `8` |
| `pipeline.overflow` | `"drop-oldest"` |
| `pipeline.maxSignalBytes` | `2097152` |
| `pipeline.maxInFlightBatches` | `2` |
| `pipeline.deliveryAttempts` | `3` |
| `pipeline.retryBaseMs` | `50` |
| `pipeline.retryMaxMs` | `2000` |
| `pipeline.failureHistoryLimit` | `256` |
| `health.enabled` | `true` |
| `health.timeoutMs` | `5000` |
| `health.concurrency` | `16` |
| `health.historyLimit` | `256` |
| `health.cacheTtlMs` | `1000` |
| `resources.enabled` | `true` |
| `resources.autoDiscover` | `true` |
| `resources.intervalMs` | `15000` |
| `resources.timeoutMs` | `5000` |
| `resources.maxPayloadBytes` | `524288` |
| `resources.include` | `[]` |
| `resources.exclude` | `[]` |
| `resources.required` | `[]` |
| `storage.enabled` | `null` |
| `storage.driver` | `"memory"` |
| `storage.drivers` | `[]` |
| `storage.queryStore` | `null` |
| `storage.path` | `"storage/framework/monitor"` |
| `storage.maxMemoryItems` | `50000` |
| `storage.maxMemoryBytes` | `134217728` |
| `storage.maxFileBytes` | `134217728` |
| `storage.maxReadBytes` | `67108864` |
| `storage.maxLineBytes` | `2097152` |
| `storage.retentionMs` | `2592000000` |
| `storage.flushIntervalMs` | `1000` |
| `storage.collectionPrefix` | `"monitor_"` |
| `storage.required` | `false` |
| `exporters.enabled` | `true` |
| `exporters.failFast` | `null` |
| `exporters.prometheus.enabled` | `true` |
| `exporters.prometheus.prefix` | `"rawnode"` |
| `exporters.http.enabled` | `false` |
| `exporters.http.url` | `null` |
| `exporters.http.timeoutMs` | `10000` |
| `exporters.http.compression` | `true` |
| `exporters.http.compressionThresholdBytes` | `1024` |
| `exporters.http.maxAttempts` | `3` |
| `exporters.http.retryBaseMs` | `100` |
| `exporters.http.retryMaxMs` | `5000` |
| `exporters.http.maxPayloadBytes` | `8388608` |
| `exporters.http.maxResponseBytes` | `65536` |
| `exporters.http.maxBatchSignals` | `256` |
| `exporters.http.rejectUnauthorized` | `true` |
| `exporters.http.required` | `false` |
| `exporters.otlp.enabled` | `false` |
| `exporters.otlp.url` | `null` |
| `exporters.otlp.timeoutMs` | `10000` |
| `exporters.otlp.compression` | `true` |
| `exporters.otlp.maxAttempts` | `3` |
| `exporters.otlp.maxPayloadBytes` | `8388608` |
| `exporters.otlp.maxResponseBytes` | `65536` |
| `exporters.otlp.maxBatchSignals` | `256` |
| `exporters.otlp.rejectUnauthorized` | `true` |
| `exporters.otlp.required` | `false` |
| `exporters.statsd.enabled` | `false` |
| `exporters.statsd.host` | `"127.0.0.1"` |
| `exporters.statsd.port` | `8125` |
| `exporters.statsd.prefix` | `"rawnode"` |
| `exporters.statsd.maxPacketBytes` | `8192` |
| `alerts.enabled` | `null` |
| `alerts.intervalMs` | `15000` |
| `alerts.concurrency` | `8` |
| `alerts.historyLimit` | `5000` |
| `alerts.defaultPendingForMs` | `0` |
| `alerts.defaultResolveAfterMs` | `0` |
| `alerts.defaultCooldownMs` | `300000` |
| `alerts.autoIncidentSeverities` | `["critical"]` |
| `slo.enabled` | `null` |
| `slo.intervalMs` | `60000` |
| `slo.historyLimit` | `44640` |
| `incidents.enabled` | `null` |
| `incidents.maxOpen` | `10000` |
| `incidents.historyLimit` | `20000` |
| `incidents.captureDiagnostics` | `true` |
| `incidents.diagnosticsTimeoutMs` | `10000` |
| `system.enabled` | `null` |
| `system.eventLoopResolutionMs` | `20` |
| `system.gc` | `true` |
| `system.activeResources` | `true` |
| `system.resourceUsage` | `true` |
| `analysis.enabled` | `null` |
| `analysis.defaults` | `true` |
| `analysis.maxRules` | `1000` |
| `analysis.maxSeries` | `10000` |
| `analysis.baselineSamples` | `256` |
| `analysis.warmupSamples` | `20` |
| `analysis.alpha` | `0.2` |
| `analysis.cooldownMs` | `300000` |
| `analysis.emitRecoveries` | `true` |
| `analysis.rules` | `[]` |
| `analysis.leakRules` | `[]` |
| `analysis.correlationWindowMs` | `900000` |
| `analysis.correlationMaxCandidates` | `10000` |
| `synthetics.enabled` | `null` |
| `synthetics.concurrency` | `8` |
| `synthetics.maxChecks` | `10000` |
| `synthetics.intervalMs` | `60000` |
| `synthetics.timeoutMs` | `10000` |
| `synthetics.historyLimit` | `5000` |
| `synthetics.maxResponseBytes` | `262144` |
| `synthetics.checks` | `[]` |
| `plugins.enabled` | `null` |
| `plugins.maxPlugins` | `1000` |
| `plugins.errorPolicy` | `"isolate"` |
| `plugins.maxPendingHooks` | `10000` |
| `plugins.maxPendingBytes` | `16777216` |
| `plugins.maxHookBytes` | `1048576` |
| `plugins.hookBatchSize` | `128` |
| `plugins.hookBudgetMs` | `4` |
| `plugins.hookOverflow` | `"drop-oldest"` |
| `security.redact` | `true` |
| `security.secretKeys` | `[]` |
| `security.hashTenantIds` | `false` |
| `security.hashUserIds` | `false` |
| `security.maxDepth` | `16` |
| `security.maxKeys` | `4096` |
| `security.maxArrayItems` | `10000` |
| `security.maxStringBytes` | `65536` |
| `security.maxPayloadBytes` | `2097152` |
| `security.ingestSecret` | `null` |
| `security.allowRemoteIngest` | `false` |
| `security.allowedOrigins` | `[]` |
| `studio.enabled` | `null` |
| `studio.prefix` | `"/__rawnode/monitor"` |
| `studio.production` | `false` |
| `studio.token` | `null` |
| `studio.localOnly` | `true` |
| `studio.pollIntervalMs` | `3000` |
| `studio.maxQueryLimit` | `1000` |
| `studio.metricsEndpoint` | `"/metrics"` |
| `studio.registerRoutes` | `true` |
| `studio.streamMaxBytes` | `1048576` |
| `studio.eventQueueItems` | `2000` |
| `studio.eventQueueBytes` | `2097152` |
| `studio.eventMaxBytes` | `65536` |
| `studio.eventBatchSize` | `100` |
| `studio.eventBudgetMs` | `4` |
| `studio.rateLimit.capacity` | `120` |
| `studio.rateLimit.refillPerSecond` | `20` |
| `studio.rateLimit.maxKeys` | `10000` |
| `studio.rateLimit.idleTtlMs` | `300000` |
| `integrations.logger` | `true` |
| `integrations.events` | `true` |
| `integrations.pm` | `true` |
| `integrations.http` | `true` |
| `integrations.protocols` | `true` |
| `integrations.rawmongo` | `true` |
| `integrations.redis` | `true` |
| `cluster.enabled` | `false` |
| `cluster.mode` | `"standalone"` |
| `cluster.heartbeatMs` | `10000` |
| `cluster.leaseMs` | `30000` |

## Additional bounded controls

- `metrics.collectionTimeoutMs`: observable callback deadline, 5000 ms by default (1–300000). An individual observable can set `timeoutMs`.
- `pipeline.sinkTimeoutMs`: default sink call deadline, 5000 ms (1–300000); `addSink(...,{timeoutMs})` overrides it. Each sink retains at most maxInFlightBatches unresolved writes.
- `synthetics.maxWaiters`: maximum queued invocations, default maxChecks. Invocations support `queueTimeoutMs`/`signal`.
- `plugins.callbackTimeoutMs`: bounded plugin lifecycle/hook wait, 5000 ms by default.
- `alerts.callbackTimeoutMs`: context/leader/rule/notification/incident callback wait, 5000 ms by default (1–300000). Direct `AlertEngine` options also support this control. `evaluate({timeoutMs,signal})` bounds context/rule waits; transition callbacks retain the engine default.
- Direct `NotificationRouter` options `callbackTimeoutMs` (5000 ms, 1–300000) and `maxPendingCallbacks` (1000, 1–100000) bound channel waits and unresolved physical sends. `notify({…}, {timeoutMs,signal})` can override a send deadline. Close timeout bounds owned cleanup; caller cancellation does not skip its attempt.
- `studio.maxClients`: at most 100 SSE clients unless explicitly set. `assetsRoot` is a route-registration option, not the service root.
- `exporters.http.timeoutMs` and the inherited HTTP behavior of the OTLP-JSON exporter bound each HTTP request attempt by elapsed time, including socket queueing and response reads. They are not a total deadline across serialization, compression, retries and split chunks.
- Metric label names longer than 128 bytes are discarded. Label values, count, series and instruments use their configured limits.

## Injected services and transport contracts

Supply logger/events/database/redis/pm/unified/websocket/tcp/udp explicitly. `app` container lookup is retained only as an optional compatibility integration. Stores support writeMany/query and optional initialize/flush/close/snapshot; durable adapters must acknowledge all records. Exporters support export (or writeMany/write/function), optional flush/close/snapshot, and receive an AbortSignal. Resource health/metrics/diagnostics callbacks receive `{signal,resource}`. Health checks receive `{signal,name,kind,...context}`. PM adapters registerResource(name,{health,metrics,diagnostics}) and return a disposer or expose unregisterResource(name). Structured providers remain optional and are not installed automatically.

## Environment configuration

The exact preserved environment reader is `config/monitor.js`; each setting and fallback is shown there and kept in the archive. It reads MONITOR_* plus APP_ENV/NODE_ENV/APP_NAME/APP_VERSION. It is opt-in and should be loaded only by your configuration owner. Never expose configuration secrets in a public route.
