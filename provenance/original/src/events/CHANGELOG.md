# Changelog

## 2.0.0

### Added

- Bounded listener registry, pattern index, dispatch-plan cache, handles, scopes, and fluent builders.
- Sequential, settled, parallel, report, first-result, stop-predicate, wait, and iterator dispatch APIs.
- Rich AsyncLocalStorage context and transport-origin propagation.
- Bounded replay journal and deferred scheduler.
- Metrics, health, redacted diagnostics, Prometheus text, and subsystem supervision.
- Event contracts, versions, validation, upcasters, and codec registry.
- Hardened Redis Pub/Sub bridge and durable Redis Streams transport.
- Outbox, inbox, in-process job queue, scheduler, workflows, event store, snapshots, and projections.
- Broadcast manager and built-in testing utilities.
- Provider bindings, CLI commands, package exports, declarations, contract tests, and clean-consumer validation.

### Fixed

- Recursive and concurrent one-time listener duplication.
- Replay exception/rejection escape paths.
- Duplicate diagnostics for async listener rejection.
- Bridge partial-start state, stale deduplication IDs, invalid serialization fallback, and async echo loops.
- Unbounded replay/deferred/cardinality behavior under high event-name diversity.
- Ambiguous priority behavior between the dispatcher and registry.
- Unbounded shutdown when accepted work never settles.

### Preserved

- Existing file paths and public classes.
- Legacy `EventDispatcher` semantics.
- Dispatcher listener order and fluent return values.
- Dot normalization default.
- Version-1 Redis envelope acceptance.
