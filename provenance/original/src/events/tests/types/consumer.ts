import eventsConfig from 'rawnode-events/config';
import {
  AdvancedEventDispatcher,
  Event,
  type EventMap,
  type EventContext,
  ListenerHandle,
  DispatchReport,
} from 'rawnode-events';
import { RedisStreamTransport } from 'rawnode-events/bridge';
import { EventOutbox } from 'rawnode-events/durable';
import { EventJobQueue, JobHandle } from 'rawnode-events/queue';
import DispatcherDefault from 'rawnode-events/dispatcher';
import LegacyDispatcherDefault from 'rawnode-events/legacy';
import EventDefault from 'rawnode-events/Event.js';
import RegistryDefault from 'rawnode-events/EventRegistry.js';
import BridgeDefault from 'rawnode-events/RedisEventBridge.js';
import { WorkflowEngine } from 'rawnode-events/workflows';
import { AggregateRoot, MemoryEventStore, ProjectionManager } from 'rawnode-events/sourcing';
import { FakeEventBus } from 'rawnode-events/testing';

interface AppEvents extends EventMap {
  'user:created': readonly [{ id: string }];
  'billing:paid': readonly [number, string];
}

const bus = new AdvancedEventDispatcher<AppEvents>({ profile: 'production' });
bus.on('user:created', (user) => user.id);
bus.dispatch('billing:paid', 42, 'usd');
const context: EventContext = bus.createContext({ tenantId: 'acme' });
bus.run(context, () => bus.dispatch('user:created', { id: 'u1' }));
bus.registerSubsystem('custom', { snapshot: () => ({ ok: true }) });
const customSubsystem = bus.subsystem<{ snapshot(): { ok: boolean } }>('custom');
customSubsystem?.snapshot().ok;
bus.subsystems().custom?.required;

class Created extends Event<{ id: string }> { static eventName = 'user:created'; }
new Created({ id: 'u1' }).toJSON();
new EventJobQueue().register('work', async (payload: { id: string }) => payload.id);
new WorkflowEngine();
class Account extends AggregateRoot { deposit(): this { return this.record(new Event({ amount: 1 })); } }
const store = new MemoryEventStore();
const projections = new ProjectionManager(store);
void store.commit(new Account('a1').deposit());
void projections;
void RedisStreamTransport;
void EventOutbox;
void FakeEventBus;
void eventsConfig;
eventsConfig.queue?.concurrency;
eventsConfig.sourcing?.projections?.batchSize;


const compatibilityDispatchResult: void = bus.dispatch('typed:event', { id: 1 });
const compatibilityEmitResult: void = bus.emit('typed:event', { id: 2 });
const compatibilityDeferredResult: void = bus.dispatchDeferred('typed:event', { id: 3 });
void compatibilityDispatchResult;
void compatibilityEmitResult;
void compatibilityDeferredResult;


void ListenerHandle;
void DispatchReport;
void JobHandle;
const dispatcherDefault: typeof AdvancedEventDispatcher = DispatcherDefault;
void dispatcherDefault;
new LegacyDispatcherDefault();
new EventDefault();
new RegistryDefault();
void BridgeDefault;
