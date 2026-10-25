# Native controller diagnosis and retained attempts

These are authored observations of the native `cua_repl` tool transcript, not fabricated browser-console exports. Browser request/prompt/state JSONL files are independent server receipts. No browser connector was available. No automation framework, driver, injected prompt answer, disabled security feature, or alternate Studio action UI was used.

## Attachment and simple diagnostic

Chrome 155.0.8059.85 Guest creation failed twice with stale accessibility elements (`-10005`); a coordinate attempt reported that the selected application changed. No Guest profile was established. The alternative native New Incognito Window shortcut opened a dedicated empty window. `diagnostic-01` fetched the standalone control HTML and script, and its unique title appeared, but the accessibility tree lacked page content and the captured content area was blank. The single planned reload did not restore it. Closing that owned window returned a timeout, so window teardown was initially inconclusive. Its server later accepted stdin `close` and exited0. This does not demonstrate a Monitor rendering defect: the page contained no Monitor client.

Safari 27.0, build20625.1.29.18.28, opened a fresh private `diagnostic-safari-02` window. Its ordinary button recorded one event. The actual browser-native prompt returned `null` for Cancel, `""` for deliberate empty OK, and `synthetic-native-control` for intentional text. All are retained in `diagnostic-safari-02.jsonl`; there were no Monitor mutations. The diagnostic used the explicitly labeled intermediate legal-only artifact, not final acceptance bytes. Its server closed via stdin with exit0.

## Final-archive sessions

All final sessions use archive `a749983cc32e7ed9df10088dbe671fc4c6a3d47ed9a22da8a9d48d1e789c2615`, the independent installed root recorded in each input JSON, Node24.21.0, unmodified packaged JS/CSS, synthetic data and unique ephemeral loopback origins. Their observed private Safari window identities were:

| Session | Safari window UUID | External wrapper |
| --- | --- | --- |
| final-local-01 | BE81D40F-DBAB-43AD-9137-9C9BD5C1A0E9 | v1 |
| final-local-02 | F27E00DB-69FF-4D63-9143-FF717AE9A947 | v3 |
| final-local-03 | 8F9AC0DB-1BDB-4710-B570-BC7A8DD62F7E | v3 |
| final-local-04 | 19695AFF-9230-4EED-BE28-D504450CFCEA | v4 |
| final-token-05 | 63A1B398-D1E6-4741-893F-807761F65366 | v4 |

`BROWSER_PLAN.md` preserves the original bounded repetitions and the amendment after an observed correction. v1/v2/v3/v4 scripts and failed HTTP wrapper attempts are retained. Local01's v1 observations remain relevant to the unchanged package and their stated local mode; they do not certify v4 token authorization.

Safari's accessibility tree flattened table action buttons into a cell. Clicking that cell in local01 activated Acknowledge while the intended case was resolution Cancel. The actual acknowledgement POST and changed state are retained. The subsequent real Resolution note Cancel produced no resolution POST, but the whole case cannot be called zero-mutation. Coordinate clicks/scrolls repeatedly returned `noWindowsAvailable`; some screenshots were blank. This is a failed controller-targeting attempt, not evidence that Cancel itself sends mutations.

In local02, keyboard navigation from the observed Record case intent button reached Resolve, with a visible focus outline. Enter opened the real Resolution note prompt; Cancel left the clean incident open with zero mutations. The same observed keyboard route reached the trace link and produced a real API read, waterfall, redacted attributes and working Resume. Local03 repeated the clean resolution Cancel; local04 repeated it with the extra four fixture controls accounted for in tab order. No cell click was reused to select an ambiguous action.

Intermittent native errors remained: ScreenCaptureKit `-3812` invalid parameter, `timeoutReached`, and coordinate `noWindowsAvailable`. One 60-second multi-view tool call reset its JavaScript kernel; all four view observations nonetheless reached the append-only server log. Those receipts were checked before crediting them. Later calls were smaller. Window creation/close timeouts were followed by a fresh identity observation before further input; no blind repeated close was used. Reacquiring Safari after a new window restored access but does not establish a permanent tool repair.

## Visibility, layout and observation limits

Native clicks can operate while Safari reports the document hidden. This was directly observed in v4 lifecycle records even after the window's exposed Raise action and a user foreground confirmation. An automated token-mode five-second sample therefore recorded zero reads and hidden visibility; it proves hidden-page throttling only. A separately requested manual foreground sample must be judged by its actual receipt, never by a confirmation message alone. No visibility getter, timer policy or token transport was replaced to force a pass.

Screenshots in the tool transcript were visually inspected at normal width, at the trace/Resolve keyboard focus, and at457 CSS pixels using browser zoom. The independent observation recorded equal viewport/document widths457 for Overview and Alerts, with native navigation still usable; zoom was restored. These are desktop zoom-based responsive checks, not mobile-device or assistive-technology certification. Standalone screenshot files were not exported by this native API. The observed synthetic markup remained literal, with zero generated image elements and empty captured runtime/CSP event arrays. These listeners are bounded fixture observations, not an exhaustive DevTools console/network or accessibility audit.

Fixture timers remain bounded to15minutes. Natural process exit, server closure and native-window cleanup are recorded separately in the final browser receipt; successful interactions do not imply cleanup that was not verified.

## Final reconciliation

The operator-assisted token05 receipts retained both a visible→hidden sample with five reads and a fully visible→visible sample with five authenticated reads over5,008ms. Only the latter completes the planned visible polling check. Reload then displayed the native authorization form again, while the separate host session continued to admit shell/assets. A fresh explicit bearer submission restored API access. Diagnostics inspection and its Resume presentation were also recorded before final unmount.

All seven diagnostic/final servers accepted stdin close and returned process exit0. `cleanup.json` independently records connection refusal on each owned port and clients/listeners0; its initial sandbox EPERM attempt remains separate. After final token-window Command-W, native state/app calls timed out, including one fresh kernel reconnect. The user then confirmed “Named task windows are closed.” Window cleanup is operator-attested; independent native window enumeration remains unavailable. Borrowed browser processes and unrelated windows were not targeted.

The final [combined receipt](../BROWSER_RECEIPT.json) reconciles compatible subcases from the same final artifact while preserving the initial failed controller attempts. No claim of fully reliable automation, another browser engine, global leak freedom or production deployment follows from these results.
