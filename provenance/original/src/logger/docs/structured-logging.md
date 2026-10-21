# Structured logging

Every accepted event becomes a canonical record containing schema version, unique ID, monotonic sequence, wall and monotonic time, textual and numeric level information, uncolored message, normalized data, immutable context, structured error, channel, service, environment, host, process/worker identity, and correlation fields.

Presentation fields are derived after security processing. Console colors never leak into JSON, audit, Redis, TCP, UDP, or HTTP records.

Use lazy values for expensive debug data:

```js
logger.debug(() => `Plan for ${queryId}`, () => buildLargePlan());
```

Lazy values are not evaluated when the level is disabled.
