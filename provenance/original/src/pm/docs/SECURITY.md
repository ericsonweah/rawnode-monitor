# Security Model

## Protected assets

RawNode PM protects:

- administrative process control;
- environment overrides in desired state;
- filesystem and socket locations;
- application logs and diagnostics;
- process identity and topology;
- health and metric details.

## Local control authentication

The daemon creates a random 256-bit token and stores it with mode `0600`. Every local control request includes that token and is compared with `timingSafeEqual` after a constant-length check.

The Unix control socket is also set to mode `0600`. Windows uses a named pipe; deployments should run the daemon and CLI under the intended account boundary.

## State encryption

Desired state uses AES-GCM through Node WebCrypto. A unique 96-bit IV is generated per save. The encryption key is derived from the local control token. Atomic write, fsync, and rename semantics prevent partially written state envelopes.

Only explicit process `env` overrides are serialized. The complete inherited host environment is not persisted.

## Management HTTP plane

The HTTP plane is disabled unless a port is configured. Its default host is `127.0.0.1`.

- Public health and readiness responses are intentionally minimal.
- Metrics are private by default.
- Status, commands, and SSE always require the bearer token.
- Request bodies and headers are bounded.
- Invalid JSON receives a 400 response.
- Slow SSE clients are disconnected at a configured writable-buffer threshold.
- Responses use `no-store` and `nosniff` headers.

Do not bind the management server to a public interface without an additional trusted transport-security and identity layer.

## Logs and diagnostics

Administrative events are written to a separate audit trail. Diagnostic bundles pass through a secret redactor before persistence. Redaction reduces accidental disclosure but does not replace application-level discipline: applications should never log secrets in the first place.

## Process execution

Manifest process names are constrained to a safe character set. Node script paths are resolved to absolute paths. External commands are spawned directly without shell interpolation. Arguments are passed as arrays.

systemd and launchd definitions use escaped argument values and absolute executable paths.

## Denial-of-service controls

- control frame size limit;
- HTTP request body limit;
- subscriber writable-buffer limits;
- log rotation and ring-buffer byte limits;
- bounded event and metric histories;
- watcher file-count limit;
- restart-window quarantine;
- operation and probe timeouts;
- graceful-stop and kill deadlines.

## Trust assumptions

A user who can read the state directory can obtain the control token and administer the local daemon. The operating-system account and filesystem permissions remain the primary local security boundary.

The current release is a single-host control plane. It does not claim remote zero-trust identity, distributed authorization, quorum, or tamper-evident centralized audit storage; those belong to the multi-host roadmap.
