# RawNode Events Architecture

## Design principles

1. Preserve the successful public contract before changing internals.
2. Keep the no-listener and exact-listener hot paths small.
3. Bound every queue, history, cache, metric series, packet, and persistence surface.
4. Separate local dispatch, deferred execution, real-time broadcast, ephemeral cluster propagation, and durable delivery.
5. Make ownership and shutdown explicit.
6. Keep all implementation code zero-dependency and based on Node.js primitives.

## Runtime flow

```text
Producer
  │
  ├─ string event
  └─ Event object
       │
       ▼
AdvancedEventDispatcher façade
       │
       ├─ normalize and secure event name
       ├─ resolve/propagate EventContext
       ├─ validate optional event contract
       ├─ append optional bounded journal entry
       └─ retrieve generation-cached dispatch plan
               │
               ▼
Listener execution
  exact → hierarchical wildcard → indexed pattern → any
               │
               ├─ sync / sequential / parallel / report / wait / iterator
               ├─ metrics + diagnostics + health
               ├─ optional BroadcastManager
               ├─ optional deferred scheduler
               └─ optional durable outbox
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
       Redis Pub/Sub  Redis Streams  Application outbox
       ephemeral      durable        transaction-linked
```

## Directory layout

```text
src/events/
├── AdvancedEventDispatcher.js
├── EventDispatcher.js
├── Event.js
├── EventName.js
├── EventRegistry.js
├── EventMetrics.js
├── ProtocolEvent.js
├── Broadcastable.js
├── RedisEventBridge.js
├── index.js
├── core/
├── context/
├── history/
├── scheduling/
├── observability/
├── security/
├── serialization/
├── contracts/
├── bridge/
├── broadcasting/
├── durable/
├── durability/              # compatibility alias
├── queue/
├── workflows/
├── sourcing/
├── testing/
├── console/
├── integrations/
├── config/
├── foundation/
├── errors/
└── support/
```

Root files are stable public façades. Focused folders contain replaceable internal services and enterprise extensions.

## Listener registry and dispatch plans

Listener registration is represented by immutable metadata entries. The registry maintains exact, wildcard, pattern, any, owner, and tag indexes. A monotonically increasing generation invalidates cached dispatch plans when registration changes.

Patterns are bucketed by static prefix rather than scanning every registered glob. The result preserves stable priority and registration order.

Atomic one-time listeners are claimed before invocation. This guarantees exactly-once in-process execution even under recursive dispatch and concurrent `dispatchAsync()` calls.

## Context model

`EventContextManager` owns one `AsyncLocalStorage` instance. Context includes:

- `id`, `parentId`, `correlationId`, and `causationId`;
- `tenantId` and `actorId`;
- `traceId` and `spanId`;
- transport and remote-origin metadata;
- bounded headers and custom metadata.

Transport boundaries create a context only when one is missing. Child dispatches preserve correlation and use the current context ID as immediate causation.

## Resource boundaries

Production profiles validate non-zero ceilings for:

- total listeners and patterns;
- dispatch payload/context sizes;
- replay event names, entries, payloads, TTL, and bytes;
- deferred queue items, bytes, and concurrency;
- diagnostics history and metric series;
- bridge packet size, args, queue, deduplication, retries, and circuit state;
- outbox, workflow, job queue, and event-store memory.

Compatibility mode keeps legacy-disabled features disabled unless configured.

## Delivery guarantees

| Facility | Guarantee | Primary use |
|---|---|---|
| `dispatch()` | in-process synchronous invocation | hot-path domain signals |
| `dispatchAsync()` | in-process sequential awaited invocation | ordered side effects |
| deferred scheduler | accepted in-process work until shutdown/process loss | non-critical decoupling |
| BroadcastManager | adapter-defined real-time fan-out | WebSocket/TCP/Live updates |
| Redis Pub/Sub bridge | ephemeral cluster fan-out | cache invalidation, live signals |
| Redis Streams transport | durable stream entry with consumer groups | retryable integration events |
| EventOutbox | persisted/admitted intent before publication | database-linked workflows |

## Lifecycle

The dispatcher supports admission stop, drain, flush, and close. Production shutdown has a deadline and force-on-timeout path. Registered enterprise subsystems participate in health and shutdown through `registerSubsystem()`.

Provider-owned listeners are registered in a scope and disposed atomically. Bridge startup is transactional; partial resources are rolled back before a retry.
