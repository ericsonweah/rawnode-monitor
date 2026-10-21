# Transports

Each transport is isolated behind `TransportAdapter`, which supplies byte/item bounds, batching, filters, retries, write deadlines, circuit breaking, emergency fallback, ownership, and lifecycle normalization.

Per-transport options include `level`, `channels`, `excludeChannels`, `filter`, `maxItems`, `maxBytes`, `overflow`, `batchSize`, `batchIntervalMs`, `maxRetries`, `retryDelayMs`, `writeTimeoutMs`, `failureThreshold`, `circuitOpenMs`, and `owned`.

Critical/non-droppable records that cannot enter a saturated queue are sent to the configured emergency writer or directly to stderr. They are never silently discarded.
