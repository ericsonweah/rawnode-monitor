# Monitor Studio and browser acceptance

The authoritative frontend is the supplied local `resources/assets/js/monitor/studio.js`, preserved verbatim in the full archive before changes. CSS, page renderer, assets, manager, controller, authorizer, limiter and route registration are retained. Routes cover overview, metrics/Prometheus, traces, signals, health, resources, alerts/acknowledgement/silences, SLOs, incidents/annotations/resolution, fleet, deployments, anomalies, synthetics, correlation, diagnostics/bundles, SSE and signed ingestion. `docs/API.md` lists exact methods.

Package assets resolve relative to the package. Supply `assetsRoot` to route registration only when deliberately replacing the asset tree. This differs from the original implicit application-root lookup. `/studio/client` is browser-safe to import without a DOM; it auto-mounts when the standard root is present, and exports `mountMonitorStudio(root, {fetch?, EventSource?})`. The root must contain the markup produced by `renderMonitorStudioPage`. One active root owns one poll timer and at most one EventSource. Replacing/removing a root must call its returned handle's `destroy`.

Run `node examples/studio-fixture.mjs` from the extracted package and open the printed URL in a local browser. The fixture controls are test-only; they are not included in the production Studio page. Send `close` to its stdin to stop it. Its TTL is 15 minutes. Do not substitute a real admin application.

Browser acceptance checklist:

1. Overview loads, navigation works, and the fixture service containing `<img ...>` renders as text. No alert dialog or injected image should appear.
2. Open Traces; inspect the synthetic span and verify `token` is redacted.
3. Click Empty traces; verify a usable empty state.
4. Click Simulate failure; verify an escaped error message and Retry button. Recover should restore overview.
5. Disconnect stream; verify polling remains usable and EventSource reconnects. Inspect `/fixture/status` for a single eventual client.
6. Cycle mount 20 times; verify there is one live stream and one active polling loop. Unmount should stop further API calls and close the stream. Mount should restore one connection.
7. Navigate rapidly while requests are pending; old responses must not overwrite the latest view. Remove/unmount during a pending request; no later DOM update should occur.
8. Check keyboard navigation, focus, narrow layout, stylesheet rendering, screen-reader labels, and console errors in a real browser.

Validation in this task: actual Node loopback HTTP passed. Modeled DOM tests cover repeated lifecycle, abort, empty/error/recovery and escaping. The Mac UI tool reported no available browser surfaces, so actual browser rendering, visual layout, native EventSource reconnection and accessibility are **unverified**, not represented as passed. A parent cloud-browser run against the exact transferred package can supplement this evidence.
