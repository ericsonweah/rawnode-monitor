/** RawNode PM public TypeScript declarations. */

export type ProcessMode = 'fork' | 'cluster' | 'external';
export type ProcessState =
  | 'defined'
  | 'starting'
  | 'online'
  | 'ready'
  | 'running'
  | 'draining'
  | 'stopping'
  | 'stopped'
  | 'crashed'
  | 'unhealthy'
  | 'backoff'
  | 'quarantined'
  | 'boot_failed';
export type ReadinessMode = 'ipc' | 'immediate' | 'http' | 'tcp';
export type WatchMode = 'reload' | 'restart' | 'none';
export type Dictionary<T = unknown> = Record<string, T>;
export type Environment = Record<string, string | number | boolean | null | undefined>;

export interface ReadinessOptions {
  mode?: ReadinessMode;
  timeoutMs?: number | string;
  timeout?: number | string;
  intervalMs?: number | string;
  url?: string | null;
  host?: string;
  port?: number | null;
  path?: string;
  expectedStatus?: number;
}

export interface HealthOptions {
  enabled?: boolean;
  intervalMs?: number | string;
  timeoutMs?: number | string;
  heartbeatTimeoutMs?: number | string;
  unhealthyThreshold?: number;
  restart?: boolean;
}

export interface RestartOptions {
  enabled?: boolean;
  onCleanExit?: boolean;
  maxRestarts?: number;
  windowMs?: number | string;
  stableMs?: number | string;
  minDelayMs?: number | string;
  maxDelayMs?: number | string;
  factor?: number;
  jitter?: number;
}

export interface ShutdownOptions {
  graceMs?: number | string;
  killMs?: number | string;
  signal?: string;
  killSignal?: string;
}

export interface WatchOptions {
  enabled?: boolean;
  mode?: WatchMode;
  paths?: string[] | string;
  ignore?: string[] | string;
  debounceMs?: number | string;
  pollingIntervalMs?: number | string;
  reconcileIntervalMs?: number | string;
}

export interface LogOptions {
  enabled?: boolean;
  maxBytes?: number;
  maxFiles?: number;
  bufferBytes?: number;
  timestamp?: boolean;
}

export interface TelemetryOptions {
  enabled?: boolean;
  intervalMs?: number | string;
}

export interface ProcessDefinitionInput {
  name: string;
  namespace?: string;
  cwd?: string;
  script?: string;
  entry?: string;
  command?: string;
  args?: string[] | string;
  nodeArgs?: string[] | string;
  execArgv?: string[] | string;
  mode?: ProcessMode;
  execMode?: ProcessMode;
  instances?: number | 'auto' | 'max';
  workers?: number | 'auto' | 'max';
  interpreter?: string | null;
  env?: Environment;
  autostart?: boolean;
  autorestart?: boolean;
  readiness?: ReadinessOptions;
  health?: HealthOptions;
  restart?: RestartOptions;
  shutdown?: ShutdownOptions;
  watch?: WatchOptions | boolean;
  logs?: LogOptions;
  telemetry?: TelemetryOptions;
  metadata?: Dictionary;
  uid?: number;
  gid?: number;
}

export interface NormalizedReadinessOptions {
  mode: ReadinessMode;
  timeoutMs: number;
  intervalMs: number;
  url: string | null;
  host: string;
  port: number | null;
  path: string;
  expectedStatus: number;
}

export interface NormalizedHealthOptions {
  enabled: boolean;
  intervalMs: number;
  timeoutMs: number;
  heartbeatTimeoutMs: number;
  unhealthyThreshold: number;
  restart: boolean;
}

export interface NormalizedRestartOptions {
  enabled: boolean;
  onCleanExit: boolean;
  maxRestarts: number;
  windowMs: number;
  stableMs: number;
  minDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: number;
}

export interface NormalizedShutdownOptions {
  graceMs: number;
  killMs: number;
  signal: string;
  killSignal: string;
}

export interface NormalizedWatchOptions {
  enabled: boolean;
  mode: WatchMode;
  paths: readonly string[];
  ignore: readonly string[];
  debounceMs: number;
  pollingIntervalMs: number;
  reconcileIntervalMs: number;
}

export interface NormalizedLogOptions {
  enabled: boolean;
  maxBytes: number;
  maxFiles: number;
  bufferBytes: number;
  timestamp: boolean;
}

export interface NormalizedTelemetryOptions {
  enabled: boolean;
  intervalMs: number;
}

export class ProcessDefinition {
  constructor(input: ProcessDefinitionInput, options?: { cwd?: string });
  readonly name: string;
  readonly namespace: string;
  readonly cwd: string;
  readonly script: string;
  readonly args: readonly string[];
  readonly nodeArgs: readonly string[];
  readonly mode: ProcessMode;
  readonly instances: number;
  readonly interpreter: string | null;
  readonly envOverrides: Readonly<Environment>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly autostart: boolean;
  readonly autorestart: boolean;
  readonly readiness: Readonly<NormalizedReadinessOptions>;
  readonly health: Readonly<NormalizedHealthOptions>;
  readonly restart: Readonly<NormalizedRestartOptions>;
  readonly shutdown: Readonly<NormalizedShutdownOptions>;
  readonly watch: Readonly<NormalizedWatchOptions>;
  readonly logs: Readonly<NormalizedLogOptions>;
  readonly telemetry: Readonly<NormalizedTelemetryOptions>;
  readonly metadata: Readonly<Dictionary>;
  readonly uid?: number;
  readonly gid?: number;
  toJSON(options?: { includeEnv?: boolean }): ProcessDefinitionInput & Dictionary;
  static from(input: ProcessDefinition | ProcessDefinitionInput, options?: { cwd?: string }): ProcessDefinition;
}

export interface ProcessManifest {
  options?: Dictionary;
  apps: ProcessDefinitionInput[];
}

export class ManifestLoader {
  constructor(options?: { cwd?: string });
  readonly cwd: string;
  resolve(file?: string | null): Promise<string>;
  load(file?: string | null, options?: { fresh?: boolean }): Promise<{
    file: string;
    options: Dictionary;
    apps: ProcessDefinition[];
  }>;
}

export interface SerializedError {
  name: string;
  code: string | null;
  message: string;
  status: number | null;
  details: unknown;
  stack?: string;
}

export class RawNodePmError extends Error {
  constructor(message: string, options?: Dictionary);
  code: string;
  status: number;
  details: unknown;
  retryable: boolean;
  toJSON(): Dictionary;
}
export class ConfigurationError extends RawNodePmError {}
export class ControlError extends RawNodePmError {}
export class ProcessLifecycleError extends RawNodePmError {}
export function serializeError(error: unknown, options?: { stack?: boolean }): SerializedError | null;

export interface StateTransition {
  from: ProcessState | null;
  to: ProcessState;
  at: number;
  reason: string | null;
  details?: unknown;
}

export class ProcessStateMachine {
  constructor(initial?: ProcessState, options?: { historyLimit?: number });
  state: ProcessState;
  changedAt: number;
  history: StateTransition[];
  can(next: ProcessState): boolean;
  transition(next: ProcessState, meta?: { force?: boolean; reason?: string; details?: unknown }): ProcessState;
  snapshot(): { state: ProcessState; changedAt: number; history: StateTransition[] };
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
}

export class BackoffPolicy {
  constructor(options?: RestartOptions);
  minDelayMs: number;
  maxDelayMs: number;
  factor: number;
  jitter: number;
  delay(attempt: number): number;
}

export interface RestartDecision {
  restart: boolean;
  quarantine?: boolean;
  reason: string;
  delayMs?: number;
  attempt?: number;
  restarts?: number;
  windowMs?: number;
}

export class RestartPolicy {
  constructor(options?: RestartOptions);
  decide(input?: { expected?: boolean; exitCode?: number | null; signal?: string | null; startedAt?: number }): RestartDecision;
  markStable(now?: number): void;
  noteRuntime(startedAt: number, now?: number): void;
  prune(now?: number): void;
  snapshot(): Dictionary;
}

export interface RuntimeMemoryMetrics {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers?: number;
}

export interface RuntimeMetrics {
  at: number;
  uptimeMs: number;
  memory: RuntimeMemoryMetrics;
  cpu: { userMicros: number; systemMicros: number; percent: number };
  eventLoop: {
    utilization: number;
    activeMs: number;
    idleMs: number;
    delayMinMs: number;
    delayMeanMs: number;
    delayMaxMs: number;
    delayP95Ms: number;
    delayP99Ms: number;
  };
  resourceUsage: Dictionary;
  activeResources: Record<string, number>;
  adapter: Dictionary;
}

export interface ProcessSnapshot {
  id: string;
  name: string;
  slot: number;
  generation: number;
  pid: number | null;
  state: ProcessState;
  stateChangedAt: number;
  startedAt: number | null;
  readyAt: number | null;
  stoppedAt: number | null;
  uptimeMs: number;
  expectedExit: boolean;
  exitCode: number | null;
  signal: string | null;
  lastHeartbeatAt: number | null;
  lastHealth: Dictionary | null;
  metrics: RuntimeMetrics | null;
  error: SerializedError | null;
  replacementFor: string | null;
}

export interface ProcessGroupSnapshot {
  name: string;
  namespace: string;
  mode: ProcessMode;
  desiredInstances: number;
  desiredRunning: boolean;
  activeInstances: number;
  quarantined: boolean;
  createdAt: number;
  updatedAt: number;
  watch: Dictionary | null;
  restart: Dictionary;
  definition: ProcessDefinitionInput & Dictionary;
  processes: ProcessSnapshot[];
}

export class ProcessRegistry {
  constructor(options?: { historyPerGroup?: number });
  readonly groups: Map<string, any>;
  readonly processes: Map<string, any>;
  define(input: ProcessDefinition | ProcessDefinitionInput): any;
  createRecord(name: string, slot: number, options?: Dictionary): any;
  activate(record: any): any;
  deactivate(record: any): void;
  active(name: string): any[];
  active(name: string, slot: number): any | null;
  groupProcesses(name: string, options?: { includeStopped?: boolean }): any[];
  prune(name: string, limit?: number): number;
  deleteGroup(name: string): boolean;
  get(name: string): any | null;
  requireGroup(name: string): any;
  list(): ProcessGroupSnapshot[];
  snapshotGroup(name: string): ProcessGroupSnapshot;
  desiredState(): Dictionary;
  on(event: string, listener: (...args: any[]) => void): this;
}

export interface SupervisorOptions {
  registry?: ProcessRegistry;
  logs?: LogMultiplexer | null;
  metrics?: MetricsAggregator | null;
  journal?: AtomicJournal | null;
  forkDriver?: unknown;
  clusterDriver?: unknown;
  externalDriver?: unknown;
  healthTickMs?: number;
  logger?: { error?: (...args: any[]) => void };
}

export class Supervisor {
  constructor(options?: SupervisorOptions);
  readonly registry: ProcessRegistry;
  start(input: string | ProcessDefinition | ProcessDefinitionInput, options?: Dictionary): Promise<ProcessGroupSnapshot>;
  stop(name: string, options?: Dictionary): Promise<ProcessGroupSnapshot | { name: string; deleted: true }>;
  restart(name: string, options?: Dictionary): Promise<ProcessGroupSnapshot>;
  reload(name: string, options?: Dictionary): Promise<ProcessGroupSnapshot>;
  scale(name: string, instances: number, options?: Dictionary): Promise<ProcessGroupSnapshot>;
  diagnostics(name: string, options?: Dictionary): Promise<Dictionary>;
  status(name?: string | null): ProcessGroupSnapshot | ProcessGroupSnapshot[];
  close(options?: Dictionary): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
}

export interface ProcessManagerOptions {
  stateDir?: string;
  cwd?: string;
  autoSave?: boolean;
  encryptState?: boolean;
  managementEnabled?: boolean;
  managementHost?: string;
  managementPort?: number;
  publicHealth?: boolean;
  publicMetrics?: boolean;
  registry?: ProcessRegistry;
  supervisor?: Supervisor;
  control?: ControlServer;
  management?: ManagementHttpServer;
  [key: string]: unknown;
}

export interface ManagerHealth {
  ok: boolean;
  ready: boolean;
  pid: number;
  uptimeMs: number;
  socket: string;
  stateDir: string;
  management: unknown;
  groups: number;
  activeProcesses: number;
  historyRecords: number;
  unhealthy: Dictionary[];
}

export class ProcessManager {
  constructor(options?: ProcessManagerOptions);
  readonly paths: Readonly<Record<string, string>>;
  readonly registry: ProcessRegistry;
  readonly supervisor: Supervisor;
  readonly control: ControlServer;
  readonly management: ManagementHttpServer;
  readonly realtime: RealtimeGateway;
  readonly metrics: MetricsAggregator;
  readonly logs: LogMultiplexer;
  start(options?: { resurrect?: boolean; failOnResurrectError?: boolean }): Promise<this>;
  handleCommand<T = unknown>(command: string, params?: Dictionary, meta?: Dictionary): Promise<T>;
  startProcesses(params?: Dictionary): Promise<ProcessGroupSnapshot | ProcessGroupSnapshot[]>;
  stopProcess(name: string, options?: Dictionary): Promise<unknown>;
  restartProcess(name: string, options?: Dictionary): Promise<ProcessGroupSnapshot>;
  reloadProcess(name: string, options?: Dictionary): Promise<ProcessGroupSnapshot>;
  scaleProcess(name: string, instances: number, options?: Dictionary): Promise<ProcessGroupSnapshot>;
  deleteProcess(name: string, options?: Dictionary): Promise<unknown>;
  saveState(): Promise<Dictionary>;
  resurrect(options?: Dictionary): Promise<Dictionary>;
  collectDiagnostics(name: string, options?: Dictionary): Promise<Dictionary>;
  uptimeMs(): number;
  health(): ManagerHealth;
  doctor(): Promise<Dictionary>;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
}

export interface ControlClientOptions {
  socketPath: string;
  tokenPath?: string;
  token?: string;
  timeoutMs?: number;
  maxFrameBytes?: number;
}

export class ControlClient {
  constructor(options: ControlClientOptions);
  socketPath: string;
  tokenPath?: string;
  token: string | null;
  initialize(): Promise<this>;
  request<T = unknown>(command: string, params?: Dictionary, options?: { timeoutMs?: number }): Promise<T>;
  subscribe(options: { events?: string[]; app?: string | null; onError?: (error: unknown, packet: ControlEventPacket) => void }, onEvent: (packet: ControlEventPacket) => void): Promise<() => void>;
}

export interface ControlEventPacket {
  stream: 'events';
  event: string;
  payload: any;
  at?: number;
  [key: string]: unknown;
}

export class ControlServer {
  constructor(options?: Dictionary);
  start(): Promise<this>;
  broadcast(event: string, payload?: Dictionary): void;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
}

export interface ManagementHttpServerOptions {
  host?: string;
  port?: number | null;
  enabled?: boolean;
  authenticator?: ControlAuthenticator;
  manager?: ProcessManager;
  publicHealth?: boolean;
  publicMetrics?: boolean;
  maxBodyBytes?: number;
  maxSseBufferBytes?: number;
}

export class ManagementHttpServer {
  constructor(options?: ManagementHttpServerOptions);
  enabled(): boolean;
  start(): Promise<this>;
  address(): unknown;
  close(): Promise<void>;
}

export class ControlAuthenticator {
  constructor(options?: { tokenPath?: string; token?: string });
  tokenPath?: string;
  token: string | null;
  initialize(): Promise<string>;
  verify(candidate: string): boolean;
  keyBytes(): Uint8Array;
}

export interface SecretRedactorOptions {
  placeholder?: string;
  keys?: string[];
  maxDepth?: number;
  maxArray?: number;
}

export class SecretRedactor {
  constructor(options?: SecretRedactorOptions);
  placeholder: string;
  additionalKeys: Set<string>;
  maxDepth: number;
  maxArray: number;
  isSecretKey(key: string): boolean;
  text(value: unknown): string;
  redact<T = unknown>(value: T, key?: string, depth?: number, seen?: WeakMap<object, boolean>): unknown;
}

export const defaultRedactor: SecretRedactor;

export interface AuditTrailOptions {
  file?: string;
  redactor?: SecretRedactor;
  enabled?: boolean;
  maxBytes?: number;
  maxFiles?: number;
}

export class AuditTrail {
  constructor(options?: AuditTrailOptions);
  file?: string;
  redactor: SecretRedactor;
  enabled: boolean;
  maxBytes: number;
  maxFiles: number;
  open(): Promise<this>;
  record(action: string, details?: Dictionary): Promise<void>;
  close(): Promise<void>;
}

export interface RuntimeAdapter {
  health(options?: Dictionary): Promise<Dictionary> | Dictionary;
  metrics(): Promise<Dictionary> | Dictionary;
  drain(options?: Dictionary): Promise<Dictionary> | Dictionary;
  shutdown(options?: Dictionary): Promise<Dictionary> | Dictionary;
  diagnostics?(options?: Dictionary): Promise<Dictionary> | Dictionary;
  reloadConfig?(): Promise<Dictionary> | Dictionary;
  trackServer?(server: unknown, options?: Dictionary): unknown;
  registerResource?(name: string, resource: unknown): unknown;
}

export interface RuntimeAgentOptions {
  adapter?: RuntimeAdapter;
  intervalMs?: number;
  managed?: boolean;
  autoExit?: boolean;
  captureSignals?: boolean;
  eventLoopResolution?: number;
  app?: unknown;
}

export class RuntimeAgent {
  constructor(options?: RuntimeAgentOptions);
  readonly adapter: RuntimeAdapter;
  readonly intervalMs: number;
  readonly managed: boolean;
  start(meta?: Dictionary): this;
  ready(meta?: Dictionary): this;
  trackServer(server: unknown, options?: Dictionary): this;
  registerResource(name: string, resource: unknown): this;
  send(type: string, payload?: Dictionary, meta?: Dictionary): Dictionary;
  metrics(): Promise<RuntimeMetrics>;
  health(): Promise<Dictionary>;
  drain(options?: Dictionary): Promise<Dictionary>;
  shutdown(options?: Dictionary): Promise<Dictionary>;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
}

export class RawNodeRuntimeAdapter implements RuntimeAdapter {
  constructor(options?: Dictionary);
  app: unknown;
  activeRequests: number;
  totalRequests: number;
  trackServer(server: unknown, options?: Dictionary): this;
  registerResource(name: string, resource: unknown): this;
  health(options?: Dictionary): Promise<Dictionary>;
  metrics(): Promise<Dictionary>;
  drain(options?: Dictionary): Promise<Dictionary>;
  shutdown(options?: Dictionary): Promise<Dictionary>;
  reloadConfig(): Promise<Dictionary>;
  diagnostics(options?: Dictionary): Promise<Dictionary>;
}

export function createRuntimeAgent(options?: RuntimeAgentOptions): RuntimeAgent;
export function attachRawNodeRuntime(app: unknown, options?: Dictionary): RuntimeAgent;

export class MetricsAggregator {
  constructor(options?: { historyLimit?: number });
  inc(name: string, value?: number): number;
  update(record: any, metrics: RuntimeMetrics): void;
  remove(record: any): void;
  snapshot(options?: { includeHistory?: boolean }): Dictionary;
  on(event: string, listener: (...args: any[]) => void): this;
}

export function formatPrometheus(input: { registry?: ProcessRegistry; metrics?: MetricsAggregator | Dictionary }): string;
export class PrometheusFormatter {
  format(input: { registry?: ProcessRegistry; metrics?: MetricsAggregator | Dictionary }): string;
}

export interface LogEntry {
  at: number;
  name: string;
  slot: number;
  pid: number | null;
  stream: 'stdout' | 'stderr' | string;
  line: string;
}

export class LineRingBuffer {
  constructor(options?: { maxBytes?: number; maxItems?: number });
  push(value: LogEntry): void;
  query(options?: { lines?: number; stream?: string }): LogEntry[];
  clear(): void;
}

export class LogWriter {
  constructor(options?: Dictionary);
  write(chunk: string | Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export class LogMultiplexer {
  constructor(options?: { root?: string });
  attach(record: any): unknown;
  detach(record: any): Promise<void>;
  query(name: string, options?: { lines?: number; stream?: string }): LogEntry[];
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
}

export class WatchManager {
  constructor(options?: { maxFiles?: number });
  watch(definition: ProcessDefinition, callback: (changes: unknown[]) => Promise<void> | void): Promise<unknown>;
  unwatch(name: string): Promise<boolean>;
  status(name: string): Dictionary | null;
  close(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
}

export class RealtimeGateway {
  constructor(options?: { historyLimit?: number });
  publish(event: string, payload?: Dictionary): { event: string; payload: Dictionary; at: number };
  attach(adapter: { publish(packet: unknown): unknown }): () => boolean;
  attachRawNodeWebSocket(io: unknown, options?: { namespace?: string }): () => boolean;
  recent(options?: { event?: string | null; limit?: number }): Array<{ event: string; payload: Dictionary; at: number }>;
  on(event: string, listener: (...args: any[]) => void): this;
  off(event: string, listener: (...args: any[]) => void): this;
}

export class DiagnosticManager {
  constructor(options?: Dictionary);
  collect(name: string, options?: Dictionary): Promise<{ ok: true; file: string; runtime: unknown }>;
}

export class AtomicJournal {
  constructor(options?: Dictionary);
  open(): Promise<this>;
  append(event: string, payload?: Dictionary): Promise<unknown>;
  close(): Promise<void>;
}

export class JsonStateStore {
  constructor(options?: { file?: string; keyProvider?: (() => Promise<Uint8Array> | Uint8Array) | null; encrypted?: boolean });
  save(state: Dictionary): Promise<Dictionary>;
  load<T = Dictionary>(fallback?: T | null): Promise<T | Dictionary | null>;
}

export class DaemonLock {
  constructor(file: string);
  acquire(): Promise<this>;
  release(): Promise<void>;
}

export interface StartupGeneratorOptions {
  nodePath?: string;
  binPath: string;
  cwd?: string;
  stateDir?: string;
  user?: string | null;
  group?: string | null;
  userService?: boolean;
  label?: string;
  description?: string;
  resurrect?: boolean;
  nodeEnv?: string;
  environment?: Environment;
}

export class StartupGenerator {
  constructor(options: StartupGeneratorOptions);
  arguments(): string[];
  systemd(): string;
  launchd(): string;
  generate(platform?: string): {
    platform: 'systemd' | 'launchd';
    filename: string;
    content: string;
    installTarget: string;
  };
}


export interface RawNodeIntegratorOptions {
  root?: string;
  applicationFile?: string;
  serveFile?: string;
  configFile?: string;
  manifestFile?: string;
}

export class RawNodeIntegrator {
  constructor(options?: RawNodeIntegratorOptions);
  plan(options?: { force?: boolean }): Promise<Dictionary>;
  integrate(options?: { dryRun?: boolean; force?: boolean }): Promise<{
    ok: true;
    dryRun: boolean;
    changed: string[];
    created: string[];
    backups?: string[];
  }>;
}

export const RAWNODE_INTEGRATION_ANCHORS: Readonly<Record<string, string>>;

export class RawNodePmServiceProvider {
  static dependencies: string[];
  static priority: number;
  constructor(app: unknown);
  register(): void;
  boot(): Promise<void>;
  teardown(): Promise<void>;
}

export class PmStatusCommand { constructor(app: unknown); handle(): Promise<void>; }
export class PmStartCommand { constructor(app: unknown); handle(): Promise<void>; }
export class PmStopCommand { constructor(app: unknown); handle(): Promise<void>; }
export class PmRestartCommand { constructor(app: unknown); handle(): Promise<void>; }
export class PmReloadCommand { constructor(app: unknown); handle(): Promise<void>; }
export class PmScaleCommand { constructor(app: unknown); handle(): Promise<void>; }
export class PmDoctorCommand { constructor(app: unknown); handle(): Promise<void>; }
export const RAWNODE_PM_COMMANDS: readonly unknown[];

export const PACKAGE_NAME: 'rawnode-pm';
export const STATE_SCHEMA_VERSION: number;
export const CONTROL_PROTOCOL_VERSION: number;
export const RUNTIME_PROTOCOL_VERSION: number;
export const PROCESS_STATES: readonly ProcessState[];
export const TERMINAL_STATES: ReadonlySet<ProcessState>;
export const RUNTIME_MESSAGE: Readonly<Record<string, string>>;
export const SUPERVISOR_MESSAGE: Readonly<Record<string, string>>;
export const DEFAULTS: Readonly<Record<string, number>>;
