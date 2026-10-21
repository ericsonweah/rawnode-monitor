# Observability

`health()` reports lifecycle, pending work, queue state, transport circuits, and recent diagnostics. `stats()` includes counters, gauges, histograms, processor/plugin snapshots, and transport statistics. `toPrometheus()` emits dependency-free Prometheus text.

Important counters include accepted, enqueued, rejected, dropped, sampled, rate-limited, processor-dropped, emergency-fallback, transport-delivered, transport-error, and transport-retry totals.
