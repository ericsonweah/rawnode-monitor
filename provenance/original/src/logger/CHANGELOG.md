# Changelog

## 1.1.0 — Enterprise runtime

### Added

- Canonical uncolored structured `LogRecord` schema with process, worker, service, environment, request, trace, span, tenant, and user correlation.
- Production, strict, test, and serverless compatibility profiles while retaining the v1 default on existing constructors.
- Ordered item-and-byte bounded pipeline and per-transport queues with cooperative draining, severity-aware shedding, bounded emergency overcommit, and direct fallback for non-droppable records.
- Capability-aware transport adapters for legacy two-argument transports, one-argument compatibility transports, Node writable streams, structured transports, promises, batching, filtering, retries, circuit breakers, ownership, flush, reopen, and close.
- Safe serializer, structured error normalization, redaction, control-character hardening, ANSI/bidi handling, and record limits.
- AsyncLocalStorage context, child loggers, request/job helpers, channels, stacks, timers, measurement, sampling, once-only, and rate-limiting policies.
- Fully asynchronous rotating file transport with retention, compression, external rotation detection, symlink policy, and durability modes.
- Tamper-evident HMAC audit transport and verification.
- Redis Streams, TCP/TLS, UDP, HTTP batch, memory, stream, callback, null, inspector, console, and file transports.
- Logger configuration compiler, service provider, stable swappable bootstrap logger, HTTP and event integrations, and explicit process-error handling.
- Metrics, health, Prometheus text output, diagnostics, production CLI, truthful RawNode benchmarks, first-party test harness, declarations, package exports, and validation tools.

### Fixed

- Unified incompatible legacy transport write signatures without changing callers.
- Prevented asynchronous middleware/processor reordering.
- Prevented circular objects and `BigInt` from breaking logging.
- Removed synchronous filesystem operations from the enterprise file hot path.
- Added explicit timer, stream, socket, listener, and transport ownership lifecycles.
- Fixed the internal metrics registry shadowing the public `metrics()` log-level method.
- Bounded long-lived once-only, rate-limit, inspector, delivery, and transport state.
- Kept active retry and timeout timers referenced while an explicit async delivery operation is pending.
