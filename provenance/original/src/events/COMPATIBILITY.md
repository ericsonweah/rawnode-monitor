# Compatibility Contract

RawNode Events 2.x is additive. The original source bundle is treated as the behavioral baseline.

## Stable public files

The following paths remain available:

- `AdvancedEventDispatcher.js`
- `EventDispatcher.js`
- `Event.js`
- `EventName.js`
- `EventRegistry.js`
- `EventMetrics.js`
- `ProtocolEvent.js`
- `Broadcastable.js`
- `RedisEventBridge.js`
- `index.js`

## Stable behavior

- `EventDispatcher.on()` and `EventDispatcher.dispatch()` still return `undefined`.
- `AdvancedEventDispatcher.on()`, `once()`, `off()`, `onAny()`, and `onPattern()` remain fluent.
- `dispatch()` remains synchronous and returns the dispatcher.
- `dispatchAsync()` remains sequential, awaited, and resolves `undefined`.
- Listener errors remain isolated by default.
- Dispatch order remains exact, nearest hierarchical wildcard to broadest, patterns, then any listeners.
- Higher numeric priority executes first; ties preserve registration order.
- Dot-to-colon normalization remains opt-in.
- Event objects remain the first listener argument.
- Replay remains disabled when its limit is zero.
- `hasListeners()` remains conservative when pattern listeners exist; `willDispatchTo()` provides exact matching.
- Version-1 Redis envelopes remain accepted when configured.

## Correctness repairs

The following changes correct edge cases without changing normal behavior:

- a recursive or concurrently dispatched one-time listener is claimed before invocation;
- replay listener exceptions and rejections are isolated;
- one async rejection produces one canonical listener-error diagnostic;
- bridge startup rolls back partially created resources;
- deduplication TTL is checked on every lookup;
- bridge-origin suppression survives async/deferred work through context metadata;
- forced shutdown is bounded by configuration.

## Compatibility profile

`profile: "compat"` is the default package behavior. Enterprise facilities are opt-in. `profile: "production"` activates safer bounded defaults and stricter configuration validation without enabling remote transports or persistence automatically.

## Deprecation discipline

No current public symbol is scheduled for removal. Future deprecations must:

1. remain callable for at least two major-version boundaries;
2. emit diagnostics only in development unless explicitly enabled;
3. include a tested replacement and migration section;
4. retain import-path shims during the compatibility window.
