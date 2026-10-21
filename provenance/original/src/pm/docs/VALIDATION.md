# Validation Report

Validation date: 2026-07-14

## Automated result

```text
JavaScript syntax scan: 82 files checked, OK
Behavioral tests:       16 passed, 0 failed
Type declarations:      TypeScript strict consumer check, OK
Detached CLI workflow:  start/status/health/doctor/metrics/logs/save/stop/kill, OK
RawNode integration:    dry-run/apply/syntax/idempotency, OK
Packed consumer install: public exports/CLI/zero-dependency contract, OK
Runtime dependencies:   0
Optional dependencies:  0
Peer dependencies:      0
```

## Behavioral coverage

The current suite executes real processes and transports rather than testing only pure mocks.

| Area | Validated behavior |
|---|---|
| Cluster | scale up/down, IPC readiness, rolling reload, PID replacement |
| Fork runtime | online/ready, telemetry, health, diagnostics, drain, shutdown |
| Crash policy | repeated failure backoff and quarantine |
| State | AES-GCM encrypted save and resurrection |
| Control | authenticated request/response and realtime event stream |
| Permissions | Unix token and control socket mode `0600` |
| Management HTTP | redacted public health, protected metrics/commands, invalid JSON handling |
| Watcher | coalescing, native watch, polling fallback, cleanup |
| Integration | exact anchors, dry run, backups, atomic patching, syntax validation, idempotence |
| Startup | hardened systemd and launchd generation |
| Daemon startup | transactional startup rollback and immediate state-directory reclaim after bind failure |
| CLI | detached daemon discovery, real child readiness, metrics, logs, state save, graceful stop, daemon shutdown |
| Packed consumer | clean-project tarball install, root/runtime/integration exports, installed CLI, zero-dependency contract |
| Types | strict TypeScript consumer compilation |

## Commands used

```bash
node tools-check.js
node --test
node tools-check-types.js
node bin/rawnode-pm.js start <manifest> --state-dir <temporary-directory> --json
node bin/rawnode-pm.js status cli-fixture --state-dir <temporary-directory> --json
node bin/rawnode-pm.js health --state-dir <temporary-directory> --json
node bin/rawnode-pm.js doctor --state-dir <temporary-directory> --json
node bin/rawnode-pm.js metrics --state-dir <temporary-directory> --json
node bin/rawnode-pm.js logs cli-fixture --state-dir <temporary-directory> --json
node bin/rawnode-pm.js save --state-dir <temporary-directory> --json
node bin/rawnode-pm.js stop cli-fixture --state-dir <temporary-directory> --json
node bin/rawnode-pm.js kill --state-dir <temporary-directory> --json
npm pack --dry-run
npm install --ignore-scripts /path/to/rawnode-pm-0.1.0.tgz
node --input-type=module -e "await import('rawnode-pm'); await import('rawnode-pm/runtime'); await import('rawnode-pm/integration/rawnode')"
```

## Acceptance invariants

- A failed rolling-reload replacement does not remove the healthy active worker.
- A deterministic crash loop eventually quarantines instead of forking indefinitely.
- Desired-state files do not expose explicit environment values in plaintext.
- Slow control or SSE consumers cannot grow daemon buffers without a configured bound.
- Worker log streams participate in backpressure.
- Daemon shutdown has bounded graceful and forced stages.
- A failed control-plane bind releases the daemon lock, PID file, socket, timers, watcher, logs, journal, and audit resources.
- The package contains no runtime, optional, or peer dependencies.

## RawNode integration validation

The exact-anchor integrator was run against the current extracted RawNode `Application.js` and `ServeCommand.js` source:

1. Dry-run identified two file modifications and two template creations.
2. Apply created timestamped backups and wrote all targets atomically.
3. Both modified JavaScript files passed `node --check`.
4. A second apply reported no changes, creations, or backups.

This verifies the shipped anchors against the current RawNode source snapshot used to build this release.

## Remaining validation before a 1.0 release

- Long-duration soak tests under sustained log and metric volume
- Host reboot tests on current systemd and launchd versions
- Windows named-pipe and process-signal matrix
- Container PID 1 and Kubernetes termination-grace tests
- Multi-protocol production traffic drain tests with real HTTP keep-alive, WebSocket, TCP, and reliable UDP clients
- Fault injection for disk-full, read-only filesystem, corrupted state, and process-table exhaustion
- Throughput and tail-latency comparison with monitoring disabled and enabled
- Security review and fuzzing of control frames, manifest parsing, and management HTTP input
