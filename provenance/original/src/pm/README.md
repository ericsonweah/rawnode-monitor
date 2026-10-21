# RawNode PM

RawNode PM is a zero-runtime-dependency process supervisor, RawNode-aware runtime agent, local control plane, observability system, development watcher, and host startup generator.

It is designed around one rule: **the supervisor must remain responsive even when an application process is crashed, blocked, unhealthy, draining, or producing logs faster than an operator can consume them.**

## Status

Version `0.1.0` is a host-grade first release. It includes the complete local supervisor and runtime-control foundation required before a distributed multi-host control plane is added.

Implemented now:

- Detached supervisor daemon with single-owner locking
- Fork, native Node cluster, and external-process drivers
- Versioned supervisor/worker IPC protocol
- Online, readiness, health, heartbeat, drain, shutdown, diagnostics, and metrics messages
- Readiness-gated rolling cluster reloads
- Graceful draining with bounded forced termination
- Exponential restart backoff, jitter, restart windows, and quarantine
- Desired-state save and resurrection
- AES-GCM encrypted state persistence
- Private authenticated local control socket
- Optional authenticated HTTP management API and realtime SSE
- Bounded log capture, log rotation, stream backpressure, and live tailing
- Process, memory, CPU, event-loop, resource, and RawNode framework metrics
- Prometheus-compatible text output
- Native file watching with polling and reconciliation fallback
- Redacted incident bundles and Node diagnostic reports
- Terminal status, logs, and realtime monitor commands
- systemd and launchd startup-definition generation
- RawNode ServiceProvider, runtime adapter, CLI commands, and exact-anchor integrator
- First-party TypeScript declarations

Not yet represented as complete: distributed scheduling, multi-host deployment orchestration, remote RBAC, canary releases, and quorum/leader election. Those build on this host runtime and are tracked in the roadmap.

## Requirements

- Node.js 20 or newer
- No runtime npm dependencies
- ESM application code for the RawNode runtime integration

## Quick start

From the `rawnode-pm` package directory:

```bash
node ./bin/rawnode-pm.js integrate --root /path/to/rawnode --dry-run
node ./bin/rawnode-pm.js integrate --root /path/to/rawnode
cd /path/to/rawnode
node /path/to/rawnode-pm/bin/rawnode-pm.js start rawnode.process.mjs
node /path/to/rawnode-pm/bin/rawnode-pm.js status
node /path/to/rawnode-pm/bin/rawnode-pm.js monitor
```

When installed as a first-party workspace package, use `rawnode-pm` or `rnpm` directly.

The integrator is transactional: it validates every source anchor before writing, creates timestamped backups, uses atomic writes, and rolls back on failure.

## Process manifest

The included `config/rawnode.process.example.mjs` demonstrates a cluster application with IPC readiness, health policies, rolling reload, crash-loop protection, log limits, and development watching.

```js
export default {
  apps: [
    {
      name: 'rawnode-api',
      script: './raw',
      args: ['serve', '3000'],
      mode: 'cluster',
      instances: 'auto',
      readiness: { mode: 'ipc', timeoutMs: 30_000 },
      health: {
        enabled: true,
        heartbeatTimeoutMs: 12_000,
        unhealthyThreshold: 3,
        restart: true,
      },
      restart: {
        maxRestarts: 10,
        windowMs: 60_000,
        stableMs: 30_000,
        minDelayMs: 100,
        maxDelayMs: 30_000,
        factor: 2,
        jitter: 0.2,
      },
      shutdown: { graceMs: 15_000, killMs: 5_000 },
      watch: {
        enabled: process.env.NODE_ENV !== 'production',
        mode: 'reload',
        paths: ['app', 'src', 'config', 'resources'],
        ignore: ['node_modules/**', '.git/**', 'storage/**', '*.log'],
      },
    },
  ],
};
```

Only explicit `env` overrides are persisted. The inherited host environment is never copied into the desired-state file.

## CLI

```text
rawnode-pm start [manifest] [--name app] [--instances N] [--force]
rawnode-pm stop <app>
rawnode-pm restart <app>
rawnode-pm reload <app>
rawnode-pm scale <app> <instances>
rawnode-pm status [app] [--json]
rawnode-pm show <app> [--json]
rawnode-pm logs <app> [--lines 100] [--stream stdout|stderr] [--follow]
rawnode-pm monitor [--app name]
rawnode-pm metrics [--prometheus] [--json]
rawnode-pm health [--json]
rawnode-pm doctor [--json]
rawnode-pm diagnostics <app>
rawnode-pm save
rawnode-pm resurrect
rawnode-pm delete <app>
rawnode-pm kill
rawnode-pm daemon [--resurrect]
rawnode-pm startup [systemd|launchd] [--output file] [--user-service]
rawnode-pm integrate [--root path] [--dry-run] [--force]
```

Any command that needs the daemon automatically starts it in detached mode and waits for authenticated control readiness.

## RawNode runtime integration

`RawNodePmServiceProvider` binds:

- `runtime.pm.adapter`
- `runtime.pm`
- `pm.runtime`
- `app.runtime()`
- `app.runtimeReady(meta)`

The runtime adapter tracks servers, active HTTP requests, sockets, framework health, and service-specific metrics. The `ServeCommand` calls `runtime.ready()` only after the hybrid HTTP/WebSocket/TCP/UDP server is listening. This is what makes a rolling reload readiness-gated rather than PID-gated.

See [RawNode integration](docs/RAWNODE_INTEGRATION.md) for exact anchors and payloads.

## Control plane

The default control transport is a Unix-domain socket or Windows named pipe. Every request carries a 256-bit local token. On Unix-like systems, the token and socket use mode `0600`; the state directory uses mode `0700`.

The optional HTTP management plane is disabled unless `RAWNODE_PM_HTTP_PORT` is set or `managementEnabled` is passed programmatically.

```text
GET  /health                 minimal public health by default
GET  /ready                  minimal public readiness by default
GET  /metrics                token-protected by default
GET  /v1/status              token required
GET  /v1/events              token required; SSE stream
POST /v1/command             token required
```

Use `Authorization: Bearer <control-token>` for protected endpoints. Unauthenticated health responses deliberately omit PIDs, socket paths, state paths, process names, and incident details.

## Observability

Per-worker telemetry includes:

- RSS, heap, external memory, and array buffers
- CPU user/system time and interval utilization percentage
- Event-loop utilization
- Event-loop delay minimum, mean, maximum, p95, and p99
- Node resource usage and active resource classes
- RawNode active requests, total requests, and open sockets
- Best-effort snapshots for HTTP, events, cache, Redis, sessions, WebSocket, TCP, UDP, RawMongo, and views

Prometheus output is available through `rawnode-pm metrics --prometheus` and the protected `/metrics` endpoint.

## Failure semantics

RawNode PM distinguishes:

- **online**: the operating-system process and IPC channel exist
- **ready**: the runtime has completed boot and declared traffic readiness
- **healthy**: ongoing health and heartbeat policies pass
- **drained**: new work has stopped and tracked work has completed or reached its deadline

A failed replacement never removes a healthy old cluster worker. Repeated failures trigger bounded exponential backoff and eventually quarantine the process group instead of creating an infinite fork storm.

## Host startup

Generate, review, and install a host definition:

```bash
rawnode-pm startup systemd --output ./rawnode-pm.service --user rawnode --group rawnode
rawnode-pm startup systemd --user-service --output ./rawnode-pm.service
rawnode-pm startup launchd --output ./org.rawnode.pm.plist
```

The host init system supervises the RawNode PM daemon; RawNode PM supervises application workers.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [RawNode integration](docs/RAWNODE_INTEGRATION.md)
- [Operations runbook](docs/OPERATIONS.md)
- [Security model](docs/SECURITY.md)
- [Validation report](docs/VALIDATION.md)
- [Roadmap](docs/ROADMAP.md)

## License

MIT
