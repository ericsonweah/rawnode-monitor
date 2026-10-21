# Advanced Roadmap

## 0.2 — Host observability and policy

- Runtime threshold rules for memory, event-loop delay, open resources, and error rate
- Alert adapters through RawNode events, mail, and WebSocket
- Historical metric compaction
- Framework route, queue, cache, Redis, RawMongo, session, and tenant metric adapters
- Terminal dashboard panels powered by RawNode Colors

## 0.3 — Workload roles

- First-class HTTP, queue, scheduler, listener, and one-shot job roles
- Independent autoscaling policies by role
- Queue pause, drain, and resume contracts
- Scheduled safe recycling and maintenance windows

## 0.4 — Deployment controller

- Release manifests and immutable release IDs
- Canary and percentage rollout
- Readiness and error-budget promotion gates
- Automated rollback to last-known-good release
- Cross-release incident comparison

## 0.5 — Multi-host agent plane

- Agent identity and encrypted transport
- Durable commands with idempotency keys, acknowledgements, expiry, retries, and dead letters
- Redis-stream-backed coordination using RawNode Redis
- Host inventory and distributed process topology
- Availability-zone-aware rolling operations

## 0.6 — Enterprise control plane

- RBAC and scoped administrative policies
- Multi-tenancy and per-tenant operational views
- Central append-only audit persistence
- Leader election and fencing tokens
- Desired-state reconciliation across hosts
- Remote dashboard through RawNode WebSocket and Reactive

## 1.0 — Stable contracts

- Versioned runtime and control protocol compatibility policy
- Migration tooling for state schemas
- Complete Linux, macOS, Windows, container, and orchestration compatibility matrix
- Published performance, overhead, reliability, and security validation reports
