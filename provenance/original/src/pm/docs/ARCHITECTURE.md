# RawNode PM Architecture

## Runtime topology

```text
CLI / TUI / HTTP management / SSE
                 |
       authenticated local control
                 |
        RawNode PM supervisor daemon
  +--------------+---------------+
  | process registry / desired state
  | lifecycle state machines
  | restart and quarantine policy
  | rolling reload / scale coordinator
  | watcher / reconciliation
  | logs / metrics / diagnostics
  +--------------+---------------+
                 |
      fork / cluster / external drivers
                 |
   +-------------+-------------+
   | RawNode worker runtime agent
   | health, metrics, readiness
   | protocol-aware drain/shutdown
   +-------------+-------------+
                 |
 HTTP + WebSocket + TCP + UDP + jobs
```

## Core boundaries

### Supervisor daemon

The supervisor owns process state and policy. It is intentionally outside application workers so a worker crash, blocked event loop, memory fault, or rolling reload cannot destroy the component responsible for observation and recovery.

### Process registry

The registry stores desired process groups and bounded historical worker generations. Active workers are indexed by stable slot. A rolling replacement is spawned as a new generation and becomes active only after readiness succeeds.

### Runtime agent

The runtime agent lives inside a managed RawNode worker. It sends versioned packets over Node IPC and exposes framework-specific lifecycle operations:

- online
- ready
- heartbeat
- health
- metrics
- draining
- drained
- shutdown complete
- diagnostic ready

### RawNode runtime adapter

The adapter bridges generic process supervision to RawNode internals. It tracks network servers, active HTTP requests, open sockets, container-resolved health providers, framework metrics, and provider teardown.

### Control plane

The default control plane is a private newline-framed protocol over a Unix socket or Windows named pipe. It is separate from worker IPC. Every command is authenticated, audited, frame-bounded, and timeout-bounded.

An optional loopback HTTP server exposes minimal health probes and authenticated status, metrics, command, and SSE endpoints.

## Process state machine

```text
defined -> starting -> online -> ready -> running
                  |        |        |       |
                  +--------+--------+-------+-> unhealthy
                                           |
running -> draining -> stopping -> stopped
   |
   +-> crashed -> backoff -> starting
          |
          +-> quarantined

starting -> boot_failed -> backoff | quarantined
```

Invalid transitions throw rather than silently corrupting lifecycle state.

## Readiness-gated rolling reload

For each cluster slot:

1. Spawn a replacement generation.
2. Wait for runtime IPC readiness or a configured HTTP/TCP probe.
3. Keep the old generation active if readiness fails.
4. Atomically activate the replacement in the registry.
5. Ask the old runtime to drain.
6. Wait for tracked work until the grace deadline.
7. Ask the runtime to shut down and run RawNode teardown.
8. Send the configured termination signal only if the graceful deadline expires.
9. Use the configured kill signal as the final bounded fallback.

The algorithm serializes operations per process group, preventing overlapping reload, scale, restart, and health-replacement races.

## Execution modes

### Fork

Uses `child_process.fork()` with advanced IPC serialization. It is appropriate for one directly managed Node process.

### Cluster

Uses Node's native cluster primary/worker model. Slots can scale horizontally and use readiness-gated rolling replacement.

### External

Uses asynchronous `child_process.spawn()` with stdout/stderr pipes. External processes have immediate or network-probe readiness and signal-based draining because they do not run the RawNode runtime agent.

## Backpressure

- Worker stdout and stderr are paused while asynchronous log writes complete.
- Log files rotate at configured byte limits.
- In-memory log tails use byte-bounded ring buffers.
- Control frames have hard byte caps.
- Control and SSE subscribers are disconnected when their writable buffers exceed limits.
- Metric and event history have bounded retention.
- File polling walks enforce a maximum tracked-file count.

## Persistence

Desired state is persisted through atomic temp-file, fsync, and rename semantics. When encryption is enabled, the payload uses AES-GCM with a key derived from the private local control token. Only explicit environment overrides are serialized.

The append-only operational journal and audit trail use separate files from desired state.

## Non-blocking guarantees

The runtime path uses asynchronous child-process APIs, promises, streams, timers, native watchers, WebCrypto, and asynchronous filesystem operations. No synchronous filesystem calls occur in the daemon or worker hot paths.

Some CPU work remains intentionally small and bounded: state-machine transitions, metric formatting, control JSON parsing under frame limits, path matching, and shallow redaction.
