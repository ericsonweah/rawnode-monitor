# Operations Runbook

## Default state locations

Unix-like systems use `~/.rawnode-pm`. Windows uses `%LOCALAPPDATA%/RawNode/pm`.

```text
state.json           encrypted desired state
token                local control token
journal.jsonl        lifecycle journal
audit.jsonl          administrative audit trail
daemon.pid           current daemon PID
daemon.lock          single-owner lock
logs/<app>/           rotated worker logs
incidents/            redacted diagnostic bundles
```

Set `RAWNODE_PM_HOME` or pass `--state-dir` to isolate environments.

## Recommended production launch

1. Generate a systemd or launchd definition.
2. Review absolute Node, package, state, and working-directory paths.
3. Run the daemon under a dedicated operating-system account.
4. Keep the state directory private to that account.
5. Enable `--resurrect` so desired capacity returns after host restart.
6. Keep the HTTP management server loopback-only unless it is placed behind a trusted authenticated control layer.

## Common commands

```bash
rawnode-pm start rawnode.process.mjs
rawnode-pm status
rawnode-pm logs rawnode-api --follow
rawnode-pm metrics --prometheus
rawnode-pm reload rawnode-api
rawnode-pm scale rawnode-api 8
rawnode-pm diagnostics rawnode-api
rawnode-pm save
rawnode-pm doctor --json
```

## Rolling reload policy

Use `reload` for cluster applications. A replacement must become ready before the active worker is drained. If replacement readiness fails, the active worker remains in service and the command fails.

Fork and external applications fall back to a bounded restart because there is no parallel slot capable of sharing a cluster listener.

## Crash loops

A process that exceeds `restart.maxRestarts` inside `restart.windowMs` is quarantined. Correct the underlying failure, then run a forced start or restart. Do not raise the restart limit as the first response to a deterministic boot failure.

## Capacity mismatch

`health` and `doctor` report a capacity mismatch when desired running slots exceed active slots. Typical causes:

- readiness failures;
- worker quarantine;
- an invalid entry path;
- resource exhaustion;
- application boot timeout;
- health-replacement failure.

Collect diagnostics and inspect the latest error log before forcing recovery.

## Logs

Each application slot has separate output and error files. Writes pause the child stream until the asynchronous file operation completes. Rotation uses configured byte and file-count limits. The realtime tail is a separate bounded in-memory ring and can drop historical lines without affecting persisted logs.

## Metrics

The CLI metrics command returns structured JSON. `--prometheus` emits the text exposition format. The management HTTP `/metrics` endpoint is token-protected unless explicitly made public.

Avoid high-cardinality labels in future framework adapters. Process name, namespace, mode, slot, PID, and state are the bounded labels currently emitted.

## Diagnostics

`rawnode-pm diagnostics <app>` creates a private incident bundle containing:

- daemon and process metadata;
- bounded recent logs;
- bounded metric history;
- bounded lifecycle events;
- framework health state;
- runtime-generated Node diagnostic report paths where supported.

Secret-looking keys and values are redacted before the bundle is written.

## Backup and recovery

Back up the entire state directory as one security unit. `state.json` cannot be decrypted without the matching control token. Restoring only one of those files is insufficient.

For disaster recovery:

1. stop the daemon;
2. restore the state directory with private ownership and permissions;
3. ensure application paths in the manifest still exist;
4. start the daemon with resurrection;
5. run `doctor` and verify active capacity.

## Daemon shutdown

`rawnode-pm kill` asks the daemon to stop all groups gracefully, close watchers and logs, append final journal/audit records, remove the PID file and control socket, and release the daemon lock.
