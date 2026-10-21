# Delivery Semantics

## Local dispatch

Local dispatch is not a persistence mechanism. Synchronous and asynchronous listeners run inside the current process and can be lost if the process terminates before completion.

## Deferred dispatch

Deferred admission is bounded and observable. It provides process-local decoupling, not crash durability.

## Redis Pub/Sub

Pub/Sub is fast, ephemeral fan-out. Messages published while a node is disconnected are not replayed.

## Redis Streams

Streams provide durable entries, consumer groups, acknowledgments, pending-entry recovery, retry accounting, and dead-letter routing. Application handlers must still be idempotent.

## Transactional outbox

A transactional outbox is the recommended boundary when domain state and an integration event must commit together. Write both in one database transaction, then let the publisher claim and deliver outbox rows.

## Event sourcing

An event store is the source of truth for selected aggregates. It is not automatically the same as the application event bus. Rehydration and projections consume committed records, and optimistic concurrency protects stream versions.
