# Upgrade Guide

## Drop-in adoption

Copy the upgraded `src/events` directory over the existing module. Existing imports and default behavior remain valid. Replace the module `index.js` so the full public surface is exported.

For framework integration, use:

```js
import { EventServiceProvider } from '#events';
```

The compatibility provider path remains available at `src/foundation/providers/EventServiceProvider.js`.

## Recommended staged rollout

### Stage 1: compatibility

```js
export default {
  profile: 'compat',
  bus: {
    metrics: { enabled: true },
    diagnostics: { enabled: false },
  },
};
```

Run existing application tests and the included contract suite. No enterprise subsystem is enabled automatically.

### Stage 2: production bounds

Set `profile: "production"` and explicit listener, deferred, history, diagnostics, and payload ceilings. Keep replay disabled for sensitive or high-volume namespaces.

### Stage 3: ownership

Move provider/plugin registrations into listener scopes or add `owner` metadata. Use `removeByOwner()` or scope disposal during teardown.

### Stage 4: cluster propagation

Enable Redis Pub/Sub only for explicitly allowed namespaces. Configure a shared signing secret when cluster traffic crosses a trusted-process boundary. Keep transport lifecycle events denied unless a specific use case requires them.

### Stage 5: durability

Use an outbox or Redis Streams for critical integration events. Do not reinterpret Pub/Sub as guaranteed delivery. Add idempotency keys and an inbox at consumers.

### Stage 6: event sourcing

Enable the event store only for aggregates that need append-only history. Use optimistic concurrency and projections. Persist production streams in RawMongo through an adapter implementing the same store contract.

## Priority migration

`AdvancedEventDispatcher` uses higher-number-first priority. `EventRegistry` now follows the same convention by default while retaining an ascending compatibility option for legacy users.

## Replay migration

Reference-mode replay matches the legacy behavior. Production applications should prefer shallow or serialized history, explicit allowlists, redaction, byte ceilings, and TTL.

## Shutdown integration

Call `await events.close()` during application teardown. The provider handles this automatically. Production defaults enforce a shutdown deadline and force cancellation when configured.
