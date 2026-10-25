# Monitor Studio and browser acceptance

The authoritative frontend is the supplied local `resources/assets/js/monitor/studio.js`, preserved verbatim in the full archive before changes. CSS, page renderer, assets, manager, controller, authorizer, limiter and route registration are retained. Routes cover overview, metrics/Prometheus, traces, signals, health, resources, alerts/acknowledgement/silences, SLOs, incidents/annotations/resolution, fleet, deployments, anomalies, synthetics, correlation, diagnostics/bundles, SSE and signed ingestion. `docs/API.md` lists exact methods.

Package assets resolve relative to the package. Supply `assetsRoot` to route registration only when deliberately replacing the asset tree. This differs from the original implicit application-root lookup. `/studio/client` is browser-safe to import without a DOM; it auto-mounts when the standard root is present, and exports `mountMonitorStudio(root, {fetch?, EventSource?})`. The root must contain the markup produced by `renderMonitorStudioPage`. One active root owns one poll timer and at most one EventSource. Replacing/removing a root must call its returned handle's `destroy`.

Opening a trace, incident or full diagnostics snapshot pauses automatic refresh for that view, so the inspected content stays readable. The view displays this pause and a **Resume live updates** button. The main **Refresh** button and navigation also clear the inspection and resume updates. Automatic refresh defers while a filter has a value, a form control or details summary in the main content has focus, or a native details section is expanded; clearing/closing those controls allows polling to continue. These are retained snapshots, not continuously updated detail panels. Manual refresh and operator actions remain available, and leaving the view still aborts its pending requests.

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

9. Alerts contains a seeded synthetic firing warning. Cancel the rule-ID, duration and reason prompts separately; compare `/fixture/status` before/after and require unchanged `mutationRequests`, `silences` and `alertState`. Deliberately submitting an empty rule ID means all rules; positive finite duration is required. Complete one intentional silence and inspect it.
10. Incidents contains `fixture-incident`. Cancel resolution and require unchanged mutation count and open state, then deliberately resolve with an optional note. Simulate a failure before a mutation and verify visible escaped feedback. Cancellation cannot undo a mutation already accepted by the server.
11. Use Delay requests 500 ms, then navigate rapidly or unmount while an action/read is pending. The current view must own polling; stale action completion must not change it. An injected non-cooperative operation must not retain the preceding view's polling ownership. Recover restores seeded responses.
12. Open trace, incident and full diagnostics details, then wait for several polling intervals and leave/return to the browser tab. The inspection and pause message must remain. **Resume live updates**, **Refresh**, or navigation should restore automatic refresh. Focus/type a filter or expand metric/doctor details and verify that polling preserves the control and content until cleared, closed or explicitly refreshed.

Trace timing uses styled native `progress` elements rather than inline width styles, matching the page's `style-src 'self'` CSP. Filters have explicit accessible labels and interactive elements have a visible focus outline; these source changes still require visual and assistive-technology acceptance.

Browser evidence is versioned separately from the package. The October 21 computer-use inventory had no available apps or browsers; those modeled DOM and HTTP results remain historical evidence. The October 24 follow-up checks the actual available browser against a fresh exact installed archive; its executed cases, screenshots, browser version and remaining limitations are recorded in `readiness-2026-10-24/REPORT.md` and the browser receipt. Do not infer full browser or assistive-technology acceptance from successful asset requests or modeled DOM tests.

The October 25 continuation records fresh native browser observations and remaining gaps in `readiness-2026-10-25/REPORT.md` and `browser.json`, tied to its exact archive. Previous browser results apply only to their recorded bytes; ambiguous native dialog automation is not a passing Cancel test.

Automation-created navigation can send `Sec-Fetch-Site: cross-site` and is correctly rejected. A direct address-bar navigation sends `none` and may load the loopback shell; do not weaken origin checks to accommodate an automation tool. The operator-token field and authorization dialog expose accessible labels. The token remains in memory, and the initial shell still requires the appropriate authorization described above.
