# Upgrade guide

## Compatibility policy

Version 1.1 is additive. Existing root imports, constructors, level names, default logger instances, middleware behavior, event names, output modes, and legacy transport contracts remain available.

- `new Logger()` and `new AdvancedLogger()` default to profile `v1`.
- `createLogger()` defaults to profile `production`.
- Existing `logger.info(message, data)` calls remain fire-and-forget.
- Existing two-argument `transport.write(level, formatted)` implementations continue to work.
- Existing one-argument transports continue to receive the selected object or JSON compatibility payload.
- Existing `log` events retain the compatibility-shaped payload; canonical records are also emitted as `record`.

## Opting into production behavior

```js
import { createLogger } from 'rawnode-logger';

const logger = createLogger({
  profile: 'production',
  level: 'info',
  transports: [...],
});
```

Production mode changes internal behavior, not the public calling convention. Structured records are uncolored, secrets are redacted, queues are bounded, unknown levels fail fast, and lifecycle errors are observable.

## Delivery acknowledgement

Historical level methods return `undefined`. Code that must know whether a record reached its configured transports should use:

```js
await logger.logAsync('error', 'Operation failed', data, {
  awaitDelivery: true,
  throwOnError: true,
});
```

## File transport migration

Legacy `FileTransport` remains exported. New deployments should use `EnterpriseFileTransport` or a file channel. The enterprise transport performs metadata, rotation, retention, and compression asynchronously and exposes `flush`, `reopen`, `rotate`, `health`, and `close`.

## Metrics name

The public `logger.metrics(message, data)` level method is preserved. The internal registry is available as `logger.runtime.metricsRegistry`; portable application code should prefer `metricsSnapshot()` and `toPrometheus()`.

## Process handlers

No global signal, exception, rejection, or warning handlers are installed by import. Enable them explicitly through `ProcessErrorHandler` or `LoggerServiceProvider` configuration.
