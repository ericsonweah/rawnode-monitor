# Production deployment

Run `rawnode-logger doctor --json` in deployment checks. Treat any failed check as a release blocker.

For containers, use structured stdout/stderr and let the platform rotate and collect logs. For direct file logging, configure retention, compression, symlink policy, durability, and a cluster ownership strategy.

Always call `await logger.close()` during application teardown. Use `flush({ throwOnError: true })` before handing off delivery-sensitive work.

Process-wide error handlers are opt-in. A library import never captures process exceptions or signals.
