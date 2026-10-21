# Enterprise implementation guide

## Runtime flow

```text
caller
  -> level fast-path
  -> AsyncLocalStorage context
  -> canonical LogRecord
  -> trusted enrichment processors
  -> redaction and sanitization
  -> post-redaction processors/plugins
  -> bounded ordered pipeline
  -> isolated bounded transport adapters
  -> formatter selected by each transport
  -> destination I/O
  -> metrics, diagnostics, health, flush acknowledgement
```

Canonical records never contain terminal styling. Console presentation is applied only by the console transport, while files and network transports receive structured data.

## Operational rules

1. Use `logAsync` for audit, payment, access-control, and other delivery-sensitive records.
2. Keep secrets out of messages; redaction is a final safety boundary, not a substitute for data minimization.
3. Prefer stdout/stderr in containers. Use per-worker files or a single-writer aggregation strategy in clustered deployments.
4. Configure both item and byte limits for every queue.
5. Call `close()` from the RawNode application teardown lifecycle.
6. Use explicit transport ownership when injecting externally managed streams, Redis clients, or sockets.
7. Treat `health().status === 'degraded'` and nonzero dropped counters as operational alerts.

## Cluster patterns

- Container/process-manager: structured console channel.
- Per-worker files: include worker identity in file names.
- Single writer: TCP/TLS, Redis Streams, or HTTP batch from workers to an aggregator.
- Audit: dedicated audit file or durable central transport, never an unacknowledged UDP path.

## Extension contracts

A modern transport should expose `writeRecord(record)` and may add `writeBatch`, `flush`, `reopen`, `close`, and `health`. Legacy signatures remain supported through `TransportAdapter`.

A processor returns a record to continue, a replacement record to transform, or `null` to drop. Plugins receive lifecycle hooks and are isolated according to profile policy.
