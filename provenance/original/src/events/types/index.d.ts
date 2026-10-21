export type Awaitable<T> = T | PromiseLike<T>;
export type EventMap = object;
export type EventKey<M extends object> = Extract<keyof M, string>;
export type EventArgs<M extends object, K extends string> = K extends keyof M ? M[K] extends readonly unknown[] ? M[K] : readonly unknown[] : readonly unknown[];
export type ErrorPolicy = 'isolate' | 'collect' | 'fail-fast';
export type OverflowPolicy = 'reject' | 'drop-newest' | 'drop-oldest' | 'coalesce';

export interface DeferredOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  priority?: number;
  overflow?: OverflowPolicy;
  coalesceKey?: string;
  awaitTask?: boolean;
  [key: string]: unknown;
}

export interface HistoryEntry {
  eventName?: string;
  ts: number;
  args: unknown[];
  ctx: EventContext | null;
  bytes?: number;
  [key: string]: unknown;
}

export interface BroadcastableContract {
  shouldBroadcast(): boolean;
  broadcastChannel(): string | string[];
  broadcastChannels(): string[];
  broadcastAs(): string;
  broadcastWith(): unknown;
  broadcastWhen(): boolean;
  broadcastNow(): boolean;
  toBroadcastEnvelope(): Record<string, unknown>;
}

export interface BroadcastTransport {
  broadcast?(envelope: Record<string, unknown>, options?: Record<string, unknown>): Awaitable<unknown>;
  publish?(...args: unknown[]): Awaitable<unknown>;
  emit?(...args: unknown[]): unknown;
  close?(): Awaitable<unknown>;
}

export interface EventContext {
  id: string | null;
  parentId: string | null;
  correlationId: string | null;
  causationId: string | null;
  transport: string;
  tenantId: string | null;
  actorId: string | null;
  traceId: string | null;
  spanId: string | null;
  requestId: string | null;
  source: string | null;
  remote: boolean;
  originTransport: string | null;
  originNode: string | null;
  envelopeId: string | null;
  hop: number;
  ts: number;
  headers: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ListenerOptions {
  once?: boolean;
  prepend?: boolean;
  priority?: number;
  owner?: string;
  tag?: string;
  tags?: string[];
  timeoutMs?: number;
  errorPolicy?: ErrorPolicy;
  replay?: boolean | number;
  replayConsumesOnce?: boolean;
  paused?: boolean;
  meta?: unknown;
}

export interface PublicListener {
  listenerId: number;
  kind: 'exact' | 'pattern' | 'any' | string;
  eventName: string | null;
  pattern: string | null;
  owner: string | null;
  tags: string[];
  priority: number;
  once: boolean;
  name: string;
}

export class ListenerHandle {
  constructor(target: unknown, id: number);
  readonly id: number;
  readonly active: boolean;
  readonly paused: boolean;
  readonly metadata: Readonly<Record<string, unknown>> | null;
  describe(): Readonly<Record<string, unknown>> | null;
  pause(): this;
  resume(): this;
  dispose(): boolean;
  unsubscribe(): boolean;
  off(): boolean;
  toJSON(): Readonly<Record<string, unknown>>;
}

export interface DispatchResult {
  listenerId: number;
  status: 'pending' | 'fulfilled' | 'rejected';
  value?: unknown;
  error?: unknown;
}

export class DispatchReport {
  constructor(eventName: string, options?: { mode?: string; startedAt?: number; context?: EventContext | null });
  eventName: string;
  mode: string;
  startedAt: number;
  completedAt: number | null;
  durationMs: number;
  matched: number;
  invoked: number;
  skipped: number;
  results: DispatchResult[];
  errors: Array<{ listenerId: number; error: unknown; phase: string }>;
  stopped: boolean;
  stopValue: unknown;
  aborted: boolean;
  timedOut: boolean;
  context: EventContext | null;
  readonly ok: boolean;
  readonly errorCount: number;
  complete(durationMs: number): this;
  finish(durationMs: number): this;
  toJSON(): Record<string, unknown>;
}

export interface AdvancedEventDispatcherOptions {
  profile?: 'compat' | 'production' | 'enterprise' | 'strict';
  normalizeDot?: boolean;
  logEvents?: boolean;
  logPayloads?: boolean;
  logger?: Record<string, (...args: unknown[]) => unknown>;
  maxListenersPerEvent?: number;
  maxListenersTotal?: number;
  maxPatternListeners?: number;
  maxListenersPerPattern?: number;
  maxAnyListeners?: number;
  planCacheMax?: number;
  historyLimit?: number;
  historyAllow?: string[];
  historyDeny?: string[];
  maxHistoryEvents?: number;
  maxHistoryEntries?: number;
  maxHistoryBytes?: number;
  maxHistoryPayloadBytes?: number;
  historyTtlMs?: number;
  metrics?: boolean | Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  context?: Record<string, unknown>;
  deferred?: Record<string, unknown>;
  security?: Record<string, unknown>;
  dispatch?: { errorPolicy?: ErrorPolicy };
  lifecycle?: { shutdownTimeoutMs?: number; forceOnTimeout?: boolean };
  contracts?: Record<string, unknown>;
  broadcasting?: Record<string, unknown>;
  schemaRegistry?: EventSchemaRegistry;
  codecRegistry?: EventCodecRegistry;
  outbox?: EventOutbox | Record<string, unknown>;
}

export interface EventSubsystemOptions {
  required?: boolean;
  closeOnShutdown?: boolean;
  replace?: boolean;
  meta?: Record<string, unknown>;
}

export interface EventSubsystemSnapshot {
  required: boolean;
  closeOnShutdown: boolean;
  meta: Readonly<Record<string, unknown>> | null;
  snapshot: unknown;
}

export class AdvancedEventDispatcher<M extends object = Record<string, readonly unknown[]>> {
  constructor(options?: AdvancedEventDispatcherOptions);
  readonly configuration: EventConfiguration;
  readonly diagnostics: EventDiagnostics;

  on<K extends EventKey<M>>(eventName: K, listener: (...args: EventArgs<M, K>) => unknown, options?: ListenerOptions): this;
  on(eventName: string, listener: (...args: unknown[]) => unknown, options?: ListenerOptions): this;
  once<K extends EventKey<M>>(eventName: K, listener: (...args: EventArgs<M, K>) => unknown, options?: ListenerOptions): this;
  once(eventName: string, listener: (...args: unknown[]) => unknown, options?: ListenerOptions): this;
  off(eventName: string, listener: (...args: unknown[]) => unknown): this;
  onAny(listener: (eventName: string, ...args: unknown[]) => unknown, options?: ListenerOptions): this;
  offAny(listener: (...args: unknown[]) => unknown): this;
  onPattern(pattern: string, listener: (eventName: string, ...args: unknown[]) => unknown, options?: ListenerOptions): this;
  offPattern(pattern: string, listener: (...args: unknown[]) => unknown): this;
  addListener(eventName: string, listener: (...args: unknown[]) => unknown, options?: ListenerOptions): this;
  removeListener(eventName: string, listener: (...args: unknown[]) => unknown): this;
  removeAllListeners(eventName?: string | null): this;

  subscribe<K extends EventKey<M>>(eventName: K, listener: (...args: EventArgs<M, K>) => unknown, options?: ListenerOptions): ListenerHandle;
  subscribe(eventName: string, listener: (...args: unknown[]) => unknown, options?: ListenerOptions): ListenerHandle;
  subscribePattern(pattern: string, listener: (eventName: string, ...args: unknown[]) => unknown, options?: ListenerOptions): ListenerHandle;
  subscribeAny(listener: (eventName: string, ...args: unknown[]) => unknown, options?: ListenerOptions): ListenerHandle;
  when(eventName: string): SubscriptionBuilder;
  pattern(pattern: string): SubscriptionBuilder;
  any(): SubscriptionBuilder;
  scope(owner: string): ListenerScope;
  removeOwner(owner: string): number;
  removeTag(tag: string): number;

  dispatch<K extends EventKey<M>>(eventName: K, ...args: EventArgs<M, K>): void;
  dispatch(eventName: string, ...args: unknown[]): void;
  dispatch(event: object, ...args: unknown[]): void;
  emit(eventName: string | object, ...args: unknown[]): void;
  dispatchAsync<K extends EventKey<M>>(eventName: K, ...args: EventArgs<M, K>): Promise<void>;
  dispatchAsync(eventName: string | object, ...args: unknown[]): Promise<void>;
  dispatchDeferred(eventName: string | object, ...args: unknown[]): void;
  dispatchDeferredSafe(eventName: string | object, ...args: unknown[]): { accepted: boolean; promise: Promise<unknown>; [key: string]: unknown };
  dispatchDeferredWith(options: Record<string, unknown>, eventName: string | object, ...args: unknown[]): { accepted: boolean; promise: Promise<unknown>; [key: string]: unknown };
  dispatchDeferredAsync(eventName: string | object, ...args: unknown[]): Promise<void>;
  dispatchWithReport(eventName: string | object, ...args: unknown[]): DispatchReport;
  dispatchSettled(eventName: string | object, ...args: unknown[]): Promise<DispatchReport>;
  dispatchParallel(eventName: string | object, ...args: unknown[]): Promise<DispatchReport>;
  dispatchParallelWith(options: { concurrency?: number; signal?: AbortSignal; timeoutMs?: number; errorPolicy?: ErrorPolicy }, eventName: string | object, ...args: unknown[]): Promise<DispatchReport>;
  dispatchDetailed(options: { mode?: 'sync' | 'sequential' | 'parallel'; concurrency?: number; signal?: AbortSignal; timeoutMs?: number; errorPolicy?: ErrorPolicy }, eventName: string | object, ...args: unknown[]): DispatchReport | Promise<DispatchReport>;
  dispatchFirst(eventName: string | object, ...args: unknown[]): Promise<unknown>;
  dispatchUntil(predicate: (value: unknown, listener: PublicListener, report: DispatchReport) => boolean, eventName: string | object, ...args: unknown[]): Promise<DispatchReport>;
  dispatchAndBroadcast(eventName: string | object, ...args: unknown[]): Promise<{ dispatch: DispatchReport; broadcast: Record<string, unknown> }>;
  broadcast(event: object, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  dispatchVersioned(eventName: string, payload: unknown, options?: { version?: number; targetVersion?: number; upcast?: boolean; async?: false }): { eventName: string; version: number; payload: unknown };
  dispatchVersioned(eventName: string, payload: unknown, options: { version?: number; targetVersion?: number; upcast?: boolean; async: true }): Promise<{ eventName: string; version: number; payload: unknown }>;
  dispatchDurable(eventName: string | object, ...args: unknown[]): Promise<unknown>;
  durableOptions(value?: Record<string, unknown>): Readonly<{ __eventDurableOptions: true; value: Record<string, unknown> }>;

  waitFor(eventName: string, options?: { pattern?: boolean; any?: boolean; timeoutMs?: number; signal?: AbortSignal; filter?: (...args: unknown[]) => boolean; map?: (...args: unknown[]) => unknown }): Promise<unknown>;
  iterate(eventName: string, options?: Record<string, unknown>): AsyncIterableIterator<unknown>;

  createContext(meta?: Partial<EventContext>): EventContext;
  childContext(meta?: Partial<EventContext>): EventContext;
  getContext(): EventContext | null;
  getContextId(): string | null;
  run<T>(context: EventContext, fn: () => T): T;
  runIfMissing<T>(meta: Partial<EventContext>, fn: () => T): T;
  enter(context: EventContext): void;
  bind<T extends (...args: any[]) => any>(fn: T): T;

  inspect(eventName: string): Readonly<Record<string, unknown>>;
  listenerManifest(): PublicListener[];
  listeners(eventName: string): Function[];
  listenerCount(eventName?: string | null): number;
  eventNames(): string[];
  hasListeners(eventName?: string): boolean;
  willDispatchTo(eventName: string): boolean;

  getHistory(eventName: string, options?: Record<string, unknown>): Array<{ ts: number; args: unknown[]; ctx: EventContext | null }>;
  getHistoryAll(options?: Record<string, unknown>): Array<{ eventName: string; ts: number; args: unknown[]; ctx: EventContext | null }>;
  clearHistory(eventName?: string | null): number;
  replay(eventName: string, listener: (...args: unknown[]) => unknown, options?: Record<string, unknown>): { replayed: number; errors: unknown[] };

  onDiagnostic(name: string, listener: (payload: unknown) => void): this;
  onceDiagnostic(name: string, listener: (payload: unknown) => void): this;
  offDiagnostic(name: string, listener: (payload: unknown) => void): this;

  setBridge(bridge: unknown): this;
  setBroadcastManager(manager: BroadcastManager | null, options?: { auto?: boolean }): this;
  setOutbox(outbox: EventOutbox | null): this;
  outbox(): EventOutbox | null;
  registerSubsystem(name: string, subsystem: object | Function, options?: { replace?: boolean; required?: boolean; closeOnShutdown?: boolean; meta?: Record<string, unknown> }): this;
  unregisterSubsystem(name: string, options?: { close?: boolean }): boolean;
  subsystem<T = unknown>(name: string): T | null;
  subsystems(): Readonly<Record<string, EventSubsystemSnapshot>>;
  registerSubsystem(name: string, subsystem: object | Function, options?: EventSubsystemOptions): this;
  unregisterSubsystem(name: string, options?: { close?: boolean }): boolean;
  subsystem<T = unknown>(name: string): T | null;
  subsystems(): Readonly<Record<string, EventSubsystemSnapshot>>;
  schemas(): EventSchemaRegistry;
  codecs(): EventCodecRegistry;
  registerSchema(eventName: string, version: number, definition: unknown, options?: Record<string, unknown>): this;
  freezeRegistrations(options?: { contracts?: boolean; codecs?: boolean }): this;
  unfreezeRegistrations(options?: { contracts?: boolean; codecs?: boolean }): this;
  registrationsFrozen(): boolean;

  health(): Readonly<Record<string, unknown>>;
  metrics(): Readonly<Record<string, unknown>>;
  prometheus(prefix?: string): string;
  resetMetrics(): this;
  queueSnapshot(): Readonly<Record<string, unknown>>;
  historySnapshot(): Readonly<Record<string, unknown>>;
  stats(): Readonly<Record<string, unknown>>;
  snapshot(): Readonly<Record<string, unknown>>;
  flush(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<Readonly<Record<string, unknown>>>;
  drain(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<Readonly<Record<string, unknown>>>;
  close(options?: {
    timeoutMs?: number;
    subsystemTimeoutMs?: number;
    signal?: AbortSignal;
    force?: boolean;
    forceOnTimeout?: boolean;
    closeBridge?: boolean;
    closeBroadcasting?: boolean;
    closeOutbox?: boolean;
    closeSubsystems?: boolean;
    failOnSubsystemClose?: boolean;
    removeListeners?: boolean;
    removeDiagnostics?: boolean;
    clearHistory?: boolean;
  }): Promise<Readonly<Record<string, unknown>>>;
}

export class EventDispatcher {
  emitter: unknown;
  on(event: string, listener: (...args: unknown[]) => unknown): void;
  once(event: string, listener: (...args: unknown[]) => unknown): void;
  off(event: string, listener: (...args: unknown[]) => unknown): void;
  dispatch(event: string, ...args: unknown[]): void;
  emit(event: string, ...args: unknown[]): void;
  subscribe(event: string, listener: (...args: unknown[]) => unknown, options?: { once?: boolean }): Readonly<{
    dispose(): boolean;
    off(): boolean;
    unsubscribe(): boolean;
  }>;
  listeners(event: string): Function[];
  listenerCount(event: string): number;
  eventNames(): Array<string | symbol>;
  removeAllListeners(event?: string | symbol): void;
}

export class Event<TPayload = Record<string, unknown>> {
  static eventName?: string;
  static version?: number;
  constructor(payload?: TPayload, options?: { id?: string; timestamp?: number; version?: number; meta?: Record<string, unknown> });
  payload: TPayload;
  timestamp: number;
  id: string;
  version: number;
  meta: Record<string, unknown>;
  readonly eventName: string;
  readonly occurredAt: Date;
  readonly correlationId: string | null;
  readonly causationId: string | null;
  readonly tenantId: string | null;
  withMeta(meta?: Record<string, unknown>): this;
  shouldBroadcast(): boolean;
  broadcastAs(): string;
  toJSON(): Record<string, unknown>;
}

export type Constructor<T = object> = new (...args: any[]) => T;
export function Broadcastable<TBase extends Constructor>(Base: TBase): TBase & Constructor<InstanceType<TBase> & {
  shouldBroadcast(): boolean;
  broadcastChannel(): string | string[];
  broadcastAs(): string;
  broadcastWith(): unknown;
}>;

export class ProtocolEvent<TPayload = Record<string, unknown>> extends Event<TPayload> {
  constructor(payload?: TPayload, meta?: Record<string, unknown> & { protocol?: string; connection?: unknown; transport?: unknown });
  protocol: string;
  connection: unknown;
  transport: unknown;
  connectionMeta: unknown;
  toJSON(): Record<string, unknown>;
}

export class EventRegistry {
  constructor(options?: { priorityOrder?: 'asc' | 'desc' });
  listen(eventName: string, handler: unknown, priority?: number, options?: { owner?: string; tags?: string[] }): void;
  add(eventName: string, handler: unknown, priority?: number, options?: { owner?: string; tags?: string[] }): this;
  subscribe(eventName: string, handler: unknown, priority?: number, options?: { owner?: string; tags?: string[] }): Readonly<{ id: number; dispose(): boolean; off(): boolean }>;
  getListeners(eventName: string): Array<{ id: number; handler: unknown; priority: number; owner: string | null; tags: string[] }>;
  has(eventName: string): boolean;
  eventNames(): string[];
  removeById(id: number): boolean;
  removeOwner(owner: string): number;
  clear(eventName?: string | null): number;
  registerSubscriber(SubscriberClass: unknown, options?: Record<string, unknown>): void;
  subscriber(SubscriberClass: unknown, options?: Record<string, unknown>): this;
  manifest(): Array<Record<string, unknown>>;
}

export interface EventMetricRecord {
  count: number;
  failures: number;
  totalTime: number;
  minTime: number;
  maxTime: number;
  lastTime: number;
  averageTime: number;
}
export class EventMetrics {
  constructor(options?: { maxSeries?: number; prefix?: string });
  record(event: string, duration: number, error?: unknown): this;
  reset(): this;
  snapshot(): Record<string, EventMetricRecord>;
  prometheus(prefix?: string): string;
}

export class EventConfiguration {
  constructor(options?: AdvancedEventDispatcherOptions);
  readonly value: Readonly<Record<string, any>>;
  get(path: string, fallback?: unknown): unknown;
  toJSON(): Readonly<Record<string, any>>;
  static profiles(): string[];
}

export class SubscriptionBuilder {
  priority(value: number): this;
  prepend(value?: boolean): this;
  once(value?: boolean): this;
  replay(value?: boolean | number): this;
  replayConsumesOnce(value?: boolean): this;
  owner(value: string | null): this;
  tag(...values: string[]): this;
  timeout(value: number): this;
  errorPolicy(value: ErrorPolicy): this;
  meta(value: unknown): this;
  paused(value?: boolean): this;
  when(condition: boolean | (() => boolean)): this;
  listen(listener: (...args: unknown[]) => unknown): ListenerHandle | null;
  handle(listener: (...args: unknown[]) => unknown): ListenerHandle | null;
  using(listener: (...args: unknown[]) => unknown): ListenerHandle | null;
}

export class ListenerScope {
  readonly owner: string;
  readonly closed: boolean;
  subscribe(eventName: string, listener: (...args: unknown[]) => unknown, options?: ListenerOptions): ListenerHandle;
  on(eventName: string, listener: (...args: unknown[]) => unknown, options?: ListenerOptions): this;
  once(eventName: string, listener: (...args: unknown[]) => unknown, options?: ListenerOptions): this;
  pattern(pattern: string, listener: (eventName: string, ...args: unknown[]) => unknown, options?: ListenerOptions): ListenerHandle;
  onPattern(pattern: string, listener: (eventName: string, ...args: unknown[]) => unknown, options?: ListenerOptions): this;
  any(listener: (eventName: string, ...args: unknown[]) => unknown, options?: ListenerOptions): ListenerHandle;
  onAny(listener: (eventName: string, ...args: unknown[]) => unknown, options?: ListenerOptions): this;
  pause(): this;
  resume(): this;
  dispose(): number;
}
export class ListenerBuilder extends SubscriptionBuilder {}
export class AsyncEventIterator<T = unknown> implements AsyncIterableIterator<T> {
  constructor(options?: Record<string, unknown>);
  attach(handle: ListenerHandle): this;
  push(value: T): boolean;
  next(): Promise<IteratorResult<T>>;
  return(): Promise<IteratorResult<T>>;
  throw(error: unknown): Promise<never>;
  close(): void;
  fail(error: unknown): void;
  [Symbol.asyncIterator](): this;
}

export class RingBuffer<T = unknown> implements Iterable<T> {
  constructor(capacity: number);
  readonly capacity: number;
  readonly length: number;
  push(value: T): T | undefined;
  peek(): T | undefined;
  shift(): T | undefined;
  clear(): void;
  remove(predicate: (value: T) => boolean): number;
  toArray(): T[];
  [Symbol.iterator](): Iterator<T>;
}

export class EventJournal {
  constructor(options?: Record<string, unknown>);
  readonly enabled: boolean;
  record(eventName: string, args: unknown[], context?: EventContext | null): Record<string, unknown>;
  get(eventName: string, options?: Record<string, unknown>): any[];
  all(options?: Record<string, unknown>): any[];
  clear(eventName?: string | null): number;
  snapshot(): Readonly<Record<string, unknown>>;
}

export class DeferredEventScheduler {
  constructor(options?: Record<string, unknown>);
  readonly length: number;
  schedule(task: () => unknown, options?: Record<string, unknown>): { accepted: boolean; promise: Promise<unknown> };
  flush(): Promise<Readonly<Record<string, unknown>>>;
  drain(): Promise<Readonly<Record<string, unknown>>>;
  close(options?: { force?: boolean }): Promise<Readonly<Record<string, unknown>>>;
  snapshot(): Readonly<Record<string, unknown>>;
}

export class EventDiagnostics {
  constructor(options?: Record<string, unknown>);
  enabled: boolean;
  active(name?: string | null): boolean;
  on(name: string, listener: (...args: any[]) => void): this;
  once(name: string, listener: (...args: any[]) => void): this;
  off(name: string, listener: (...args: any[]) => void): this;
  emit(name: string, payload: unknown): boolean;
  history(options?: Record<string, unknown>): Array<Record<string, unknown>>;
  snapshot(): Readonly<Record<string, unknown>>;
  close(): void;
}

export class EventRedactor {
  constructor(options?: Record<string, unknown>);
  redact(value: unknown): unknown;
}
export class EventMetricsStore {
  constructor(options?: Record<string, unknown>);
  readonly enabled: boolean;
  snapshot(): Readonly<Record<string, unknown>>;
  prometheus(prefix?: string): string;
  reset(): void;
}
export class EventHealth { constructor(dispatcher: AdvancedEventDispatcher, options?: Record<string, unknown>); check(): Readonly<Record<string, unknown>>; }
export function formatPrometheusSnapshot(snapshot: Record<string, unknown>, prefix?: string): string;
export function sanitizeMetricName(value: unknown): string;
export function escapeLabel(value: unknown): string;

export class EventSecurityPolicy {
  constructor(options?: Record<string, unknown>);
  validateName(name: string, options?: { pattern?: boolean }): true;
  validatePattern(pattern: string): true;
  validateDispatch(name: string, args: unknown[], context?: EventContext | null, options?: { skipName?: boolean }): true;
  snapshot(): Readonly<Record<string, unknown>>;
}

export interface SafeJsonEncodeResult {
  text: string;
  bytes: number;
  truncated: boolean;
  keyCount: number;
}
export interface SafeJsonSanitizeResult {
  value: unknown;
  truncated: boolean;
  keyCount: number;
}
export class SafeJsonCodec {
  constructor(options?: Record<string, unknown>);
  sanitize(value: unknown, options?: Record<string, unknown>): SafeJsonSanitizeResult;
  encode(value: unknown, options?: Record<string, unknown>): SafeJsonEncodeResult;
  parse(value: string | Uint8Array, options?: Record<string, unknown>): unknown;
  stringify(value: unknown, options?: Record<string, unknown>): string;
}

export class EventCodecRegistry {
  constructor(options?: Record<string, unknown>);
  register(name: string, codec: unknown, options?: { replace?: boolean }): this;
  unregister(name: string): boolean;
  has(name: string): boolean;
  get(name?: string): any;
  use(name: string): this;
  encode(value: unknown, options?: Record<string, unknown>, name?: string): unknown;
  parse(value: unknown, options?: Record<string, unknown>, name?: string): unknown;
  freeze(): this;
  unfreeze(): this;
  names(): string[];
  snapshot(): Readonly<Record<string, unknown>>;
}

export interface EventEnvelope {
  v: number;
  id: string;
  event: string;
  args: unknown[];
  timestamp: number;
  [key: string]: unknown;
}
export function canonicalizeEventEnvelope(envelope: EventEnvelope, options?: Record<string, unknown>): string;
export function verifyEventEnvelopeSignature(envelope: EventEnvelope, secret: string | Uint8Array): boolean;
export function normalizeEventEnvelope(input: unknown): EventEnvelope;
export function assertEventEnvelope(input: unknown, options?: Record<string, unknown>): EventEnvelope;
export function createEventEnvelope(eventName: string, args?: unknown[], options?: Record<string, unknown>): EventEnvelope;
export function validateEventEnvelope(envelope: unknown, options?: Record<string, unknown>): { ok: boolean; envelope?: EventEnvelope; code?: string; error?: unknown };
export function signEventEnvelope(envelope: EventEnvelope, secret: string | Uint8Array): string;

export class EventSchemaRegistry {
  constructor(options?: Record<string, unknown>);
  register(eventName: string, version: number, definition: unknown, options?: Record<string, unknown>): this;
  define(eventName: string, version: number, definition: unknown, options?: Record<string, unknown>): this;
  has(eventName: string, version?: number): boolean;
  get(eventName: string, version?: number): unknown;
  latestVersion(eventName: string): number | null;
  validate(eventName: string, version: number, payload: unknown, context?: Record<string, unknown>): unknown;
  validateAsync(eventName: string, version: number, payload: unknown, context?: Record<string, unknown>): Promise<unknown>;
  upcast(eventName: string, sourceVersion: number, payload: unknown, targetVersion?: number, context?: Record<string, unknown>): { eventName: string; version: number; payload: unknown };
  upcastAsync(eventName: string, sourceVersion: number, payload: unknown, targetVersion?: number, context?: Record<string, unknown>): Promise<{ eventName: string; version: number; payload: unknown }>;
  downcast(eventName: string, sourceVersion: number, payload: unknown, targetVersion: number, context?: Record<string, unknown>): { eventName: string; version: number; payload: unknown };
  eventNames(): string[];
  manifest(): Array<Record<string, unknown>>;
  freeze(): this;
  unfreeze(): this;
  snapshot(): Readonly<Record<string, unknown>>;
}

export class RedisEventBridge {
  constructor(app?: unknown, options?: Record<string, unknown>);
  readonly state: string;
  readonly ready: boolean;
  readonly required: boolean;
  start(options?: Record<string, unknown>): Promise<this>;
  publish(eventName: string, args?: unknown[], options?: Record<string, unknown>): { accepted: boolean; promise: Promise<unknown>; [key: string]: unknown };
  health(): Readonly<Record<string, unknown>>;
  snapshot(): Readonly<Record<string, unknown>>;
  stop(): Promise<Readonly<Record<string, unknown>>>;
  close(): Promise<Readonly<Record<string, unknown>>>;
}

export class RedisStreamTransport {
  constructor(client: unknown, options?: Record<string, unknown>);
  ensureGroup(): Promise<boolean>;
  publish(eventName: string, args?: unknown[], options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  publishEnvelope(envelope: EventEnvelope, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  read(options?: Record<string, unknown>): Promise<any[]>;
  decode(message: unknown): EventEnvelope;
  ack(...ids: string[]): Promise<number>;
  fail(message: unknown, error: unknown): Promise<Record<string, unknown>>;
  deadLetter(message: unknown, error: unknown): Promise<boolean>;
  recoverPending(options?: Record<string, unknown>): Promise<any[]>;
  consumeOnce(handler?: (...args: any[]) => Awaitable<unknown>, options?: Record<string, unknown>): Promise<Record<string, number>>;
  start(handler?: (...args: any[]) => Awaitable<unknown>, options?: Record<string, unknown>): this;
  consume(handler?: (...args: any[]) => Awaitable<unknown>, options?: Record<string, unknown>): this;
  stop(): Promise<Readonly<Record<string, unknown>>>;
  snapshot(): Readonly<Record<string, unknown>>;
  close(): Promise<Readonly<Record<string, unknown>>>;
}

export class BroadcastManager {
  constructor(dispatcher?: AdvancedEventDispatcher | null, options?: Record<string, unknown>);
  register(name: string, transport: unknown, options?: Record<string, unknown>): this;
  unregister(name: string): boolean;
  start(dispatcher?: AdvancedEventDispatcher): this;
  broadcast(event: object, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  snapshot(): Readonly<Record<string, unknown>>;
  close(): Promise<Readonly<Record<string, unknown>>>;
}

export class MemoryOutboxStore {
  constructor(options?: Record<string, unknown>);
  append(record: Record<string, unknown>): Promise<Record<string, unknown>>;
  claim(options?: Record<string, unknown>): Promise<any[]>;
  complete(id: string, options?: Record<string, unknown>): Promise<any>;
  fail(id: string, error: unknown, options?: Record<string, unknown>): Promise<any>;
  release(id: string, options?: Record<string, unknown>): Promise<any>;
  get(id: string): any;
  all(options?: Record<string, unknown>): any[];
  remove(id: string): boolean;
  prune(options?: Record<string, unknown>): number;
  snapshot(): Readonly<Record<string, unknown>>;
  close(): unknown;
}
export class EventOutbox {
  constructor(options?: Record<string, unknown>);
  enqueue(eventName: string | object, args?: unknown[], options?: Record<string, unknown>): Promise<unknown>;
  dispatchAfterCommit(transaction: { afterCommit(callback: () => Awaitable<void>): unknown }, eventName: string | object, args?: unknown[], options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  snapshot(): Readonly<Record<string, unknown>> | null;
  close(): unknown;
}
export class OutboxPublisher {
  constructor(store: MemoryOutboxStore, transport: { publish(...args: any[]): Awaitable<unknown> }, options?: Record<string, unknown>);
  runOnce(options?: Record<string, unknown>): Promise<Record<string, number>>;
  start(): this;
  flush(options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  stop(options?: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;
  close(options?: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;
  snapshot(): Readonly<Record<string, unknown>>;
}
export class MemoryEventInbox {
  constructor(options?: Record<string, unknown>);
  run<T>(key: string, handler: () => Awaitable<T>, options?: Record<string, unknown>): Promise<T>;
  has(key: string): boolean;
  remember(key: string, value?: unknown, options?: Record<string, unknown>): unknown;
  clear(): void;
  snapshot(): Readonly<Record<string, unknown>>;
}

export class JobHandle<T = unknown> implements PromiseLike<T> {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly promise: Promise<T>;
  cancel(reason?: string | Error): boolean;
  then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2>;
  catch<TResult = never>(onRejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null): Promise<T | TResult>;
  finally(onFinally?: (() => void) | null): Promise<T>;
}
export class EventJobQueue {
  constructor(options?: Record<string, unknown>);
  register<T = unknown, R = unknown>(name: string, handler: (payload: T, context: Record<string, any>) => Awaitable<R>, options?: { replace?: boolean }): this;
  unregister(name: string): boolean;
  enqueue<T = unknown, R = unknown>(name: string, payload: T, options?: Record<string, unknown>): JobHandle<R>;
  dispatch<T = unknown, R = unknown>(eventName: string, args?: unknown[], options?: Record<string, unknown>): JobHandle<R>;
  cancel(id: string, reason?: string | Error): boolean;
  get(id: string): Record<string, any> | null;
  pause(): this;
  resume(): this;
  flush(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<Readonly<Record<string, unknown>>>;
  close(options?: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;
  snapshot(): Readonly<Record<string, unknown>>;
}
export class EventScheduler {
  constructor(options?: Record<string, unknown>);
  every(intervalMs: number, task: Function, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
  at(date: Date | number, task: Function, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
  cron(expression: string, task: Function, options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
  event(eventName: string, args?: unknown[], options?: Record<string, unknown>): Readonly<Record<string, unknown>>;
  cancel(id: string): boolean;
  pause(id: string): boolean;
  resume(id: string): boolean;
  list(): Array<Record<string, unknown>>;
  snapshot(): Readonly<Record<string, unknown>>;
  close(): void;
}
export function compileCron(expression: string): (date: Date) => boolean;

export class MemoryWorkflowStore {
  constructor(options?: Record<string, unknown>);
  create(record: Record<string, unknown>): Promise<any>;
  get(id: string): Promise<any>;
  save(record: Record<string, unknown>): Promise<any>;
  remove(id: string): Promise<boolean>;
  list(options?: Record<string, unknown>): Promise<any[]>;
  snapshot(): Readonly<Record<string, unknown>>;
}
export class WorkflowEngine {
  constructor(options?: Record<string, unknown>);
  define(name: string, steps: Array<Function | Record<string, unknown>>, options?: Record<string, unknown>): this;
  start(name: string, input?: unknown, options?: Record<string, unknown>): Promise<any>;
  resume(id: string, options?: Record<string, unknown>): Promise<any>;
  run(id: string, options?: Record<string, unknown>): Promise<any>;
  compensate(id: string, options?: Record<string, unknown>): Promise<any>;
  get(id: string): Promise<any>;
  list(options?: Record<string, unknown>): Promise<any[]>;
  snapshot(): Readonly<Record<string, unknown>>;
  close(): Promise<void>;
}

export interface StoredEventRecord extends Record<string, unknown> {
  id: string;
  streamId: string;
  streamVersion: number;
  globalPosition: number;
  eventName: string;
  eventVersion: number;
  payload: unknown;
  timestamp: number;
}

export class AggregateRoot {
  constructor(id?: string | null);
  id: string | null;
  version: number;
  record(event: object): this;
  applyEvent(event: object, replaying?: boolean): this;
  loadFromHistory(events?: unknown[]): this;
  uncommittedEvents(): object[];
  hasUncommittedEvents(): boolean;
  markCommitted(): this;
  toSnapshot(): Readonly<{ id: string | null; version: number; state: Record<string, unknown> }>;
  restoreSnapshot(snapshot: Record<string, unknown>): this;
}
export class MemoryEventStore {
  constructor(options?: Record<string, unknown>);
  version(streamId: string): number;
  append(streamId: string, events: object | object[], options?: Record<string, unknown>): Promise<{ streamId: string; version: number; records: any[] }>;
  commit(aggregate: AggregateRoot, options?: Record<string, unknown>): Promise<{ streamId: string; version: number; records: any[] }>;
  read(streamId: string, options?: Record<string, unknown>): any[];
  readAll(options?: Record<string, unknown>): any[];
  iterate(options?: Record<string, unknown>): AsyncIterableIterator<any>;
  subscribe(listener: (records: any[]) => Awaitable<void>): () => boolean;
  saveSnapshot(streamId: string, snapshot: Record<string, unknown>): Promise<any>;
  getSnapshot(streamId: string): any;
  deleteSnapshot(streamId: string): boolean;
  snapshot(): Readonly<Record<string, unknown>>;
  close(): Readonly<Record<string, unknown>>;
}
export class MemoryProjectionCheckpointStore {
  get(name: string): Promise<number>;
  set(name: string, position: number): Promise<number>;
  clear(name?: string | null): Promise<void>;
  snapshot(): Readonly<Record<string, number>>;
}
export class ProjectionManager {
  constructor(eventStore: MemoryEventStore, options?: Record<string, unknown>);
  register(name: string, handlers: Function | Record<string, Function>, options?: Record<string, unknown>): this;
  unregister(name: string): boolean;
  project(name: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  rebuild(name: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  snapshot(): Readonly<Record<string, unknown>>;
}

export class EventServiceProvider {
  static priority: number;
  static dependencies: string[];
  constructor(app: unknown);
  readonly registrationReport: Record<string, unknown> | null;
  readonly queue: EventJobQueue | null;
  readonly scheduler: EventScheduler | null;
  readonly workflows: WorkflowEngine | null;
  readonly eventStore: MemoryEventStore | null;
  readonly projections: ProjectionManager | null;
  register(): void;
  boot(): Promise<Record<string, unknown>>;
  teardown(): Promise<void>;
}

export class FakeEventBus extends AdvancedEventDispatcher {
  fake(patterns?: string | string[], options?: Record<string, unknown>): this;
  restore(patterns?: string | string[]): this;
  dispatched(eventName?: string): any[];
}
export class EventRecorder {
  constructor(dispatcher?: AdvancedEventDispatcher, options?: Record<string, unknown>);
  start(dispatcher?: AdvancedEventDispatcher): this;
  stop(): this;
  all(eventName?: string): any[];
  clear(): this;
}
export class ManualClock {
  constructor(start?: number);
  now(): number;
  advance(ms: number): number;
  set(value: number): number;
}
export class MemoryEventTransport {
  constructor(options?: Record<string, unknown>);
  publish(eventName: string, payload: unknown, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  all(eventName?: string): any[];
  clear(): void;
  snapshot(): Readonly<Record<string, unknown>>;
}
export class EventAssertions {
  constructor(source: unknown);
  dispatched(eventName: string, predicate?: (record: unknown) => boolean): this;
  notDispatched(eventName: string): this;
  dispatchedTimes(eventName: string, count: number): this;
}

export class EventError extends Error { code: string; details: unknown; eventName: string | null; }
export class EventConfigurationError extends EventError {}
export class EventAdmissionError extends EventError {}
export class EventTimeoutError extends EventError { timeoutMs: number | null; }
export class EventAbortError extends EventError {}
export class EventClosedError extends EventError {}
export class EventTransportError extends EventError {}
export class EventStoreError extends EventError {}
export class EventConcurrencyError extends EventStoreError { expectedVersion: number | null; actualVersion: number | null; streamId: string | null; }

export function validateEventName(name: string): true;
export function normalizeEventName(name: string, options?: { normalizeDot?: boolean }): string;
export function parseEventName(name: string, options?: { normalizeDot?: boolean }): Readonly<Record<string, unknown>>;
export function eventName(domain: unknown, subject?: unknown, verb?: unknown): string;
export function isReservedEventName(name: string): boolean;
export function assertFrameworkEventName(name: string): true;
export const RESERVED_EVENT_PREFIXES: readonly string[];

export class EventsListCommand { constructor(app: unknown); signature: string; description: string; handle(options?: Record<string, unknown>): Promise<unknown>; }
export class EventsInspectCommand extends EventsListCommand {}
export class EventsDoctorCommand extends EventsListCommand {}
export class EventsStatsCommand extends EventsListCommand {}
export class EventsHistoryCommand extends EventsListCommand {}
export class EventsReplayCommand extends EventsListCommand {}
export class EventsBridgeStatusCommand extends EventsListCommand {}
export class EventsBridgeTestCommand extends EventsListCommand {}
export class EventsBenchCommand extends EventsListCommand {}
export const EVENT_COMMANDS: readonly (readonly [string, new (app: unknown) => unknown])[];

declare const Events: Readonly<Record<string, unknown>>;
export default Events;
