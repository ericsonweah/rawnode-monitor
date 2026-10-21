# Configuration Reference

The package configuration is additive. Disabled enterprise sections allocate no runtime resources.

## Profiles

- `compat`: preserves legacy defaults and disabled optional facilities.
- `production`: validates bounded resources and safer logging/history behavior.
- `enterprise`: production bounds with enterprise-oriented defaults.
- `strict`: strongest validation and admission behavior.

## Bus

`bus.listeners` controls exact, pattern, any, total, and plan-cache bounds. `bus.history` controls replay. `bus.deferred` controls accepted deferred work. `bus.metrics` controls series cardinality. `bus.security` controls name, pattern, payload, and context limits. `bus.lifecycle` controls graceful shutdown deadline.

## Contracts and codecs

Top-level `contracts` bounds schema names and versions. Top-level `codecs` bounds registered codecs. `bus.contracts.autoValidate` enables event-object validation during dispatch.

## Bridge

`bridge.redis` controls ephemeral cluster propagation. Configure allow/deny namespaces, packet/argument limits, queue bounds, protocol versions, signing secret, TTL, and hop count.

## Durable

`durable` configures the outbox store and publisher. A transport must be bound at `events.durable.transport`. This can be a Redis Streams adapter or application-specific transport.

## Enterprise subsystems

- `queue.enabled`
- `scheduler.enabled`
- `workflows.enabled`
- `sourcing.enabled`

These bindings are always registered lazily by the provider but instantiated and supervised only when enabled or explicitly resolved.
