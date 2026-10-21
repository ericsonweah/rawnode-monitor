# Validation

The cookbook was checked against the current RawNode Unified public surface and
its supplied reference workspace.

Completed checks:

- All 24 JavaScript files pass `node --check`.
- RawNode Unified's 33-test core suite passes.
- The basic four-protocol example starts with `port: 0`, reaches readiness, and exits cleanly through `SIGTERM`.
- The combined example completes real HTTP, RawNode TCP, and RawNode UDP/RUDP request/response round trips on the same numeric port.
- A RawNode WebSocket client completes the HTTP upgrade and an ACK-based event exchange against the combined server.
- The production example exposes a ready health endpoint and protected Prometheus endpoint, then exits cleanly through `SIGTERM`.
- The enterprise TLS example completes a verified HTTPS request and a secure RawNode TCP request negotiated with `rawnode-tcp/1` ALPN.

These checks validate the documented API and representative startup, transport,
security, and lifecycle paths. Browser execution, real production certificates,
multi-worker distribution, external load balancers, and infrastructure-specific
Proxy Protocol behavior must still be validated in the target deployment
environment.
