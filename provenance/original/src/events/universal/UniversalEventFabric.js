'use strict';

import { resolveEventCompatibilityProfile } from '../compatibility/CompatibilityProfile.js';
import { UniversalRuntimeAdapter } from './runtime/UniversalRuntimeAdapter.js';
import { ExplicitEventContextManager } from './context/ExplicitEventContextManager.js';
import { EventDefinitionRegistry } from './definitions/EventDefinitionRegistry.js';
import { EventResourceGovernor } from './resources/EventResourceGovernor.js';
import { EventMiddlewarePipeline } from './middleware/EventMiddlewarePipeline.js';
import { UniversalEventMetrics } from './observability/UniversalEventMetrics.js';
import { EventFlightRecorder } from './observability/EventFlightRecorder.js';
import { EventTransportRegistry } from './transport/EventTransportRegistry.js';
import { EventTransportRouter } from './transport/EventTransportRouter.js';
import { LocalEventTransport } from './transport/LocalEventTransport.js';
import { OutboxFabricTransport } from './transport/OutboxFabricTransport.js';
import { EventOperationBuilder } from './operations/EventOperationBuilder.js';
import { EventSubscriptionBuilder } from './operations/EventSubscriptionBuilder.js';
import { EventRequestManager } from './requests/EventRequestManager.js';
import { UniversalEventEnvelope } from './envelope/UniversalEventEnvelope.js';
import { ChannelAuthorizationRegistry } from './security/ChannelAuthorizationRegistry.js';
import { EventAdmissionGateway } from './security/EventAdmissionGateway.js';
import { EventDeliveryResult, EventDeliveryState, deliveryError } from './delivery/EventDelivery.js';
import { assertEventName, byteLength, deepFreeze, safeError } from './support/safe.js';

export class UniversalEventFabric {
  constructor(options = {}) {
    if (!options.dispatcher) throw new TypeError('UniversalEventFabric requires a dispatcher.');
    this.dispatcher = options.dispatcher;
    this.profile = resolveEventCompatibilityProfile(options.profile || options.configuration?.profile || 'compat', options.compatibilityOverrides || {});
    this.runtime = options.runtime || new UniversalRuntimeAdapter(options.runtimeOptions || {});
    this.contexts = options.contexts || new ExplicitEventContextManager(options.context || {});
    this.definitions = options.definitions instanceof EventDefinitionRegistry ? options.definitions : new EventDefinitionRegistry({ maxDefinitions: this.profile.limits.maxDefinitions, ...(options.definitions || {}), definitions: options.eventDefinitions || options.definitions?.definitions });
    this.resources = options.resources || new EventResourceGovernor({ ...this.profile.limits, ...(options.resourceGovernor || {}) });
    this.middleware = options.middleware || new EventMiddlewarePipeline({ maxMiddleware: this.profile.limits.maxMiddleware, errorPolicy: this.profile.middlewareErrorPolicy, ...(options.middlewareOptions || {}) });
    this.metrics = options.metrics instanceof UniversalEventMetrics ? options.metrics : new UniversalEventMetrics({ enabled: this.profile.metrics, maxSeries: this.profile.limits.maxMetricSeries, ...(options.metrics || {}) });
    this.flightRecorder = options.flightRecorder instanceof EventFlightRecorder ? options.flightRecorder : new EventFlightRecorder({ enabled: this.profile.flightRecorder, limit: this.profile.limits.maxFlightRecords, ...(options.flightRecorder || {}) });
    this.transports = options.transports instanceof EventTransportRegistry ? options.transports : new EventTransportRegistry({ maxTransports: this.profile.limits.maxTransports, ...(options.transports || {}) });
    this.router = options.router || new EventTransportRouter(this.transports, { defaultTransport: options.defaultTransport || 'local', fallback: this.profile.transportFallback, ...(options.routerOptions || {}) });
    this.authorizer = options.authorizer || new ChannelAuthorizationRegistry({ defaultEffect: this.profile.name === 'compat' ? 'allow' : 'deny', ...(options.authorization || {}) });
    this.cryptoProvider = options.cryptoProvider || null;
    this.gateway = options.gateway || new EventAdmissionGateway({ profile: this.profile, definitions: this.definitions, cryptoProvider: this.cryptoProvider, authorizer: this.authorizer, authenticator: options.authenticator, tenantResolver: options.tenantResolver, seenOptions: options.seen, limits: this.profile.limits });
    this.requests = options.requests || new EventRequestManager(this, { timeoutMs: this.profile.limits.requestTimeoutMs, ...(options.requestOptions || {}) });
    this.queue = options.queue || null;
    this.outbox = options.outbox || this.dispatcher.outbox?.() || null;
    this.eventStore = options.eventStore || null;
    this.application = options.application || null;
    this.nodeId = options.nodeId || null;
    this.state = 'created';
    this.startedAt = 0;
    this.stats = { dispatches: 0, publishes: 0, durable: 0, enqueued: 0, recorded: 0, inbound: 0, rejected: 0, errors: 0 };
    this.transportReceivers = new Map();
    if (!this.transports.has('local')) this.transports.register(new LocalEventTransport(this.dispatcher), { owned: true });
    for (const transport of options.transportList || []) this.transports.register(transport, { owned: options.ownTransports !== false });
    for (const transport of this.transports.all()) this._bindTransport(transport);
    this.outboxTransport = new OutboxFabricTransport(this);
    this.attach(options.attach !== false);
  }

  attach(enabled = true) {
    if (!enabled) return this;
    const bus = this.dispatcher;
    const methods = {
      fabric: () => this,
      event: (name, payload) => this.event(name, payload),
      subscription: (name, options) => this.subscription(name, options),
      defineEvent: (definition, options) => this.define(definition, options),
      registerTransport: (transport, options) => this.transport(transport, options),
      publish: (eventOrOperation, payload, options) => this.publish(eventOrOperation, payload, options),
      requestEvent: (eventOrOperation, payload, options) => this.request(eventOrOperation, payload, options),
      inboundEvent: (envelope, context) => this.inbound(envelope, context),
      eventFabricSnapshot: () => this.snapshot(),
    };
    for (const [name, fn] of Object.entries(methods)) if (typeof bus[name] !== 'function') Object.defineProperty(bus, name, { value: fn, configurable: true, writable: false, enumerable: false });
    Object.defineProperty(bus, '__rawnodeUniversalEventFabric', { value: this, configurable: true, writable: false, enumerable: false });
    return this;
  }

  async start(context = {}) {
    if (this.state === 'started') return this;
    if (this.state === 'closed') throw Object.assign(new Error('Universal Event Fabric is closed.'), { code: 'EVENT_FABRIC_CLOSED' });
    this.state = 'starting';
    try {
      if (context.startTransports !== false) await this.transports.startAll({ ...context, fabric: this });
      if (this.profile.freezeDefinitions) this.definitions.freeze();
      if (this.profile.freezeTransports) this.transports.freeze();
      if (this.profile.dynamicRegistration === false) this.middleware.freeze();
      this.state = 'started'; this.startedAt ||= Date.now();
      this.flightRecorder.record('fabric:started', { profile: this.profile.name, runtime: this.runtime.snapshot() });
      return this;
    } catch (error) { this.state = 'failed'; this.stats.errors++; throw error; }
  }

  event(name, payload = undefined) { return new EventOperationBuilder(this, name, payload); }
  subscription(name, options = {}) { return new EventSubscriptionBuilder(this, name, options); }
  define(definition, options = {}) { return this.definitions.register(definition, options); }
  transport(transport, options = {}) { const registered = this.transports.register(transport, options); this._bindTransport(registered); return registered; }
  _bindTransport(transport) {
    if (!transport?.id || transport.id === 'local' || typeof transport.subscribe !== 'function' || this.transportReceivers.has(transport.id)) return transport;
    const dispose = transport.subscribe((envelope, context = {}) => this.inbound(envelope, { ...context, transport, remote: context.remote !== false }));
    this.transportReceivers.set(transport.id, typeof dispose === 'function' ? dispose : () => dispose?.dispose?.());
    return transport;
  }
  transportPolicy(pattern, policy = {}) { return this.router.policy(pattern, policy); }
  channel(pattern, authorize, options = {}) { return this.authorizer.define(pattern, authorize, options); }
  use(phase, middleware, options = {}) { return this.middleware.use(phase, middleware, options); }
  scope(owner) { return this.dispatcher.scope(owner); }
  getContext() { return this.dispatcher.getContext?.() || this.contexts.get(); }
  createContext(meta = {}) { return this.dispatcher.createContext?.(meta) || this.contexts.create(meta); }
  run(context, operation) { return this.dispatcher.run?.(context, operation) ?? this.contexts.run(context, operation); }

  dispatch(eventName, payload, options = {}) {
    const name = assertEventName(eventName, this.profile.limits);
    if (this.profile.localValidation) {
      const definition = this.definitions.get(name, options.version || 1);
      if (!definition && !this.profile.allowUnknownEvents) throw Object.assign(new Error(`Unknown event '${name}'.`), { code: 'EVENT_DEFINITION_UNKNOWN' });
    }
    this.stats.dispatches++; this.metrics.increment('dispatch_total', 1, { event: metricEvent(name) });
    this.flightRecorder.record('dispatch:started', { eventName: name, correlationId: this.getContext()?.correlationId || null });
    return this.dispatcher.dispatch(name, payload);
  }

  async dispatchAsync(eventName, payload, options = {}) {
    const name = assertEventName(eventName, this.profile.limits);
    if (this.profile.localValidation) await this.definitions.assert(name, options.version || 1, payload, { eventContext: options.context || this.getContext(), phase: 'local' });
    const started = this.runtime.monotonicNow(); this.stats.dispatches++;
    try {
      return await this.middleware.run('beforeDispatch', { fabric: this, eventName: name, payload, options, context: options.context || this.getContext() }, async (context) => {
        const value = await this.dispatcher.dispatchAsync(name, context.payload);
        await this.middleware.run('afterDispatch', { ...context, result: value });
        return value;
      });
    } finally { const duration = this.runtime.monotonicNow() - started; this.metrics.increment('dispatch_total', 1, { event: metricEvent(name) }); this.metrics.observe('dispatch_duration_ms', duration, { event: metricEvent(name) }); this.flightRecorder.record('dispatch:finished', { eventName: name, durationMs: duration, correlationId: options.context?.correlationId || this.getContext()?.correlationId || null }); }
  }

  async publish(eventOrOperation, payloadOrOptions = undefined, maybeOptions = undefined) {
    const { operation, options } = normalizeOperation(eventOrOperation, payloadOrOptions, maybeOptions);
    const name = assertEventName(operation.name, this.profile.limits);
    operation.name = name;
    operation.context ||= options.context || this.getContext() || this.createContext({ source: 'publish' });
    operation.delivery ||= {};
    if (operation.delivery.partitionKey == null && typeof operation.partitionResolver === 'function') {
      operation.delivery.partitionKey = operation.partitionResolver(operation.payload, operation.context);
    }
    delete operation.partitionResolver;
    const definition = this.definitions.get(name, operation.version || 1) || this.definitions.get(name);
    if (!definition && !this.profile.allowUnknownEvents) throw Object.assign(new Error(`Unknown event '${name}'.`), { name: 'EventDefinitionError', code: 'EVENT_DEFINITION_UNKNOWN' });
    if (definition) {
      operation.version ||= definition.version;
      operation.routing ||= {};
      if ((!operation.routing.transports || !operation.routing.transports.length) && definition.transports.length) operation.routing.transports = [...definition.transports];
      operation.routing.audience ||= definition.visibility;
      operation.security ||= {};
      operation.security.classification ||= definition.classification;
      operation.delivery ||= {};
      operation.delivery.mode ||= definition.delivery;
      operation.delivery.partitionKey ??= definition.partition(operation.payload, operation.context);
      if (definition.idempotency && !operation.delivery.idempotencyKey) operation.delivery.idempotencyKey = `${name}:${operation.version}:${operation.delivery.partitionKey || operation.id || ''}`;
      if (this.profile.remoteValidation !== false || options.validate === true) await this.definitions.assert(name, operation.version, operation.payload, { eventContext: operation.context, phase: 'publish' });
    } else operation.version ||= 1;
    if (this.profile.limits.maxPayloadBytes > 0 && byteLength(operation.payload) > this.profile.limits.maxPayloadBytes) throw Object.assign(new RangeError(`Event payload exceeds ${this.profile.limits.maxPayloadBytes} bytes.`), { code: 'EVENT_PAYLOAD_TOO_LARGE' });
    const started = this.runtime.monotonicNow(); this.stats.publishes++;
    const context = { fabric: this, eventName: name, operation, options, definition, context: operation.context };
    try {
      return await this.middleware.run('beforeEnvelope', context, async (prepared) => {
        const envelope = await UniversalEventEnvelope.create(prepared.operation, { runtime: this.runtime, cryptoProvider: this.cryptoProvider, sign: options.sign !== false, limits: this.profile.limits, application: this.application, nodeId: this.nodeId });
        const bytes = envelope.byteLength();
        const lease = this.resources.reserve({ category: options.durable || definition?.durable ? 'durable-publish' : 'publish', tenantId: envelope.context?.tenantId, items: 1, bytes, label: envelope.name });
        if (!lease.accepted) {
          this.stats.rejected++; this.metrics.increment('admission_rejected_total', 1, { reason: lease.reason });
          const rejected = EventDeliveryResult.rejected({ eventId: envelope.id, code: lease.code, reason: lease.reason, retryable: lease.retryable });
          if (options.failurePolicy === 'throw' || this.profile.deliveryFailurePolicy === 'throw') throw deliveryError(`Event '${name}' was rejected by the resource governor.`, rejected);
          return rejected;
        }
        try {
          if ((options.durable === true || definition?.durable === true || envelope.delivery.mode === 'at-least-once' || envelope.delivery.mode === 'effectively-once') && !options.fromOutbox && this.outbox) {
            const inserted = await this.outbox.enqueue(envelope.name, [envelope], { version: envelope.version, context: envelope.context, idempotencyKey: envelope.delivery.idempotencyKey, headers: { protocolVersion: envelope.protocolVersion }, meta: { routing: envelope.routing, security: envelope.security, metadata: envelope.metadata } });
            this.stats.durable++; this.metrics.increment('durable_enqueued_total', 1, { event: metricEvent(name) });
            return EventDeliveryResult.accepted({ eventId: envelope.id, transport: 'outbox', state: EventDeliveryState.PERSISTED, persisted: true, value: inserted });
          }
          return await this.middleware.run('beforePublish', { ...prepared, envelope }, async (publishContext) => {
            let result = await this.router.publish(envelope, { ...options, definition, failurePolicy: options.failurePolicy || this.profile.deliveryFailurePolicy });
            if (options.localEcho === true && !envelope.routing.transports?.includes('local')) {
              const local = await this.transports.require('local').publish(envelope, { async: options.localAsync !== false });
              result = new EventDeliveryResult({ ...result, results: [...(result.results || [result]), local] });
            }
            await this.middleware.run('afterPublish', { ...publishContext, result });
            return result;
          });
        } finally { lease.release(); }
      });
    } catch (error) { this.stats.errors++; this.metrics.increment('publish_error_total', 1, { event: metricEvent(name), code: error.code || 'error' }); this.flightRecorder.record('publish:error', { eventName: name, error: safeError(error), correlationId: operation.context?.correlationId || null, force: true }); throw error; }
    finally { const duration = this.runtime.monotonicNow() - started; this.metrics.observe('publish_duration_ms', duration, { event: metricEvent(name) }); this.flightRecorder.record('publish:finished', { eventName: name, durationMs: duration, correlationId: operation.context?.correlationId || null }); }
  }

  broadcast(eventOrOperation, payloadOrOptions, maybeOptions = undefined) { return this.publish(eventOrOperation, payloadOrOptions, { ...maybeOptions, fanout: true }); }

  async enqueue(eventOrOperation, payloadOrOptions, maybeOptions = undefined) {
    const { operation, options } = normalizeOperation(eventOrOperation, payloadOrOptions, maybeOptions);
    if (!this.queue?.add && !this.queue?.enqueue) throw Object.assign(new Error('Event queue is unavailable.'), { code: 'EVENT_QUEUE_UNAVAILABLE' });
    this.stats.enqueued++;
    const add = this.queue.add?.bind(this.queue) || this.queue.enqueue.bind(this.queue);
    return add(options.handler || 'dispatch', { eventName: operation.name, args: [operation.payload], context: operation.context || this.getContext(), operation }, options);
  }

  async record(eventOrOperation, payloadOrOptions, maybeOptions = undefined) {
    const { operation, options } = normalizeOperation(eventOrOperation, payloadOrOptions, maybeOptions);
    if (!this.eventStore?.append) throw Object.assign(new Error('Event store is unavailable.'), { code: 'EVENT_STORE_UNAVAILABLE' });
    const streamId = options.streamId || operation.streamId || operation.delivery?.partitionKey;
    if (!streamId) throw Object.assign(new Error('Event recording requires streamId or partitionBy().'), { code: 'EVENT_STREAM_ID_REQUIRED' });
    this.stats.recorded++;
    return this.eventStore.append(String(streamId), [{ id: operation.id || this.runtime.randomId('evt'), type: operation.name, eventName: operation.name, version: operation.version || 1, payload: operation.payload, context: operation.context || this.getContext(), createdAt: Date.now() }], { expectedVersion: options.expectedVersion, ...options });
  }

  request(eventOrOperation, payloadOrOptions, maybeOptions = undefined) { const { operation, options } = normalizeOperation(eventOrOperation, payloadOrOptions, maybeOptions); return this.requests.request(operation, options); }
  handleRequest(eventName, handler, options = {}) { return this.requests.handle(eventName, handler, options); }

  async inbound(input, context = {}) {
    this.stats.inbound++;
    const admission = await this.gateway.admit(input, { ...context, remote: context.remote !== false });
    if (!admission.accepted) { this.stats.rejected++; this.metrics.increment('inbound_rejected_total', 1, { code: admission.code }); this.flightRecorder.record('inbound:rejected', { code: admission.code, reason: admission.reason, force: true }); return admission; }
    const envelope = admission.envelope;
    return this.middleware.run('inbound', { fabric: this, eventName: envelope.name, envelope, admission, context }, async () => {
      const eventContext = this.createContext({ ...envelope.context, eventId: envelope.id, transport: context.transport?.id || context.transport || null, source: envelope.source });
      const dispatch = () => this.dispatcher.dispatchAsync ? this.dispatcher.dispatchAsync(envelope.name, envelope.content?.payload, envelope) : this.dispatcher.dispatch(envelope.name, envelope.content?.payload, envelope);
      const value = await this.run(eventContext, dispatch);
      this.metrics.increment('inbound_total', 1, { event: metricEvent(envelope.name), transport: context.transport?.id || context.transport || 'unknown' });
      this.flightRecorder.record('inbound:dispatched', { eventName: envelope.name, eventId: envelope.id, correlationId: envelope.context?.correlationId, transport: context.transport?.id || context.transport || null });
      return deepFreeze({ accepted: true, envelope, value, admission });
    });
  }

  setQueue(queue) { this.queue = queue; return this; }
  setOutbox(outbox) { this.outbox = outbox; return this; }
  setEventStore(store) { this.eventStore = store; return this; }
  outboxPublisherTransport() { return this.outboxTransport; }
  health() { return deepFreeze({ ok: this.state !== 'failed' && this.state !== 'closed', ready: this.state === 'started', state: this.state, profile: this.profile.name, runtime: this.runtime.snapshot(), uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0, transports: this.transports.snapshot(), resources: this.resources.snapshot(), gateway: this.gateway.snapshot(), stats: { ...this.stats } }); }
  snapshot() { return deepFreeze({ ...this.health(), definitions: this.definitions.snapshot(), middleware: this.middleware.snapshot(), metrics: this.metrics.snapshot(), flightRecorder: this.flightRecorder.snapshot(), requests: this.requests.snapshot(), router: this.router.snapshot() }); }
  prometheus(prefix) { return this.metrics.prometheus(prefix); }

  async close(options = {}) {
    if (this.state === 'closed') return this.snapshot();
    this.state = 'closing';
    this.requests.close();
    for (const dispose of this.transportReceivers.values()) { try { await dispose?.(); } catch {} }
    this.transportReceivers.clear();
    await this.transports.close(options);
    this.resources.close();
    this.state = 'closed';
    this.flightRecorder.record('fabric:closed', { reason: options.reason || null, force: true });
    return this.snapshot();
  }
  async [Symbol.asyncDispose]() { await this.close(); }
}

function normalizeOperation(eventOrOperation, payloadOrOptions, maybeOptions) {
  if (eventOrOperation && typeof eventOrOperation === 'object' && (eventOrOperation.name || eventOrOperation.eventName)) {
    const operation = { ...eventOrOperation, name: eventOrOperation.name || eventOrOperation.eventName, routing: { ...(eventOrOperation.routing || {}) }, delivery: { ...(eventOrOperation.delivery || {}) }, security: { ...(eventOrOperation.security || {}) }, metadata: { ...(eventOrOperation.metadata || {}) } };
    const options = payloadOrOptions && typeof payloadOrOptions === 'object' && !Array.isArray(payloadOrOptions) ? payloadOrOptions : maybeOptions || {};
    return { operation, options };
  }
  const payloadIsOptions = maybeOptions === undefined && payloadOrOptions && typeof payloadOrOptions === 'object' && !Array.isArray(payloadOrOptions) && ('via' in payloadOrOptions || 'durable' in payloadOrOptions || 'timeoutMs' in payloadOrOptions || 'fanout' in payloadOrOptions);
  return { operation: { name: String(eventOrOperation), payload: payloadIsOptions ? undefined : payloadOrOptions, version: maybeOptions?.version || 1, context: maybeOptions?.context || null, routing: {}, delivery: {}, security: {}, metadata: {} }, options: payloadIsOptions ? payloadOrOptions : maybeOptions || {} };
}
function metricEvent(name) { const value = String(name); return value.length > 96 ? `${value.slice(0, 92)}...` : value; }
export default UniversalEventFabric;
