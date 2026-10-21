# Benchmarking

The official benchmark suite measures RawNode behavior only: disabled-level fast path, accepted structured records, safe serialization, optional file delivery, CPU time, heap delta, throughput, and event-loop delay.

Run:

```bash
npm run bench:core -- --json
npm run bench:core -- --json --file
```

Files named after other logger ecosystems under `benchmarks/` are retained historical formatting simulations. They are not valid end-to-end comparisons and are not used by package scripts or performance claims.
