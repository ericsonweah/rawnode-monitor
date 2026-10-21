# RawNode Events

RawNode Events is a zero-dependency, compatibility-preserving event platform for modern Node.js. It keeps the existing RawNode event APIs and dispatch order while adding bounded resource management, structured observability, durable delivery, workflow orchestration, event sourcing, enterprise lifecycle ownership, and first-party type declarations.

## Compatibility promise

Existing applications can continue to use:

```js
import {
  AdvancedEventDispatcher,
  EventDispatcher,
  Event,
  ProtocolEvent,
  Broadcastable,
  EventRegistry,
  EventMetrics,
  RedisEventBridge,
} from 'rawnode-events';
```

The compatibility profile preserves:

- exact → hierarchical wildcard → pattern → any listener order;
- dot normalization disabled by default;
- synchronous `dispatch()` and sequential `dispatchAsync()` semantics;
- isolated listener errors by default;
- existing event-object dispatch and replay behavior;
- all legacy file-level import paths;
- Redis version-1 envelope acceptance.

## Highlights

- Atomic `once` listeners under recursion and concurrent async dispatch.
- Exact, hierarchical wildcard, indexed glob-pattern, and global listeners.
- Stable priorities, prepend, owner, tags, pause/resume, scopes, and disposable handles.
- Sequential, parallel, settled, first-result, predicate-stop, wait, and async-iterator dispatch modes.
- AsyncLocalStorage context with correlation, causation, tenant, actor, trace, and transport metadata.
- Bounded replay journal with TTL, item, event-name, payload, and byte ceilings.
- Bounded deferred scheduler with cooperative yielding and explicit overflow policy.
- Redacted diagnostics, cardinality-bounded metrics, Prometheus text, and health snapshots.
- Versioned event contracts, validation, upcasters, and named codecs.
- Hardened Redis Pub/Sub propagation and optional durable Redis Streams delivery.
- Transactional-outbox primitives, idempotent inbox, in-process jobs, scheduler, workflows, and projections.
- First-party testing fakes, recorder, assertions, manual clock, and memory transport.
- Zero runtime dependencies and ESM-first package exports.

## Basic use

```js
import { AdvancedEventDispatcher } from 'rawnode-events';

const events = new AdvancedEventDispatcher({ profile: 'production' });

const subscription = events
  .listen('billing:invoice:paid')
  .priority(100)
  .owner('billing-provider')
  .tag('audit')
  .subscribe(async (invoice) => {
    await recordPaymentAudit(invoice);
  });

await events.dispatchAsync('billing:invoice:paid', { id: 'inv-1', total: 4999 });
subscription.dispose();
await events.close();
```

## Request and transport context

```js
const context = events.createContext({
  transport: 'http',
  correlationId: requestId,
  tenantId: tenant.id,
  actorId: user.id,
  traceId,
});

await events.run(context, () =>
  events.dispatchAsync('order:submitted', order)
);
```

Child contexts preserve the root correlation and use the immediate parent as causation.

## Bounded replay

```js
const events = new AdvancedEventDispatcher({
  profile: 'production',
  history: {
    maxEntriesPerEvent: 100,
    maxEventNames: 500,
    maxEntriesTotal: 10_000,
    maxBytes: 16 * 1024 * 1024,
    maxPayloadBytes: 128 * 1024,
    ttlMs: 15 * 60 * 1000,
    allow: ['domain:**'],
    deny: ['domain:secret:**'],
  },
});

const handle = events.subscribe('domain:customer:updated', listener, { replay: 20 });
```

## Durable delivery

Local dispatch and durable publication are deliberately separate guarantees:

```js
const outbox = app.resolve('events.outbox');
events.setOutbox(outbox);

await events.dispatchDurable(
  'billing:payment:captured',
  payment,
  events.durableOptions({
    idempotencyKey: payment.operationId,
    dispatchLocal: true,
  }),
);
```

Use Redis Pub/Sub for ephemeral fan-out. Use Redis Streams or an application outbox for events that must survive process loss.

## Jobs, scheduler, workflows, and event sourcing

```js
const queue = app.resolve('events.queue');
queue.register('send-receipt', async ({ paymentId }, job) => {
  job.signal.throwIfAborted?.();
  await sendReceipt(paymentId);
});
await queue.enqueue('send-receipt', { paymentId: 'pay-1' });

const scheduler = app.resolve('events.scheduler');
scheduler.cron('*/5 * * * *', () => events.dispatchAsync('system:heartbeat'));

const workflows = app.resolve('events.workflows');
workflows.define('checkout', [reserveInventory, chargePayment, createShipment]);
await workflows.start('checkout', checkoutInput);
```

The in-memory event store supports optimistic concurrency, snapshots, global positions, subscriptions, and checkpointed projections. Replace it with a RawMongo-backed store through the same contract when persistence is required.

## Framework provider

`EventServiceProvider` registers the bus, schemas, codecs, bridge, broadcasting, durable outbox, queue, scheduler, workflows, event store, projections, and console commands. Enterprise subsystems are lazy and opt-in, so disabled features create no startup work.

```js
export default {
  profile: 'production',
  dynamicRegistration: false,
  bus: {
    lifecycle: { shutdownTimeoutMs: 30_000, forceOnTimeout: true },
  },
  queue: { enabled: true, concurrency: 8 },
  scheduler: { enabled: true },
  workflows: { enabled: true },
  sourcing: { enabled: true },
};
```

## CLI

```text
rawnode-events doctor --profile production --json
rawnode-events config --profile production --json
rawnode-events bench --iterations 250000 --patterns 100 --json
rawnode-events envelope:check '<json>' --secret "$EVENTS_REDIS_SECRET"
```

Framework-integrated commands include `events:list`, `events:inspect`, `events:doctor`, `events:stats`, `events:history`, `events:replay`, `events:bridge:status`, `events:bridge:test`, and `events:bench`.

## Validation

```text
npm run check
npm test
npm run check:types
npm run test:consumer
npm run bench
```

See [ARCHITECTURE.md](./ARCHITECTURE.md), [COMPATIBILITY.md](./COMPATIBILITY.md), [UPGRADE.md](./UPGRADE.md), [SECURITY.md](./SECURITY.md), and [docs/operations.md](./docs/operations.md).
