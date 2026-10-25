# Browser handoff and optional extensions

**No mandatory native interaction remains pending in the selected Safari 27.0 scope.** [BROWSER_RECEIPT.json](BROWSER_RECEIPT.json) records 20 required gates passing against the final archive. The result is case-by-case across five identified final sessions, with each external harness revision attributed; it is not a fabricated single-session pass.

The archive is [final/artifacts/rawnode-monitor-1.0.0.tgz](final/artifacts/rawnode-monitor-1.0.0.tgz), SHA-256 `a749983cc32e7ed9df10088dbe671fc4c6a3d47ed9a22da8a9d48d1e789c2615`, 214,938 bytes / 177 files. Native execution used Safari 27.0, build 20625.1.29.18.28, macOS 15.8.1 x86_64, and Node 24.21.0 task-owned loopback fixtures. Node 22 runtime/consumer execution is a separate completed lane.

## Completed follow-ups

- Three clean repetitions of each silence Cancel stage use local01/02/03; three clean resolution Cancel repetitions use local02/03/04. The unintended acknowledgement in local01 remains preserved and excluded from the clean resolution count.
- Local02 captured actual trace detail/redaction and Resume before/after. Token05 captured full Diagnostics, its Resume request, and the cleared/refreshed presentation. Earlier incomplete local01 observations remain unchanged.
- Local04 ran immediate navigation and destroy during actual admitted delayed reads, with bounded settlement and no stale final view/DOM update. The native-clicked helper uses the actual public browser client; it is not a DOM model.
- Token05 established the protected host session, entered the synthetic bearer through native UI, used polling without native EventSource, and retained empty observed storage-key lists. Reload preserved the host session but sent its first API read without a bearer; a fresh deliberate token submission was required.
- All three polling windows remain: hidden→hidden / 0 reads, visible→hidden / 5 reads, then operator-assisted visible→visible / 5 authorized reads over 5,008 ms. Only the last passes the visible-to-visible observation gate. Actual request timestamps are retained; the endpoints do not establish continuous global visibility, timer cardinality or a global leak census.
- Narrow 457 px CSS viewport observations cover Overview and Alerts without document horizontal overflow. Specific native keyboard prompt entry/Cancel and trace activation were observed. This is not a full accessibility/device matrix.

## Cleanup and attribution

[cleanup.json](browser/cleanup.json) independently verifies `ECONNREFUSED` on all seven owned diagnostic/final ports and correlates their supported stdin close records: `listening:false`, clients 0, signal listeners 0. The parent execution results report natural exit 0 for all seven. The initial restricted port probe returned EPERM and is preserved as [cleanup-restricted.json](browser/cleanup-restricted.json), separately from the successful approved probe.

The native controller timed out after the final Command-W and after reconnect. The user subsequently confirmed **“Named task windows are closed.”** Named-window closure is therefore **PASS, operator-attested**, with independent native confirmation unavailable. [window-cleanup.json](browser/window-cleanup.json) preserves that distinction. No claim is made that all Safari/Chrome windows or processes were closed, and no personal browser process was killed.

Native screenshots were visually reviewed in the conversation; the native API supplied no standalone screenshot export. [Authored local01 observations](browser/local01-native-observations.md) and [token05 observations](browser/token05-native-observations.md) are explicitly distinct from raw JSONL. Do not cite an authored note as a raw screenshot or full console/network trace.

## Reproduction or a newly approved browser profile

No new execution is needed to complete this selected scope. For a future run, preserve this evidence and use a new session/evidence directory outside `package/`. Resolve the exact installed package from [final/distribution.json](final/distribution.json); if its temporary consumer is gone, create a new isolated offline install from the pinned archive with scripts disabled and verify its complete inventory. Do not substitute another same-version archive or checkout import.

Use the immutable [v4 external fixture](scripts/native-browser-fixture-v4.mjs), SHA-256 `186fef4752b8c688b740d150903205847467bc03770cf11911facae71327f072`:

```sh
/usr/local/bin/node qualification-runs/20261025T135100Z-node22-browser-pm/scripts/native-browser-fixture-v4.mjs /absolute/fresh-consumer/node_modules/@rawnode/monitor /absolute/new-browser-evidence native-followup local
```

Use `token` instead of the final `local` argument for the synthetic host-session/bearer profile. The command prints current loopback URLs, owned PID, input hashes and a 15-minute bound. Open only a fresh dedicated private window and verify its unique title/origin. Record a distinct case intent before each action, preserve prompt null versus empty results, actual UI observations, server requests/state, and cleanup. The wrapper delegates real native prompts unchanged.

For token mode, the public control page's prefilled synthetic host-session form authorizes shell/assets. Read the task-only `syntheticToken` constant from the reviewed fixture locally for native token entry; do not use real credentials or put the bearer in URLs, storage, screenshots or logs. Capture boolean header/session presence and token-free snapshots. [TOKEN_WRAPPER_REVIEW.md](browser/TOKEN_WRAPPER_REVIEW.md) retains the earlier external-wrapper failures/corrections and HTTP-only checks.

For polling, first record actual `visibility: visible`, keep the tab in front and avoid other controls during the five-second observation. Do not override visibility, browser security or product timing. [LIFECYCLE_CONTROLS.md](browser/LIFECYCLE_CONTROLS.md) defines the bounded controls and what they measure. A hidden/failed future attempt must remain visible in its own receipt, not be rerun until a pass is silently obtained.

Send `close` plus newline to that fixture's own stdin before its deadline; retain the closed record and natural exit. Probe only its recorded owned loopback port, and close only its named test window. No daemons, production monitoring, external services, publication, push or deployment are authorized.

Additional browser engines, native operating systems, assistive technologies, all-device layouts, prolonged stress/load, exact global timer/listener censuses and real backend profiles are **configuration-specific optional extensions**, not silently certified by this pass. Declare an actual release requirement and authorized disposable environment before executing any such lane. Publication authorization remains **NOT GRANTED**.
