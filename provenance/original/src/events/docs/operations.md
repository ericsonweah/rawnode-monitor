# Production Operations

## Readiness

Use `events.health()` for dispatcher, deferred queue, history, required bridge, and registered required-subsystem status. Use `events.snapshot()` for a complete operational view.

## Metrics

`events.prometheus()` emits dependency-free Prometheus text. Event-name cardinality is bounded. High-cardinality names collapse into an overflow series rather than growing without limit.

## Diagnostics

Diagnostics are isolated from the application listener bus. Subscribe with `onDiagnostic()` or through the `rawnode.events.diagnostics` diagnostics channel. Payloads are redacted and retained only when bounded history is enabled.

## Shutdown

1. Stop new admission.
2. Drain deferred work.
3. Flush accepted async listeners.
4. Stop enterprise subsystems.
5. Stop outbox publisher and remote transports.
6. Close context storage and remove owned listeners.

A production deadline prevents indefinite shutdown. Forced close aborts cancellable jobs and reports the forced state in the snapshot.

## Capacity signals

Alert on:

- deferred item or byte saturation;
- history item or byte saturation;
- required bridge not ready;
- queue rejections/drops/timeouts;
- outbox dead letters or repeated transport failure;
- metric-series overflow;
- sustained slow-dispatch diagnostics;
- forced shutdowns.

## Incident inspection

Use:

```text
events:doctor
events:stats
events:inspect <event>
events:list
events:bridge:status
```

Do not enable raw payload logging during an incident unless data classification permits it.
