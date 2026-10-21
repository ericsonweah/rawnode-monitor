export type BuiltInLogLevel =
  | 'emergency' | 'alert' | 'critical' | 'error' | 'urgent' | 'priority'
  | 'warn' | 'notice' | 'success' | 'info' | 'debug' | 'metric' | 'metrics' | 'important';
export type LogLevel = BuiltInLogLevel | (string & {});
export type MaybeLazy<T> = T | (() => T);
export type LoggerContext = Record<string, unknown>;

export interface LevelDefinition {
  name: string;
  rank: number;
  severity?: number;
  syslog?: number | null;
  consoleMethod?: 'log' | 'warn' | 'error' | 'debug' | string;
  category?: string;
  droppable?: boolean;
  aliases?: string[];
  metadata?: Record<string, unknown>;
}

export interface StructuredError {
  name: string;
  message: string;
  stack?: string;
  code?: unknown;
  cause?: StructuredError | unknown;
  errors?: StructuredError[];
  [key: string]: unknown;
}

export interface LogRecord<TData = unknown, TContext extends LoggerContext = LoggerContext> {
  schemaVersion: number;
  id: string;
  sequence: number;
  timestamp: string;
  timeUnixMs: number;
  hrtimeNs: string;
  level: LogLevel;
  levelValue: number | null;
  levelRank: number | null;
  category: string;
  syslog: number | null;
  consoleMethod: string;
  droppable: boolean;
  message: string;
  data: TData | null;
  context: TContext;
  error: StructuredError | null;
  channel: string;
  service: string;
  environment: string;
  hostname: string;
  pid: number;
  threadId: number;
  requestId: unknown;
  correlationId: unknown;
  traceId: unknown;
  spanId: unknown;
  tenantId: unknown;
  userId: unknown;
  tags: string[];
  formatted: string;
  [key: string]: unknown;
}

export interface LogOptions<TContext extends LoggerContext = LoggerContext> {
  context?: Partial<TContext> & LoggerContext;
  channel?: string;
  service?: string;
  environment?: string;
  error?: Error;
  tags?: string[];
  requestId?: unknown;
  correlationId?: unknown;
  traceId?: unknown;
  spanId?: unknown;
  tenantId?: unknown;
  userId?: unknown;
  signal?: AbortSignal;
  awaitDelivery?: boolean;
  throwOnError?: boolean;
  [key: string]: unknown;
}

export interface LoggerTransport<TRecord extends LogRecord = LogRecord> {
  name?: string;
  rawnodeEnterpriseTransport?: boolean;
  rawnodeTransportMode?: string;
  owned?: boolean;
  batchSize?: number;
  batchDelayMs?: number;
  writeRecord?(record: TRecord, compatibilityEntry?: unknown): void | Promise<void>;
  writeBatch?(records: TRecord[]): void | Promise<void>;
  write?(...args: unknown[]): unknown;
  flush?(options?: Record<string, unknown>): void | Promise<void>;
  reopen?(options?: Record<string, unknown>): unknown | Promise<unknown>;
  close?(options?: Record<string, unknown>): void | Promise<void>;
  health?(): Record<string, unknown>;
}

export interface LoggerTimer {
  end(levelOrData?: LogLevel | Record<string, unknown>, dataOrLevel?: Record<string, unknown> | LogLevel): number | null;
  stop(levelOrData?: LogLevel | Record<string, unknown>, dataOrLevel?: Record<string, unknown> | LogLevel): number | null;
  cancel(): void;
}

export interface LoggerLike<TContext extends LoggerContext = LoggerContext> {
  log(level: LogLevel, message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  logAsync(level: LogLevel, message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): Promise<LogRecord | null | unknown>;
  emergency(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  alert(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  critical(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  error(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  urgent(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  priority(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  warn(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  notice(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  success(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  info(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  debug(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  metric(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  metrics(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  important(message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): unknown;
  isLevelEnabled(level: LogLevel): boolean;
  setLevel(level: LogLevel): this;
  registerLevel(definition: LevelDefinition, options?: { replace?: boolean }): this;
  levels(): ReadonlyArray<LevelDefinition>;
  child<TChild extends LoggerContext = TContext>(context?: Partial<TChild>, options?: Record<string, unknown>): LoggerLike<TChild>;
  with<TChild extends LoggerContext = TContext>(context?: Partial<TChild>): LoggerLike<TChild>;
  withTags(...tags: Array<string | string[]>): LoggerLike<TContext>;
  channel(name: string): LoggerLike<TContext>;
  at(level: LogLevel): LoggerLike<TContext>;
  withError(error: Error, context?: Partial<TContext>): LoggerLike<TContext>;
  when(condition: boolean): LoggerLike<TContext>;
  sample(rate: number): LoggerLike<TContext>;
  once(key?: string): LoggerLike<TContext>;
  rateLimit(key?: string, options?: { limit?: number; intervalMs?: number; windowMs?: number }): LoggerLike<TContext>;
  forRequest(req: unknown, extra?: Partial<TContext>): LoggerLike<TContext>;
  forJob(job: unknown, extra?: Partial<TContext>): LoggerLike<TContext>;
  runWithContext<TResult>(context: Partial<TContext>, callback: (...args: unknown[]) => TResult, ...args: unknown[]): TResult;
  getContext?(): Readonly<TContext>;
  time(label: string, context?: Record<string, unknown>): LoggerTimer;
  measure<TResult>(label: string, operation: () => TResult | Promise<TResult>, context?: Record<string, unknown>, options?: Record<string, unknown>): Promise<TResult>;
  processor(processor: (record: LogRecord, context: Record<string, unknown>) => unknown, options?: Record<string, unknown>): this;
  use(processor: (record: LogRecord, context: Record<string, unknown>) => unknown, options?: Record<string, unknown>): this;
  plugin(plugin: LoggerPlugin): this;
  addTransport?(transport: LoggerTransport, options?: Record<string, unknown>): this;
  ready(options?: Record<string, unknown>): Promise<this>;
  flush(options?: Record<string, unknown>): Promise<unknown>;
  reopen(options?: Record<string, unknown>): Promise<unknown>;
  close(options?: Record<string, unknown>): Promise<void>;
  health(): LoggerHealthSnapshot;
  stats(): LoggerStatsSnapshot;
  metricsSnapshot(): Record<string, unknown>;
  diagnosticsSnapshot(): unknown[];
  prometheus(labels?: Record<string, unknown>): string;
  toPrometheus(labels?: Record<string, unknown>): string;
}

export interface LoggerPlugin {
  name?: string;
  priority?: number;
  timeoutMs?: number;
  trusted?: boolean;
  enabled?: boolean;
  hooks?: Record<string, (value: unknown, context: Record<string, unknown>) => unknown>;
  [key: string]: unknown;
}

export interface LoggerOptions<TContext extends LoggerContext = LoggerContext> {
  profile?: 'v1' | 'strict' | 'production' | 'test' | 'serverless' | Record<string, unknown>;
  level?: LogLevel;
  service?: string;
  environment?: string;
  channel?: string;
  context?: Partial<TContext>;
  tags?: string[];
  transports?: Array<LoggerTransport | { transport: LoggerTransport; options?: Record<string, unknown> }>;
  formatter?: unknown;
  serialization?: Record<string, unknown>;
  security?: Record<string, unknown>;
  queue?: Record<string, unknown>;
  pipelineQueue?: Record<string, unknown>;
  transportQueue?: Record<string, unknown>;
  observability?: Record<string, unknown>;
  stateLimits?: { maxOnceKeys?: number; maxRateBuckets?: number };
  processors?: unknown;
  plugins?: unknown;
  processorList?: Array<Function | Record<string, unknown>>;
  pluginList?: LoggerPlugin[];
  sampleRate?: number;
  random?: () => number;
  mode?: 'json' | 'object';
  serialize?: boolean;
  colors?: boolean;
  awaitTransportDelivery?: boolean;
  clock?: () => number;
  hrtime?: () => bigint;
  idFactory?: () => string;
  [key: string]: unknown;
}

export interface LoggerHealthSnapshot {
  status: string;
  state?: string;
  level?: LogLevel;
  profile?: string;
  uptimeMs?: number;
  pending?: number;
  pipeline?: Record<string, unknown>;
  transports?: Array<Record<string, unknown>>;
  diagnostics?: unknown[];
  [key: string]: unknown;
}

export interface LoggerStatsSnapshot {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, unknown>;
  pipeline?: Record<string, unknown>;
  transports?: unknown[];
  [key: string]: unknown;
}

export interface LoggerRuntime<TContext extends LoggerContext = LoggerContext> extends LoggerLike<TContext> {}
export class LoggerRuntime<TContext extends LoggerContext = LoggerContext> {
  constructor(options?: LoggerOptions<TContext>);
  static create<T extends LoggerContext = LoggerContext>(options?: LoggerOptions<T>): LoggerRuntime<T>;
  level: LogLevel;
  profile: Readonly<Record<string, unknown>>;
  state: string;
  contextManager: ContextManager;
  levelRegistry: LevelRegistry;
  serializer: SafeSerializer;
  metricsRegistry: LoggerMetrics;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  submit(level: LogLevel, message: MaybeLazy<unknown>, data?: MaybeLazy<unknown>, options?: LogOptions<TContext>): { accepted: boolean; level: LogLevel; promise: Promise<unknown>; overcommitted?: boolean };
  clearOnce(): this;
  resetRateLimits(): this;
}
export { LoggerRuntime as Runtime };
export function createRuntimeLogger<TContext extends LoggerContext = LoggerContext>(options?: LoggerOptions<TContext>): LoggerRuntime<TContext>;
export function createLogger<TContext extends LoggerContext = LoggerContext>(options?: LoggerOptions<TContext>): AdvancedLogger<TContext>;

export interface AdvancedLogger<TContext extends LoggerContext = LoggerContext> extends LoggerLike<TContext> {}
export class AdvancedLogger<TContext extends LoggerContext = LoggerContext> {
  constructor(options?: LoggerOptions<TContext>);
  runtime: LoggerRuntime<TContext>;
  level: LogLevel;
  mode: 'json' | 'object';
  serialize: boolean;
  colors: boolean;
  transports: LoggerTransport[];
  middleware(middleware: Function): this;
  removeTransport(nameOrTransport: string | LoggerTransport): LoggerTransport | null;
  on(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
  write(chunk: unknown): boolean;
  pipe(destination: unknown): unknown;
}

export interface Logger<TContext extends LoggerContext = LoggerContext> extends LoggerLike<TContext> {}
export class Logger<TContext extends LoggerContext = LoggerContext> {
  constructor(options?: LoggerOptions<TContext>);
  runtime: LoggerRuntime<TContext>;
  static create(options?: LoggerOptions): LoggerBuilder;
}

export class LoggerBuilder {
  constructor(options?: LoggerOptions);
  level(level?: LogLevel): this;
  profile(name?: string): this;
  production(): this;
  strict(): this;
  testing(): this;
  serverless(): this;
  serialize(enabled?: boolean): this;
  mode(mode?: 'json' | 'object'): this;
  useColors(enabled?: boolean): this;
  colors(enabled?: boolean): this;
  withProfile(name: string): this;
  service(name: string): this;
  environment(name: string): this;
  channel(name: string): this;
  context(values?: LoggerContext): this;
  tag(...tags: Array<string | string[]>): this;
  queue(options?: Record<string, unknown>): this;
  pipelineQueue(options?: Record<string, unknown>): this;
  transportQueue(options?: Record<string, unknown>): this;
  circuitBreaker(options?: Record<string, unknown>): this;
  security(options?: Record<string, unknown>): this;
  redaction(options?: boolean | Record<string, unknown>): this;
  sanitization(options?: boolean | Record<string, unknown>): this;
  metrics(options?: boolean | Record<string, unknown>): this;
  formatter(formatter: unknown): this;
  awaitDelivery(enabled?: boolean): this;
  transport(transport: LoggerTransport, options?: Record<string, unknown>): this;
  transports(...transports: LoggerTransport[]): this;
  processor(processor: Function, options?: Record<string, unknown>): this;
  use(processor: Function, options?: Record<string, unknown>): this;
  plugin(plugin: LoggerPlugin): this;
  done(): AdvancedLogger;
  build(): AdvancedLogger;
}

export interface LoggerFacade<TContext extends LoggerContext = LoggerContext> extends LoggerLike<TContext> {}
export class LoggerFacade<TContext extends LoggerContext = LoggerContext> {
  constructor(logger: LoggerLike<TContext>, options?: Record<string, unknown>);
}
export interface NullLogger extends LoggerLike {}
export class NullLogger { constructor(); }
export const nullLogger: NullLogger;
export interface SwappableLogger<TContext extends LoggerContext = LoggerContext> extends LoggerLike<TContext> {}
export class SwappableLogger<TContext extends LoggerContext = LoggerContext> {
  constructor(target?: LoggerLike<TContext> | null);
  swap(target: LoggerLike<TContext>): LoggerLike<TContext> | null;
  current(): LoggerLike<TContext> | null;
}

export class LevelRegistry {
  constructor(options?: { levels?: LevelDefinition[]; aliases?: Record<string, string> });
  register(definition: LevelDefinition, options?: { replace?: boolean }): this;
  unregister(name: LogLevel): boolean;
  alias(alias: string, target: string, options?: { replace?: boolean }): this;
  resolveName(name: LogLevel): string;
  get(name: LogLevel): Readonly<LevelDefinition> | null;
  has(name: LogLevel): boolean;
  isEnabled(level: LogLevel, threshold: LogLevel): boolean;
  shouldLog(level: LogLevel, threshold: LogLevel): boolean;
  isHighSeverity(level: LogLevel): boolean;
  isDroppable(level: LogLevel): boolean;
  compare(left: LogLevel, right: LogLevel): number;
  names(): string[];
  definitions(): ReadonlyArray<Readonly<LevelDefinition>>;
  snapshot(): Record<string, unknown>;
  clone(): LevelRegistry;
}
export const DEFAULT_LEVELS: ReadonlyArray<Readonly<LevelDefinition>>;

export class ContextManager {
  constructor(options?: { enabled?: boolean; freeze?: boolean });
  get(): Readonly<LoggerContext>;
  current(): Readonly<LoggerContext>;
  merge(context?: LoggerContext): Readonly<LoggerContext>;
  run<TResult>(context: LoggerContext, callback: (...args: unknown[]) => TResult, ...args: unknown[]): TResult;
  enterWith(context: LoggerContext): Readonly<LoggerContext>;
  bind<T extends Function>(callback: T, context?: LoggerContext): T;
  createRequestContext(req?: unknown, extra?: LoggerContext): Readonly<LoggerContext>;
  createJobContext(job?: unknown, extra?: LoggerContext): Readonly<LoggerContext>;
  disable(): void;
}
export const globalContextManager: ContextManager;
export const defaultContextManager: ContextManager;

export class SafeSerializer {
  constructor(options?: Record<string, unknown>);
  normalize<T = unknown>(value: unknown, overrides?: Record<string, unknown>): T;
  stringify(value: unknown, overrides?: Record<string, unknown>): string;
  clone<T = unknown>(value: T, overrides?: Record<string, unknown>): T;
}
export const defaultSerializer: SafeSerializer;
export function truncateUtf8(value: unknown, maxBytes: number): string;
export interface LoggerFormatter { format(record: LogRecord, serializer: SafeSerializer): string; }
export class TextFormatter implements LoggerFormatter { constructor(options?: Record<string, unknown>); format(record: LogRecord, serializer: SafeSerializer): string; }
export class JsonFormatter implements LoggerFormatter { constructor(options?: Record<string, unknown>); format(record: LogRecord, serializer: SafeSerializer): string; }
export class NdjsonFormatter extends JsonFormatter { format(record: LogRecord, serializer: SafeSerializer): string; }
export class LogfmtFormatter implements LoggerFormatter { constructor(options?: Record<string, unknown>); format(record: LogRecord, serializer: SafeSerializer): string; }

export class ErrorNormalizer { constructor(serializer: SafeSerializer, options?: Record<string, unknown>); normalize(error: unknown, depth?: number): StructuredError | null; }
export class RecordFactory {
  constructor(options: Record<string, unknown> & { serializer: SafeSerializer; errorNormalizer: ErrorNormalizer });
  sequence: number;
  create(input?: Record<string, unknown>): LogRecord;
}
export function resolveMessageAndError(message: MaybeLazy<unknown>, data: MaybeLazy<unknown>, options: Record<string, unknown>, serializer: SafeSerializer): { message: string; data: unknown; error: unknown };

export const DEFAULT_REDACTION_KEYS: ReadonlyArray<string>;
export const DEFAULT_SENSITIVE_PATTERNS: ReadonlyArray<RegExp>;
export function sanitizeString(value: unknown, options?: Record<string, unknown>): string;
export function stableAuditStringify(value: unknown): string;

export class Redactor {
  constructor(options?: Record<string, unknown>);
  enabled: boolean;
  redact<T = unknown>(value: T, options?: { inPlace?: boolean }): T;
}
export class SensitiveFieldRegistry { constructor(options?: Record<string, unknown>); matches(key: string): boolean; }
export class ControlCharacterSanitizer { constructor(options?: Record<string, unknown>); sanitize(value: unknown): string; }
export class AuditChain {
  constructor(options: Record<string, unknown>);
  sign(record: LogRecord): Promise<LogRecord>;
  static verify(records: LogRecord[], options: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export class ProcessorRegistry { constructor(options?: Record<string, unknown>); use(processor: Function, options?: Record<string, unknown>): () => boolean; remove(name: string): boolean; hasPhase(phase: string, filter?: Record<string, unknown>): boolean; snapshot(): unknown[]; }
export function SamplingProcessor(options?: Record<string, unknown>): (record: LogRecord) => LogRecord | null;
export function DeduplicationProcessor(options?: Record<string, unknown>): (record: LogRecord) => LogRecord | null;
export class PluginManager { constructor(options?: Record<string, unknown>); use(plugin: LoggerPlugin): this; remove(name: string): boolean; hasHook(hookName: string, filter?: Record<string, unknown>): boolean; snapshot(): Record<string, unknown>; }
export class LoggerMetrics { constructor(options?: Record<string, unknown>); increment(name: string, amount?: number): number; gauge(name: string, value: number): number; observe(name: string, value: number): void; snapshot(): Record<string, unknown>; toPrometheus(labels?: Record<string, unknown>): string; }
export class LoggerHealth { constructor(logger: LoggerLike); snapshot(): LoggerHealthSnapshot; isHealthy(): boolean; assertHealthy(): LoggerHealthSnapshot; }
export class InternalDiagnostics { constructor(options?: Record<string, unknown>); report(code: string, error: unknown, context?: Record<string, unknown>): unknown; snapshot(): unknown[]; }
export const COMPATIBILITY_VIEW: unique symbol;
export class DeliveryQueue { constructor(options?: Record<string, unknown>); enqueue(task: Function, options?: Record<string, unknown>): Record<string, unknown>; flush(options?: Record<string, unknown>): Promise<void>; close(options?: Record<string, unknown>): Promise<void>; snapshot(): Record<string, unknown>; }
export class LoggerLifecycle { constructor(options?: Record<string, unknown>); state: string; transition(state: string, details?: unknown): string; is(...states: string[]): boolean; }

export class LoggerConfigurationError extends Error { code: 'LOGGER_CONFIGURATION_ERROR'; diagnostics: unknown[]; }
export class LoggerConfiguration {
  constructor(configuration?: Record<string, unknown>, options?: Record<string, unknown>);
  diagnostics: ReadonlyArray<Record<string, unknown>>;
  get(path: string | string[], fallback?: unknown): unknown;
  has(path: string | string[]): boolean;
  snapshot(): Record<string, unknown>;
  with(overrides?: Record<string, unknown>, options?: Record<string, unknown>): LoggerConfiguration;
  validate(): Array<Record<string, unknown>>;
}
export function cloneLoggerConfiguration<T>(value: T): T;
export function mergeLoggerConfiguration<T>(base: T, override: Partial<T>): T;
export const COMPATIBILITY_PROFILES: Record<string, Readonly<Record<string, unknown>>>;
export const LOGGER_PROFILES: typeof COMPATIBILITY_PROFILES;
export function resolveCompatibilityProfile(profile?: string | Record<string, unknown>, overrides?: Record<string, unknown>): Readonly<Record<string, unknown>>;
export const resolveLoggerProfile: typeof resolveCompatibilityProfile;

export class ChannelManager {
  constructor(options?: Record<string, unknown>);
  setBindingResolver(resolver: ((key: string) => unknown) | null): this;
  default(name?: string): string | this;
  extend(driver: string, factory: Function, options?: { replace?: boolean }): this;
  define(name: string, definition: unknown, options?: { replace?: boolean }): this;
  channel(name?: string): LoggerLike;
  stack(names: string[] | string, options?: Record<string, unknown>): LoggerLike;
  has(name: string): boolean;
  forget(name: string, options?: Record<string, unknown>): boolean;
  ready(): Promise<this>;
  flush(options?: Record<string, unknown>): Promise<unknown>;
  reopen(options?: Record<string, unknown>): Promise<unknown>;
  close(options?: Record<string, unknown>): Promise<void>;
  health(): Record<string, unknown>;
  stats(): Record<string, unknown>;
  snapshot(): Record<string, unknown>;
}
export class Channel { constructor(name: string, logger: LoggerLike); [key: string]: unknown; }
export interface Channel extends LoggerLike {}
export class StackChannel { constructor(name: string, channels?: LoggerLike[], options?: Record<string, unknown>); [key: string]: unknown; }
export interface StackChannel extends LoggerLike {}

export { BaseTransport as BaseEnterpriseTransport, ConsoleTransport as EnterpriseConsoleTransport, FileTransport as EnterpriseFileTransport, FileTransport as AsyncFileTransport, AuditFileTransport, MemoryTransport, StreamTransport, CallbackTransport, NullTransport, RedisStreamTransport, TcpTransport, UdpTransport, HttpBatchTransport, TransportAdapter, TransportDispatcher } from './transports.js';
export { HttpLoggingMiddleware, createHttpLoggingMiddleware, LoggerServiceProvider, ProcessErrorHandler, EventLoggingBridge } from './integrations.js';
export { InspectorTransport, InspectorServer } from './inspector.js';
export { LoggerRecorder, FakeClock, createLoggerHarness } from './testing.js';
export { runDoctor, runCli, runLoggerBenchmark, tailLogFile } from './console.js';

/** Existing v1 transports retained at the root. */
export class ConsoleTransport { constructor(options?: Record<string, unknown>); write(level: unknown, entry?: unknown): unknown; }
export class FileTransport { constructor(options?: Record<string, unknown>); write(level: unknown, entry?: unknown): unknown; close?(): unknown; }
export class ObservableFileTransport extends FileTransport {}
export class ObservableFileTransportEnhanced extends FileTransport {}
export class ObservableConsoleTransport extends ConsoleTransport {}
export class ObservableConsoleTransportEnhanced extends ConsoleTransport {}

export const Config: {
  readonly levelConfigurations: Record<string, unknown>;
  getLevelConfig(level: string): unknown;
  updateLevelConfig(level: string, config: Record<string, unknown>): unknown;
  resetLevelConfigs(): unknown;
  setProfile(name: string): unknown;
  getProfile(): string;
  registerProfile(name: string, definition: Record<string, unknown>, options?: Record<string, unknown>): unknown;
  listAvailableLevels(): string[];
  listProfiles(): string[];
  snapshot(): Record<string, unknown>;
};
export const colors: Record<string, any>;
export function loadColors(): Promise<Record<string, any>>;
export const defaultLogger: AdvancedLogger;
export const logger: AdvancedLogger;
declare const defaultExport: AdvancedLogger;
export default defaultExport;
