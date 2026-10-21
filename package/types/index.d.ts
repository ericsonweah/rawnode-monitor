/// <reference lib="es2022" />

declare class MonitorEventEmitter {
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  off(event: string | symbol, listener: (...args: any[]) => void): this;
  emit(event: string | symbol, ...args: any[]): boolean;
  removeAllListeners(event?: string | symbol): this;
}

export type MonitorProfile = 'compat' | 'enterprise' | 'production' | 'strict' | 'test';
export type SignalKind = 'metrics' | 'span' | 'event' | 'log' | 'health' | 'alert' | 'incident' | 'slo' | 'resource' | 'deployment' | 'anomaly' | 'synthetic' | 'internal';
export type MonitorState = 'idle' | 'starting' | 'running' | 'draining' | 'stopping' | 'stopped' | 'failed';

export interface MonitorConfigurationInput {
  enabled?: boolean;
  profile?: MonitorProfile;
  service?: string;
  environment?: string;
  version?: string | null;
  instanceId?: string | null;
  region?: string | null;
  zone?: string | null;
  failFast?: boolean;
  collectionIntervalMs?: number | string;
  resourceIntervalMs?: number | string;
  shutdownTimeoutMs?: number | string;
  flushTimeoutMs?: number | string;
  metrics?: Record<string, unknown>;
  tracing?: Record<string, unknown>;
  pipeline?: Record<string, unknown>;
  health?: Record<string, unknown>;
  resources?: Record<string, unknown>;
  storage?: Record<string, unknown>;
  exporters?: Record<string, unknown>;
  alerts?: Record<string, unknown>;
  slo?: Record<string, unknown>;
  incidents?: Record<string, unknown>;
  system?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  synthetics?: Record<string, unknown>;
  plugins?: Record<string, unknown>;
  security?: Record<string, unknown>;
  studio?: Record<string, unknown>;
  integrations?: Record<string, unknown>;
  cluster?: Record<string, unknown>;
}

export class TelemetryEnvelope<T = unknown> {
  constructor(kind: SignalKind, payload: T, options?: Record<string, unknown>);
  readonly id: string;
  readonly schemaVersion: number;
  readonly monitorVersion: string;
  readonly kind: SignalKind;
  readonly timestamp: number;
  readonly observedAt: number;
  readonly service: string | null;
  readonly environment: string | null;
  readonly instanceId: string | null;
  readonly region: string | null;
  readonly zone: string | null;
  readonly tenantId: string | null;
  readonly traceId: string | null;
  readonly spanId: string | null;
  readonly correlationId: string | null;
  readonly priority: number;
  readonly sequence: number | null;
  readonly context: Readonly<Record<string, unknown>> | null;
  readonly resource: Readonly<Record<string, unknown>> | null;
  readonly attributes: Readonly<Record<string, unknown>> | null;
  readonly payload: T;
  toJSON(): Record<string, unknown>;
}
export function createTelemetryEnvelope<T>(kind: SignalKind, payload: TelemetryEnvelope<T>, options?: Record<string, unknown>): TelemetryEnvelope<T>;
export function createTelemetryEnvelope<T>(kind: SignalKind, payload: T, options?: Record<string, unknown>): TelemetryEnvelope<T>;

export interface MetricInstrument {
  readonly name: string;
  readonly type: string;
  snapshot(): unknown;
}
export interface CounterSeries { readonly labels: Readonly<Record<string, string>>; inc(options?: unknown): boolean; add(value?: number, options?: unknown): boolean; }
export interface UpDownCounterSeries extends CounterSeries { dec(options?: unknown): boolean; }
export interface GaugeSeries { readonly labels: Readonly<Record<string, string>>; set(value: number, options?: unknown): boolean; add(value: number, options?: unknown): boolean; }
export interface HistogramSeries { readonly labels: Readonly<Record<string, string>>; record(value: number, options?: unknown): boolean; observe(value: number, options?: unknown): boolean; }
export interface TimerSeries extends HistogramSeries { start(options?: unknown): (options?: unknown) => number; time<T>(callback: () => T | Promise<T>, options?: unknown): Promise<T>; }
export class Counter implements MetricInstrument { readonly name: string; readonly type: string; inc(labels?: Record<string, unknown>, options?: unknown): boolean; add(value?: number, labels?: Record<string, unknown>, options?: unknown): boolean; labels(labels?: Record<string, unknown>): CounterSeries; bind(labels?: Record<string, unknown>): CounterSeries; snapshot(): unknown; }
export class UpDownCounter implements MetricInstrument { readonly name: string; readonly type: string; inc(labels?: Record<string, unknown>, options?: unknown): boolean; dec(labels?: Record<string, unknown>, options?: unknown): boolean; add(value?: number, labels?: Record<string, unknown>, options?: unknown): boolean; labels(labels?: Record<string, unknown>): UpDownCounterSeries; bind(labels?: Record<string, unknown>): UpDownCounterSeries; snapshot(): unknown; }
export class Gauge implements MetricInstrument { readonly name: string; readonly type: string; set(value: number, labels?: Record<string, unknown>, options?: unknown): boolean; add(value: number, labels?: Record<string, unknown>, options?: unknown): boolean; labels(labels?: Record<string, unknown>): GaugeSeries; bind(labels?: Record<string, unknown>): GaugeSeries; snapshot(): unknown; }
export class Histogram implements MetricInstrument { readonly name: string; readonly type: string; record(value: number, labels?: Record<string, unknown>, options?: unknown): boolean; observe(value: number, labels?: Record<string, unknown>, options?: unknown): boolean; labels(labels?: Record<string, unknown>): HistogramSeries; bind(labels?: Record<string, unknown>): HistogramSeries; snapshot(): unknown; }
export class Timer extends Histogram { start(labels?: Record<string, unknown>, options?: unknown): (labels?: Record<string, unknown> | null, options?: unknown) => number; time<T>(callback: () => T | Promise<T>, labels?: Record<string, unknown>, options?: unknown): Promise<T>; labels(labels?: Record<string, unknown>): TimerSeries; bind(labels?: Record<string, unknown>): TimerSeries; }
export class ObservableGauge implements MetricInstrument { readonly name: string; readonly type: string; collect(context?: unknown): Promise<unknown>; snapshot(): unknown; }
export class MetricRegistry {
  constructor(options?: Record<string, unknown>);
  remove(name: string): boolean;
  reset(options?: {definitions?: boolean}): this;
  counter(name: string, options?: Record<string, unknown>): Counter;
  upDownCounter(name: string, options?: Record<string, unknown>): UpDownCounter;
  gauge(name: string, options?: Record<string, unknown>): Gauge;
  histogram(name: string, options?: Record<string, unknown>): Histogram;
  timer(name: string, options?: Record<string, unknown>): Timer;
  observableGauge(name: string, callback: (...args: unknown[]) => unknown, options?: Record<string, unknown>): ObservableGauge;
  get(name: string): MetricInstrument | null;
  collect(context?: unknown): Promise<unknown>;
  snapshot(options?: Record<string, unknown>): unknown;
  freeze(): this;
}

export interface SpanContext { traceId: string; spanId: string; traceFlags: number; traceState?: string | null; sampled: boolean; }
export class Span {
  constructor(tracer: Tracer, name: string, context: SpanContext, options?: Record<string, unknown>);
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  setAttribute(name: string, value: unknown): this;
  setAttributes(values: Record<string, unknown>): this;
  addEvent(name: string, attributes?: Record<string, unknown>, timestamp?: number): this;
  addLink(context: SpanContext, attributes?: Record<string, unknown>): this;
  recordException(error: unknown, attributes?: Record<string, unknown>): this;
  setStatus(code: string | {code?: string; message?: string | null}, message?: string | null): this;
  updateName(name: string): this;
  isRecording(): boolean;
  spanContext(): SpanContext;
  end(options?: {endTimeUnixNano?: number | bigint | string}): this;
  toJSON(): Record<string, unknown>;
}
export class Tracer {
  constructor(options?: Record<string, unknown>);
  activeSpan(): Span | null;
  activeContext(): SpanContext | null;
  startSpan(name: string, options?: Record<string, unknown>): Span;
  startActiveSpan<T>(name: string, callback: (span: Span) => T): T;
  startActiveSpan<T>(name: string, options: Record<string, unknown>, callback: (span: Span) => T): T;
  trace<T>(name: string, options: Record<string, unknown> | ((span: Span) => T | Promise<T>), callback?: (span: Span) => T | Promise<T>): Promise<T>;
  query(options?: Record<string, unknown>): unknown;
  traceById(traceId: string): unknown;
  snapshot(options?: Record<string, unknown>): unknown;
  forceFlush(): Promise<unknown>;
  close(): Promise<void>;
}

export class StreamingBaseline {
  constructor(options?: Record<string, unknown>);
  observe(value: number, timestamp?: number): boolean;
  analyze(value: number, options?: Record<string, unknown>): unknown;
  observeAndAnalyze(value: number, options?: Record<string, unknown>): unknown;
  samples(): Array<{ value: number; timestamp: number }>;
  statistics(): unknown;
  reset(): this;
  snapshot(options?: Record<string, unknown>): unknown;
}
export class AnomalyDetector extends MonitorEventEmitter {
  constructor(options?: Record<string, unknown>);
  register(rule: Record<string, unknown>, options?: Record<string, unknown>): unknown;
  observe(metric: string, value: number, labels?: Record<string, unknown>, context?: Record<string, unknown>): unknown[];
  observeSnapshot(snapshot: unknown, context?: Record<string, unknown>): unknown[];
  current(ruleId?: string | null): unknown[];
  alertRule(id: string, options?: Record<string, unknown>): unknown;
  freeze(): this;
  snapshot(options?: Record<string, unknown>): unknown;
  close(): void;
}
export class LeakDetector extends MonitorEventEmitter {
  constructor(options?: Record<string, unknown>);
  register(rule: Record<string, unknown>, options?: Record<string, unknown>): unknown;
  observe(metric: string, value: number, labels?: Record<string, unknown>, timestamp?: number, context?: Record<string, unknown>): unknown[];
  observeSnapshot(snapshot: unknown, context?: Record<string, unknown>): unknown[];
  current(): unknown[];
  alertRule(id: string, options?: Record<string, unknown>): unknown;
  freeze(): this;
  snapshot(options?: Record<string, unknown>): unknown;
  close(): void;
}
export class CorrelationEngine {
  constructor(options?: Record<string, unknown>);
  correlate(input?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  snapshot(): unknown;
}
export class SyntheticCheck {
  constructor(input: Record<string, unknown>, defaults?: Record<string, unknown>);
  readonly id: string;
  readonly name: string;
  readonly type: 'http' | 'tcp' | 'dns' | 'custom';
  readonly enabled: boolean;
}
export class SyntheticMonitor extends MonitorEventEmitter {
  constructor(options?: Record<string, unknown>);
  register(check: SyntheticCheck | Record<string, unknown>, options?: Record<string, unknown>): SyntheticCheck;
  run(id: string | SyntheticCheck, options?: Record<string, unknown>): Promise<unknown>;
  runAll(options?: Record<string, unknown>): Promise<unknown[]>;
  start(options?: Record<string, unknown>): this;
  health(): unknown;
  alertRule(id: string, options?: Record<string, unknown>): unknown;
  freeze(): this;
  snapshot(options?: Record<string, unknown>): unknown;
  close(): Promise<unknown>;
}
export class MonitorPluginManager extends MonitorEventEmitter {
  constructor(options?: Record<string, unknown>);
  register(plugin: unknown, options?: Record<string, unknown>): unknown;
  hook(name: string, handler: (...args: unknown[]) => unknown, options?: Record<string, unknown>): () => boolean;
  setup(runtime: MonitorRuntime): Promise<this>;
  start(runtime?: MonitorRuntime): Promise<this>;
  invoke(name: string, payload?: unknown, context?: Record<string, unknown>): Promise<unknown[]>;
  notify(name: string, payload?: unknown, context?: Record<string, unknown>): boolean;
  drainNotifications(): Promise<unknown>;
  flush(options?: Record<string, unknown>): Promise<unknown>;
  freeze(): this;
  snapshot(): unknown;
  close(options?: Record<string, unknown>): Promise<unknown>;
}

export class MonitorConfiguration {
  constructor(input?: MonitorConfigurationInput, options?: Record<string, unknown>);
  get<T = unknown>(path: string, fallback?: T): T;
  snapshot(): Readonly<MonitorConfigurationInput & Record<string, unknown>>;
  validate(): { ok: boolean; errors: unknown[]; warnings: unknown[] };
}

export class MonitorRuntime extends MonitorEventEmitter {
  constructor(options?: MonitorConfigurationInput & Record<string, unknown>);
  readonly state: MonitorState;
  readonly enabled: boolean;
  readonly configuration: MonitorConfiguration;
  readonly metrics: MetricRegistry;
  readonly tracer: Tracer;
  readonly alerts: unknown;
  readonly incidents: unknown;
  readonly slos: unknown;
  readonly resources: ResourceRegistry;
  readonly healthRegistry: HealthRegistry;
  readonly query: unknown;
  readonly anomalies: AnomalyDetector;
  readonly leaks: LeakDetector;
  readonly correlations: CorrelationEngine;
  readonly synthetics: SyntheticMonitor;
  readonly plugins: MonitorPluginManager;
  start(options?: Record<string, unknown>): Promise<this>;
  emitSignal<T = unknown>(kind: SignalKind, payload: T, options?: Record<string, unknown>): { accepted: boolean; reason?: string };
  emitEvent(name: string, payload?: unknown, options?: Record<string, unknown>): { accepted: boolean; reason?: string };
  emitLog(level: string, message: string, context?: Record<string, unknown>, options?: Record<string, unknown>): { accepted: boolean; reason?: string };
  ingest(signals: unknown, options?: Record<string, unknown>): Promise<{ accepted: number; rejected: number; reason?: string }>;
  collectMetrics(options?: Record<string, unknown>): Promise<unknown>;
  collectResources(options?: Record<string, unknown>): Promise<unknown>;
  registerResource(name: string, resource: unknown, options?: Record<string, unknown>): unknown;
  registerHealth(name: string, check: unknown, options?: Record<string, unknown>): unknown;
  registerAlert(rule: unknown, options?: Record<string, unknown>): unknown;
  registerSlo(definition: unknown, options?: Record<string, unknown>): unknown;
  registerRunbook(runbook: unknown, options?: Record<string, unknown>): unknown;
  registerAnomaly(definition: Record<string, unknown>, options?: Record<string, unknown>): unknown;
  registerLeak(definition: Record<string, unknown>, options?: Record<string, unknown>): unknown;
  registerSynthetic(definition: Record<string, unknown>, options?: Record<string, unknown>): SyntheticCheck;
  registerPlugin(plugin: unknown, options?: Record<string, unknown>): unknown;
  registerExporter(name: string, exporter: unknown, options?: Record<string, unknown>): unknown;
  recordDeployment(input?: Record<string, unknown>): unknown;
  correlate(input?: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  trace<T>(name: string, callback: (span: Span) => T | Promise<T>): Promise<T>;
  trace<T>(name: string, options: Record<string, unknown>, callback: (span: Span) => T | Promise<T>): Promise<T>;
  startSpan(name: string, options?: Record<string, unknown>): Span;
  run<T>(context: Record<string, unknown>, callback: (...args: unknown[]) => T, ...args: unknown[]): T;
  bind<T extends (...args: any[]) => any>(callback: T, context?: Record<string, unknown>): T;
  freezeDefinitions(): this;
  sanitizeTelemetry(value: unknown): unknown;
  metricsSnapshot(options?: Record<string, unknown>): unknown;
  prometheus(options?: Record<string, unknown>): string;
  health(options?: Record<string, unknown>): Promise<HealthReport>;
  readiness(options?: Record<string, unknown>): Promise<HealthReport>;
  liveness(options?: Record<string, unknown>): Promise<HealthReport>;
  doctor(options?: Record<string, unknown>): Promise<unknown> | unknown;
  diagnostics(options?: Record<string, unknown>): Promise<unknown>;
  diagnosticBundle(options?: Record<string, unknown>): Promise<unknown>;
  snapshot(options?: Record<string, unknown>): unknown;
  flush(options?: Record<string, unknown>): Promise<unknown>;
  close(options?: Record<string, unknown>): Promise<unknown>;
}

export class MonitorManager {
  constructor(options?: Record<string, unknown>);
  create(name?: string, options?: Record<string, unknown>): MonitorRuntime;
  runtime(name?: string): MonitorRuntime;
  default(): MonitorRuntime;
  start(options?: Record<string, unknown>): Promise<this>;
  close(options?: Record<string, unknown>): Promise<void>;
  health(options?: Record<string, unknown>): Promise<HealthReport>;
  metrics(options?: Record<string, unknown>): unknown;
  prometheus(options?: Record<string, unknown>): string;
}

export class MonitorRecorder {
  constructor(options?: { monitor?: MonitorRuntime } & Record<string, unknown>);
  readonly monitor: MonitorRuntime;
  start(): Promise<this>;
  flush(): Promise<unknown>;
  all(filter?: Record<string, unknown>): Promise<unknown>;
  kind(kind: SignalKind): Promise<unknown>;
  traces(): Promise<unknown> | unknown;
  close(): Promise<void>;
}

export function createMonitor(options?: MonitorConfigurationInput & Record<string, unknown>): MonitorRuntime;
export function createMonitorHttpMiddleware(monitor: MonitorRuntime, options?: Record<string, unknown>): (req: unknown, res: unknown, next: () => unknown) => unknown | Promise<unknown>;
export function registerMonitorStudioRoutes(router: unknown, options: Record<string, unknown>): unknown;
export function formatPrometheus(snapshot: unknown, options?: Record<string, unknown>): string;


export const MONITOR_VERSION: string;
export const MONITOR_SCHEMA_VERSION: number;
export const MonitorState: Readonly<Record<string, MonitorState>>;
export const SignalKind: Readonly<Record<string, SignalKind>>;
export const SpanKind: Readonly<Record<string, string>>;
export const SpanStatus: Readonly<Record<string, string>>;
export const HealthStatus: Readonly<Record<string, string>>;
export const AlertState: Readonly<Record<string, string>>;
export const IncidentState: Readonly<Record<string, string>>;
export const OverflowPolicy: Readonly<Record<string, string>>;


// Additional public runtime exports. Detailed contracts remain available through the concrete classes;
// these declarations preserve complete ESM symbol visibility for advanced and extension APIs.
export const ALERT_COMPARATORS: any;
export const BaseInstrument: any;
export const MONITOR_DEFAULTS: any;
export const AlertEngine: any;
export const AlertRule: any;
export const AlertRuleError: any;
export const AlwaysOffSampler: any;
export const AlwaysOnSampler: any;
export const BLOCKED_OBJECT_KEYS: any;
export const BaseMonitorCommand: any;
export const BoundedSignalQueue: any;
export const CallbackExporter: any;
export const CallbackNotificationChannel: any;
export const CardinalityLimitError: any;
export const CompositeTelemetryStore: any;
export const DEFAULT_HISTOGRAM_BUCKETS: any;
export const DeploymentRegistry: any;
export const DiagnosticBundleBuilder: any;
export const EventExporter: any;
export const EventMonitorBridge: any;
export const EventNotificationChannel: any;
export const ExporterRegistry: any;
export const FakeMonitorClock: any;
export const FleetRegistry: any;
export interface HealthReport { ok: boolean; ready: boolean; live: boolean; status: string; timestamp: number; checks: ReadonlyArray<Record<string, unknown>>; }
export type HealthCheck = (context: {signal: AbortSignal; name: string; kind: string; [key:string]:unknown}) => unknown | Promise<unknown>;
export class HealthRegistry extends MonitorEventEmitter {
 constructor(options?: Record<string, unknown>); register(name:string,check:HealthCheck,options?:Record<string,unknown>):()=>boolean;
 unregister(name:string):boolean; freeze():this; list():ReadonlyArray<unknown>; all(options?:Record<string,unknown>):Promise<HealthReport>;
 run(options?:Record<string,unknown>):Promise<HealthReport>; ready(options?:Record<string,unknown>):Promise<HealthReport>; live(options?:Record<string,unknown>):Promise<HealthReport>;
 latest():HealthReport|null; historySnapshot(options?:Record<string,unknown>):ReadonlyArray<HealthReport>; snapshot():unknown;
}
export const HttpJsonExporter: any;
export const InMemorySpanStore: any;
export const IncidentManager: any;
export const JsonlTelemetryStore: any;
export const LeaderLease: any;
export const LoggerMonitorBridge: any;
export const LoggerNotificationChannel: any;
export const MONITOR_COMPATIBILITY_PROFILES: any;
export const MemoryTelemetryStore: any;
export const MetricDefinitionError: any;
export const MetricHistory: any;
export const MonitorAlertsCommand: any;
export const MonitorAnomaliesCommand: any;
export const MonitorBundleCommand: any;
export const MonitorCapacityError: any;
export const MonitorClosedError: any;
export const MonitorConfigurationError: any;
export const MonitorContextManager: any;
export const MonitorCorrelateCommand: any;
export const MonitorDeploymentCommand: any;
export const MonitorDiagnosticsCommand: any;
export const MonitorDoctor: any;
export const MonitorDoctorCommand: any;
export class MonitorError extends Error {
 constructor(message:string,options?:{code?:string;status?:number;retryable?:boolean;details?:unknown;cause?:unknown;name?:string});
 code:string; status:number; retryable:boolean; details:unknown; toJSON():Record<string,unknown>;
}
export const MonitorFlushCommand: any;
export const MonitorHealthCommand: any;
export const MonitorIncidentsCommand: any;
export const MonitorLifecycle: any;
export const MonitorLogTransport: any;
export const MonitorMetricsCommand: any;
export const MonitorPrometheusCommand: any;
export const MonitorQueryEngine: any;
export const MonitorResourcesCommand: any;
export const MonitorSecurityError: any;
export const MonitorSlosCommand: any;
export const MonitorStatusCommand: any;
export const MonitorStudioAssets: any;
export const MonitorStudioAuthorizer: any;
export const MonitorStudioController: any;
export class MonitorStudioManager extends MonitorEventEmitter {
 constructor(options:{monitor:MonitorRuntime;config?:Record<string,unknown>;authorize?:(request:unknown,options:unknown)=>unknown|Promise<unknown>;[key:string]:unknown});
 authorize(req:unknown,options?:Record<string,unknown>):Promise<unknown>; overview(options?:Record<string,unknown>):Promise<unknown>;
 metrics(options?:Record<string,unknown>):unknown; traces(options?:Record<string,unknown>):unknown; trace(id:string):unknown; signals(options?:Record<string,unknown>):Promise<unknown>;
 health(options?:Record<string,unknown>):Promise<HealthReport>; resources(name?:string|null):unknown; alerts(options?:Record<string,unknown>):unknown;
 acknowledgeAlert(id:string,actor?:unknown):unknown; silence(input:unknown,actor?:unknown):unknown; removeSilence(id:string):unknown;
 slos(id?:string|null):unknown; incidents(options?:Record<string,unknown>):unknown; acknowledgeIncident(id:string,input?:Record<string,unknown>):Promise<unknown>;
 resolveIncident(id:string,input?:Record<string,unknown>):Promise<unknown>; annotateIncident(id:string,input?:Record<string,unknown>):Promise<unknown>;
 fleet():unknown; deployments(options?:Record<string,unknown>):unknown; anomalies(options?:Record<string,unknown>):unknown; synthetics(options?:Record<string,unknown>):unknown;
 runSynthetic(id:string,options?:Record<string,unknown>):Promise<unknown>; correlate(input?:Record<string,unknown>,options?:Record<string,unknown>):Promise<unknown>;
 diagnostics(options?:Record<string,unknown>):Promise<unknown>; bundle(options?:Record<string,unknown>):Promise<unknown>; doctor(options?:Record<string,unknown>):unknown;
 stream(req:unknown,res:unknown):unknown; broadcast(event:string,data:unknown):void; drainEvents():Promise<unknown>; snapshot():unknown; close():Promise<void>;
}
export const MonitorStudioRateLimiter: any;
export const MonitorSyntheticsCommand: any;
export const MonitorTimeoutError: any;
export const MonitorTracesCommand: any;
export const NoopSpan: any;
export const NoopTelemetryStore: any;
export const NotificationRouter: any;
export const OperationInstrumentor: any;
export const OtlpJsonExporter: any;
export interface PMResource { health(options?:Record<string,unknown>):unknown|Promise<unknown>; metrics():unknown; diagnostics(options?:Record<string,unknown>):unknown|Promise<unknown>; }
export interface PMResourceOwner { registerResource(name:string,resource:PMResource):unknown; unregisterResource?(name:string):unknown; }
export class PMMonitorBridge {
 constructor(pm:PMResourceOwner|{runtime?:PMResourceOwner;adapter?:PMResourceOwner},monitor:MonitorRuntime,options?:{name?:string});
 start():this; close():Promise<void>; snapshot():Readonly<{name:string;started:boolean}>;
}
export const ParentBasedSampler: any;
export const ProcessMetricsCollector: any;
export const ProtocolMonitorBridge: any;
export const RAWNODE_MONITOR_COMMANDS: any;
export const RAWNODE_RESOURCE_CATALOG: any;
export const RawMongoTelemetryStore: any;
export const RawNodeIntegrationManager: any;
export const RedisMonitorBridge: any;
export class ResourceRegistry extends MonitorEventEmitter {
 constructor(options?:Record<string,unknown>); register(name:string,resource:unknown,options?:Record<string,unknown>):unknown;
 unregister(name:string):boolean; freeze():this; list():ReadonlyArray<unknown>; discover(app?:unknown,options?:Record<string,unknown>):ReadonlyArray<unknown>;
 collect(options?:Record<string,unknown>):Promise<unknown>; collectOne(name:string,options?:Record<string,unknown>):Promise<unknown>; latestSnapshot(name?:string|null):unknown; snapshot():unknown;
}
export const RetentionManager: any;
export const RunbookRegistry: any;
export const SafeTelemetrySerializer: any;
export const SamplingDecision: any;
export class SignalPipeline extends MonitorEventEmitter {
 constructor(options?:Record<string,unknown>); addSink(name:string,sink:unknown,options?:Record<string,unknown>):this; removeSink(name:string):boolean;
 start():this; admit(envelope:unknown,options?:Record<string,unknown>):{accepted:boolean;reason?:string}; admitAsync(envelope:unknown,options?:Record<string,unknown>):Promise<{accepted:boolean;reason?:string}>;
 schedule():boolean; drain(options?:Record<string,unknown>):Promise<unknown>; flush(options?:Record<string,unknown>):Promise<unknown>; close(options?:Record<string,unknown>):Promise<unknown>; snapshot():unknown;
}
export const SignalSpanProcessor: any;
export const SilenceManager: any;
export const SloDefinition: any;
export const SloRegistry: any;
export const StatsdExporter: any;
export const SystemMetricsCollector: any;
export const TelemetryAuthenticator: any;
export const TelemetryRedactor: any;
export const TraceContext: any;
export const TraceContextError: any;
export const TraceIdRatioSampler: any;
export const bool: any;
export const boundedInteger: any;
export const boundedNumber: any;
export const bytesOf: any;
export const callFirst: any;
export const cloneValue: any;
export const cooperativeYield: any;
export const createMonitorClusterEnvelope: any;
export const createMonitorFetch: any;
export const createTelemetryStore: any;
export const deepFreeze: any;
export const dispatchEvent: any;
export const elapsedMs: any;
export const epochNanos: any;
export const errorRecord: any;
export const extractTraceContext: any;
export const flattenResourceNumbers: any;
export const formatBaggage: any;
export const formatOtlpJson: any;
export const globalMonitorContext: any;
export const hasBinding: any;
export const injectTraceContext: any;
export const instrumentOperations: any;
export const isPlainObject: any;
export const labelsKey: any;
export const list: any;
export const metricValue: any;
export const noop: any;
export const normalizeLabels: any;
export const nowNs: any;
export const parseBaggage: any;
export const parseBytes: any;
export const parseDuration: any;
export const parseTraceParent: any;
export const randomHex: any;
export const randomId: any;
export const registerRawNodeIntegrations: any;
export const renderMonitorStudioPage: any;
export const resolveMonitorCompatibilityProfile: any;
export const resolveMonitorConfiguration: any;
export const resolveSampler: any;
export const retry: any;
export const safeGet: any;
export const safeResolve: any;
export const sanitizeLabelName: any;
export const sanitizeMetricName: any;
export const sha256: any;
export const signEnvelope: any;
export const stableJson: any;
export const stableValue: any;
export const verifyMonitorClusterEnvelope: any;
export const withTimeout: any;

export default MonitorRuntime;
