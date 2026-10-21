# Additional component controls

The exact candidate exposes the following bounded controls in addition to its configuration defaults:

- `MonitorPluginManager`: `callbackTimeoutMs` defaults to 5000 (1–300000); `maxHooks` defaults to 10000 (1–1000000); `maxPendingCallbacks` defaults to 1000 (1–100000). Pending non-cooperative callbacks remain visible in `snapshot()` until settled. `close()` drops queued notifications; explicitly await `flush()` beforehand if delivery is required.
- `LeaderLease`: `timeoutMs` defaults to 5000 (1–300000). A close request prevents late acquisition/renewal from rearming its timer. An injected Redis client may complete a previously submitted operation after the deadline; the server-side TTL remains the final lease-expiry boundary. Live Redis integration was not exercised.
- `SyntheticMonitor`: `maxWaiters` defaults to maxChecks. Non-cooperative operations retain their slot until actual settlement; queued callers receive a bounded queue timeout or close/cancellation error. This bounds launches but cannot terminate user code.
- Health and resource registries reject relaunch while the same underlying callback remains unresolved. Removed or replaced definitions cannot receive late cached results.

These are application-supplied trusted configuration controls. No global agent or service was started.
