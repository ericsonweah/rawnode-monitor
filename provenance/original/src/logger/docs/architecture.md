# Architecture

```text
call site
  -> compatibility facade / LoggerRuntime
  -> level gate
  -> context snapshot
  -> canonical RecordFactory
  -> trusted processors/plugins
  -> redaction and sanitization
  -> untrusted processors/plugins
  -> final redaction
  -> transport-independent formatting metadata
  -> ordered bounded pipeline
  -> TransportDispatcher
       -> one bounded TransportAdapter per destination
       -> retry / circuit / timeout / backpressure
       -> transport formatter and I/O
  -> metrics, health, diagnostics, observer events
```

The canonical record never needs ANSI styling. Console presentation is isolated from file/network/audit representation. Child loggers share the dispatcher, pipeline, serializer, metrics registry, level registry, record factory, context manager, and overload state while carrying immutable context and tags.

The compatibility facade remains a Transform stream. It generates a legacy view only for v1 transports and events, while enterprise transports receive structured records.
