# Compatibility contract

| Surface | v1 status | Enterprise behavior |
|---|---|---|
| Root default export | Preserved | Existing default logger |
| `Logger` | Preserved | Delegates to canonical runtime |
| `AdvancedLogger` | Preserved | Still a Transform stream |
| Fourteen level methods | Preserved | Custom levels are additive |
| Fire-and-forget return | Preserved | `undefined` |
| `logAsync` | Additive | Awaitable delivery result |
| Legacy middleware | Preserved in v1 | Structured processors in modern profiles |
| `log` event | Preserved | Compatibility entry |
| `record` event | Additive | Canonical structured record |
| Two-argument transports | Preserved | Adapter calls `(level, formatted)` |
| One-argument transports | Preserved | Object or JSON mode |
| Node writable streams | Additive | Callback and drain aware |
| Config profiles/colors | Preserved | Per-runtime production profiles added |
| Default constructors | v1 | No silent behavior change |
| `createLogger()` | Additive | Production profile by default |

The package includes contract tests for exports, constructors, levels, middleware, events, builders, transports, modes, lifecycle, and configuration reference behavior.
