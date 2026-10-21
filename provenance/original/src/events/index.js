'use strict';

import { AdvancedEventDispatcher } from './AdvancedEventDispatcher.js';
import { EventDispatcher } from './EventDispatcher.js';
import { Event } from './Event.js';
import { ProtocolEvent } from './ProtocolEvent.js';
import { Broadcastable } from './Broadcastable.js';
import { EventRegistry } from './EventRegistry.js';
import { EventMetrics } from './EventMetrics.js';
import { RedisEventBridge } from './RedisEventBridge.js';
import { BroadcastManager } from './broadcasting/BroadcastManager.js';
import { RedisStreamTransport } from './bridge/RedisStreamTransport.js';
import { ListenerHandle } from './core/ListenerHandle.js';
import { ListenerScope } from './core/ListenerScope.js';
import { ListenerBuilder } from './core/ListenerBuilder.js';
import { SubscriptionBuilder } from './core/SubscriptionBuilder.js';
import { DispatchReport } from './core/DispatchReport.js';
import { EventConfiguration } from './config/EventConfiguration.js';
import { EventJournal } from './history/EventJournal.js';
import { DeferredEventScheduler } from './scheduling/DeferredEventScheduler.js';
import { EventMetricsStore } from './observability/EventMetricsStore.js';
import { EventHealth } from './observability/EventHealth.js';
import { EventDiagnostics } from './observability/EventDiagnostics.js';
import { EventRedactor } from './observability/EventRedactor.js';
import { EventSecurityPolicy } from './security/EventSecurityPolicy.js';
import { SafeJsonCodec } from './serialization/SafeJsonCodec.js';
import { EventCodecRegistry } from './serialization/EventCodecRegistry.js';
import { EventSchemaRegistry } from './contracts/EventSchemaRegistry.js';
import { EventOutbox } from './durable/EventOutbox.js';
import { MemoryOutboxStore } from './durable/MemoryOutboxStore.js';
import { OutboxPublisher } from './durable/OutboxPublisher.js';
import { MemoryEventInbox } from './durable/MemoryEventInbox.js';
import { EventJobQueue } from './queue/EventJobQueue.js';
import { EventScheduler } from './queue/EventScheduler.js';
import { WorkflowEngine } from './workflows/WorkflowEngine.js';
import { MemoryWorkflowStore } from './workflows/MemoryWorkflowStore.js';
import { AggregateRoot } from './sourcing/AggregateRoot.js';
import { MemoryEventStore } from './sourcing/MemoryEventStore.js';
import { ProjectionManager, MemoryProjectionCheckpointStore } from './sourcing/ProjectionManager.js';
import { EventServiceProvider } from './integrations/EventServiceProvider.js';
import { FakeEventBus } from './testing/FakeEventBus.js';
import { EventRecorder } from './testing/EventRecorder.js';
import { ManualClock } from './testing/ManualClock.js';
import { MemoryEventTransport } from './testing/MemoryEventTransport.js';
import { EventAssertions } from './testing/EventAssertions.js';
import { UniversalEventFabric } from './universal/UniversalEventFabric.js';
import { NodeEventFabric } from './node/NodeEventFabric.js';
import { BrowserEventFabric } from './browser/BrowserEventFabric.js';
import { BrowserEventDispatcher } from './browser/BrowserEventDispatcher.js';
import { EventDefinition } from './universal/definitions/EventDefinition.js';
import { EventDefinitionRegistry } from './universal/definitions/EventDefinitionRegistry.js';
import { EventTransport } from './universal/transport/EventTransport.js';
import { EventTransportRouter } from './universal/transport/EventTransportRouter.js';
import { EventResourceGovernor } from './universal/resources/EventResourceGovernor.js';
import { EventMiddlewarePipeline } from './universal/middleware/EventMiddlewarePipeline.js';
import { UniversalEventEnvelope } from './universal/envelope/UniversalEventEnvelope.js';
import { EventFlightRecorder } from './universal/observability/EventFlightRecorder.js';
import { RawMongoOutboxStore } from './persistence/rawmongo/RawMongoOutboxStore.js';
import { RawMongoEventInbox } from './persistence/rawmongo/RawMongoEventInbox.js';
import { RawMongoJobStore } from './persistence/rawmongo/RawMongoJobStore.js';
import { RawMongoWorkflowStore } from './persistence/rawmongo/RawMongoWorkflowStore.js';
import { RawMongoEventStore } from './persistence/rawmongo/RawMongoEventStore.js';
import { RawMongoProjectionCheckpointStore } from './persistence/rawmongo/RawMongoProjectionCheckpointStore.js';
import { DurableEventWorker } from './persistence/rawmongo/DurableEventWorker.js';
import { EventStudioManager } from './studio/EventStudioManager.js';
import { EventStudioServer } from './studio/EventStudioServer.js';
import { EventStudioAnalyzer } from './studio/analysis/EventStudioAnalyzer.js';

export {
  AdvancedEventDispatcher,
  EventDispatcher,
  Event,
  ProtocolEvent,
  Broadcastable,
  EventRegistry,
  EventMetrics,
  RedisEventBridge,
  BroadcastManager,
  RedisStreamTransport,
  ListenerHandle,
  ListenerScope,
  ListenerBuilder,
  SubscriptionBuilder,
  DispatchReport,
  EventConfiguration,
  EventJournal,
  DeferredEventScheduler,
  EventMetricsStore,
  EventHealth,
  EventDiagnostics,
  EventRedactor,
  EventSecurityPolicy,
  SafeJsonCodec,
  EventCodecRegistry,
  EventSchemaRegistry,
  EventOutbox,
  MemoryOutboxStore,
  OutboxPublisher,
  MemoryEventInbox,
  EventJobQueue,
  EventScheduler,
  WorkflowEngine,
  MemoryWorkflowStore,
  AggregateRoot,
  MemoryEventStore,
  ProjectionManager,
  MemoryProjectionCheckpointStore,
  EventServiceProvider,
  FakeEventBus,
  EventRecorder,
  ManualClock,
  MemoryEventTransport,
  EventAssertions,
  UniversalEventFabric,
  NodeEventFabric,
  BrowserEventFabric,
  BrowserEventDispatcher,
  EventDefinition,
  EventDefinitionRegistry,
  EventTransport,
  EventTransportRouter,
  EventResourceGovernor,
  EventMiddlewarePipeline,
  UniversalEventEnvelope,
  EventFlightRecorder,
  RawMongoOutboxStore,
  RawMongoEventInbox,
  RawMongoJobStore,
  RawMongoWorkflowStore,
  RawMongoEventStore,
  RawMongoProjectionCheckpointStore,
  DurableEventWorker,
  EventStudioManager,
  EventStudioServer,
  EventStudioAnalyzer,
};

export * from './EventName.js';
export * from './errors/EventError.js';
export * from './serialization/EventEnvelope.js';
export * from './context/EventContext.js';
export * from './observability/PrometheusFormatter.js';
export * from './console/EventCommands.js';
export * from './testing/EventAssertions.js';
export * from './core/index.js';
export * from './context/index.js';
export * from './history/index.js';
export * from './scheduling/index.js';
export * from './observability/index.js';
export * from './serialization/index.js';
export * from './bridge/index.js';
export * from './broadcasting/index.js';
export * from './contracts/index.js';
export * from './durable/index.js';
export * from './queue/index.js';
export * from './workflows/index.js';
export * from './sourcing/index.js';
export * from './security/index.js';
export * from './testing/index.js';
export * from './integrations/index.js';
export * from './compatibility/index.js';
export * from './universal/index.js';
export * from './node/index.js';
export * from './browser/index.js';
export * from './persistence/index.js';
export * from './studio/index.js';

const Events = Object.freeze({
  AdvancedEventDispatcher,
  EventDispatcher,
  Event,
  ProtocolEvent,
  Broadcastable,
  EventRegistry,
  EventMetrics,
  RedisEventBridge,
  BroadcastManager,
  RedisStreamTransport,
  ListenerHandle,
  ListenerScope,
  ListenerBuilder,
  SubscriptionBuilder,
  DispatchReport,
  EventConfiguration,
  EventJournal,
  DeferredEventScheduler,
  EventMetricsStore,
  EventHealth,
  EventDiagnostics,
  EventRedactor,
  EventSecurityPolicy,
  SafeJsonCodec,
  EventCodecRegistry,
  EventSchemaRegistry,
  EventOutbox,
  MemoryOutboxStore,
  OutboxPublisher,
  MemoryEventInbox,
  EventJobQueue,
  EventScheduler,
  WorkflowEngine,
  MemoryWorkflowStore,
  AggregateRoot,
  MemoryEventStore,
  ProjectionManager,
  MemoryProjectionCheckpointStore,
  EventServiceProvider,
  FakeEventBus,
  EventRecorder,
  ManualClock,
  MemoryEventTransport,
  EventAssertions,
  UniversalEventFabric,
  NodeEventFabric,
  BrowserEventFabric,
  BrowserEventDispatcher,
  EventDefinition,
  EventDefinitionRegistry,
  EventTransport,
  EventTransportRouter,
  EventResourceGovernor,
  EventMiddlewarePipeline,
  UniversalEventEnvelope,
  EventFlightRecorder,
  RawMongoOutboxStore,
  RawMongoEventInbox,
  RawMongoJobStore,
  RawMongoWorkflowStore,
  RawMongoEventStore,
  RawMongoProjectionCheckpointStore,
  DurableEventWorker,
  EventStudioManager,
  EventStudioServer,
  EventStudioAnalyzer,
});

export default Events;
