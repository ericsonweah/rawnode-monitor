# Security Policy

## Threat model

Event names, payloads, contexts, replay buffers, remote envelopes, and diagnostics can all carry untrusted data. Production configuration must apply explicit byte, count, TTL, namespace, and cardinality ceilings.

## Event names and patterns

- Reject control characters and overlong names.
- Limit namespace segment count.
- Reserve framework namespaces for framework-owned emitters.
- Apply plugin namespace ACLs before allowing dynamic registration.

## Payloads and diagnostics

- Do not log payloads in production by default.
- Redact authorization, cookie, token, password, secret, key, and credential fields.
- Bound payload and context bytes before history or remote publication.
- Use history allowlists; deny sensitive namespaces explicitly.

## Redis bridge

- Use a dedicated channel and namespace per environment.
- Configure `EVENTS_REDIS_SECRET` for HMAC-authenticated envelopes.
- Keep version-1 unsigned acceptance only while legacy nodes remain.
- Validate timestamps, TTL, hop count, args, packet bytes, namespace, and signature.
- Treat Pub/Sub as ephemeral and non-transactional.

## Durable delivery

- Use idempotency keys at publishers and consumers.
- Enforce leases, retry limits, dead-letter policy, and packet bounds.
- Use a transactional application outbox when an event corresponds to a database mutation.

## Multi-tenancy

Propagate tenant identity through context and envelopes. Partition channels, streams, replay, persistence, and authorization rules. Never rely on a wildcard alone to enforce tenant isolation.

## Reporting vulnerabilities

Report suspected vulnerabilities privately to the RawNode maintainers. Include the affected version, reproduction, impact, and suggested mitigation. Do not include real credentials or customer data.
