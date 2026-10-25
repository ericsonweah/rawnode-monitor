# RawNode Monitor readiness — 25 October 2026

**Engineering verdict: the repaired candidate passes the executed runtime, type, distribution and local composition gates and is ready for code review. Full production qualification and publication remain blocked.** Fresh native-browser acceptance is incomplete because control repeatedly switched windows or timed out; those cases remain open rather than being inferred from modeled DOM or HTTP results.

## Final local deliverable

- [Archive](artifacts/rawnode-monitor-1.0.0.tgz): `@rawnode/monitor@1.0.0`, **209,613 bytes**, **177 files**.
- SHA-256: **`69e756daa6d127ca919acef8f430998a35bf1217cb2491d20b11dd77a1e908f7`**.
- [Final verification](final-verification.json), [file inventory](distribution.json), [review patch](review.patch), [changed-file hashes](changed-files.json), [release checklist](RELEASE_CHECKLIST.md).

The repository remains on `master` at `884a4974ba14d15a21ed4014bbe004ebf95384a7`, with remote `git@github.com:ericsonweah/rawnode-monitor.git`. It started with legitimate uncommitted October 24 fixes, declarations, documentation and evidence. Those were preserved. The patch covers 20 package files versus HEAD, including that inherited work; it is not a claim that all 20 changed in this continuation. No commit or Git index change was made. `AGENTS.md` was read and left unchanged.

## Review leads and implementation

| Lead | Disposition | Final evidence |
| --- | --- | --- |
| A: Studio failure sanitization | Original JSON read/mutation/ingestion/authorizer repair already present. Extended the same boundary to page, asset, Prometheus and stream admission failures. | [Studio review](studio-review.json), controller/HTTP regressions, final 97-test suites |
| B: Cancel operator actions | Already repaired: each null prompt exits before mutation; deliberate empty rule ID retains all-rules meaning. | Focused modeled actions cover each Cancel, success, validation, visible failure, stale navigation/unmount; fresh native coverage is partial below |
| C: Health registration identity | Already repaired: cache invalidation, identity-bound disposers, late callback cache guard and explicit unregister retained. | [Lifecycle review](lifecycle-review.json), final suites |
| D: Exporter work after close | Already repaired: own abort controller, tracked admission, guarded compression/split/retry continuations, active request cancellation and idempotent drain. | Standalone and runtime-owned lifecycle regressions; adjacent delivery fixes below |
| JSONL admission/drain | Already repaired: full operation registered before initialization yields; close stops admission and drains earlier writes across kinds. | Deferred initialization, flush/close, late admission and persisted-data regressions |

Five adjacent issues were confirmed and repaired, with seven new regressions:

1. A receiver could consume telemetry then truncate its acknowledgement; the exporter replayed it. Interrupted acknowledgements now retain the error code and report `retryable:false`, `details.delivery:"unknown"`.
2. A connection reset after the completed payload write also allowed replay. That path now reports the same delivery uncertainty without automatic resend.
3. Socket inactivity was used as a timeout, allowing a response that kept sending bytes to exceed `timeoutMs`. An owned elapsed timer now bounds each request attempt, including socket queueing and response reads. Serialization, compression, backoff and other chunks are outside this per-attempt deadline.
4. Rejected new rate-limit clients could grow the bucket map past `maxKeys`. Existing eviction now applies to rejected admissions too.
5. Page/asset/Prometheus/stream admission errors bypassed the existing bounded JSON boundary. They now use it before headers are sent. Errors after response start propagate to the host; the controller does not attempt a second response.

The before-fix logs preserve three failing exporter reproductions and three failing Studio boundary tests; an additional actual-loopback Studio regression checks the repaired response paths. Both focused 16-test suites pass. Ordinary explicit retryable HTTP responses still retry within configured limits. Complete 2xx responses count as acknowledgements, not proof of durable storage. Shutdown cannot undo telemetry already received remotely.

Earlier working-tree repairs remain: uncertain timeout and partial-split no-replay, health/metric/synthetic declaration corrections, labeled operator authorization, and readable trace/incident/diagnostic snapshots with explicit resume. Documentation was synchronized directly after inspecting the generator; it was not run to append `any` fallbacks. Independent compatibility review found no concrete mismatch in changed declarations. Advanced extension types remain intentionally broad.

All 29 manifest entries, 28 executable exports and 189 root names including default remain. ESM, Node >=22, zero dependencies, explicit capability injection and all capability groups remain. Runtime, Studio, bridges and host HTTP servers have separate ownership. Root import is passive; construction, startup and browser auto-mount are separate. Non-cooperative injected callbacks can outlive bounded waits.

## Executed gates and environment

macOS **15.8.1 x64**, Intel i9-8950HK, 12 logical CPUs, 32 GiB RAM; Node **v24.21.0**, npm **11.19.0**, preinstalled TypeScript **5.9.3**. No dependencies or compiler/runtime were downloaded. Node 22 was not found in inspected PATH/runtime-manager/Homebrew locations. A read-only temporary-cache scan had inaccessible directories, so this is a tooling availability gap, not an exhaustive machine inventory. Other platforms remain unexecuted.

| Gate | Result against the final hash |
| --- | --- |
| `npm run build`, native/extracted/installed | Exit 0 each; 112 JavaScript files and 29 export entries |
| `npm test`, same three trees | **97 passed each; 0 failed, cancelled, skipped or todo** |
| `node examples/basic.mjs`, same trees | Exit 0 each |
| Strict `test/types.mts` and `test/exports-types.mts` | Exit 0 in all three trees and fresh external consumers |
| `npm run prepublishOnly`, same trees | Intended exit **1**, publication blocked |
| `npm pack --offline --json --pack-destination …` | Prepack validation passed; exact archive recorded above |
| Fresh extraction and independent offline npm installation | Source/archive/extracted/installed paths and bytes match; no symlinks or workspace fallback |
| Actual package-specifier imports | All 29 entries; 28 executable, DOM-free `/studio/client`; unsupported private deep import rejected |
| Installed Studio HTTP/SSE | **33 checks passed**, owned fixture closed |
| Installed bearer/HMAC ingestion | **19 checks passed**, owned fixture closed |
| Exact accepted PM composition | Direct bridge contracts, **5/5 reciprocal cases**, actual owned child IPC, paired strict types passed |

Exact commands, directories, tool versions, timeouts and exits are saved in [consumer checks](consumer-checks.json), `logs/final-{native,extracted,installed}/commands.json`, `logs/distribution/commands.json`, and composition logs. Type flags are `--noEmit --strict --module nodenext --moduleResolution nodenext --target es2022`, with `--resolveJsonModule` for all-entry consumers. Offline installation used `--ignore-scripts --no-audit --no-fund --package-lock=false` and a task-owned cache; build and guard ran explicitly afterward. Build/check/prepack share validation; there is no transpilation or lint script. Harnesses enforce nested exit status, positive test counts, zero failed/cancelled/skipped tests, guard text and complete file inventories.

The inherited dirty baseline passed **90/90** after loopback permission. Its initial sandbox run had 76 passes and 14 `listen EPERM` failures; those logs remain separate. Focused source reproductions also retain their initial sandbox/before-repair failures. None are relabeled as successful final results.

The final audit preserved **1,416 immutable files**, including instructions and prior dated evidence. It rechecked **866 original-file hashes** separately from **169 historical candidate hashes**. The original 184,659-byte archive remains SHA-256 `b246ee9eff0b3579f05c886f05ec485719bb1b4847c97c4eefa99dead480baad`. Historical 52 native/52 extracted tests and extraction-only consumers are reconciled in [reconciliation](reconciliation.json); they are not new results. Packed content inspection found required code/types/assets/config/docs/examples and no unintended machine paths, forbidden imports, secret-file names or recognized private-key patterns. These bounded scans are not universal secret detection.

## Actual browser coverage and remaining acceptance

[Browser receipt](browser.json) binds the run to the final installed archive. Native Chrome **155.0.8059.85** and Safari **27.0 (20625.1.29.18.28)** were available; no browser connector was available. Safari rendered Overview and Alerts with synthetic markup as literal text. The first native rule-ID Cancel returned null, left the visible alert firing with no silence, and produced zero mutation requests before the next prompt sequence. Chrome eventually exposed a rendered Overview and, after deliberate fixture shutdown, the visible fetch-error/Retry state.

**Full native acceptance remains unverified.** During the next cancellation attempt, control reported a changed surface while prompt instrumentation recorded default duration/reason acceptances and one synthetic silence POST. This is ambiguous input, not a passing Cancel test or a diagnosed product defect. Safari state calls then timed out; Chrome repeatedly selected another ongoing local validation window. Selecting the Monitor window explicitly and trying a fresh fixture did not restore dependable control. No origin, token, CSP or browser security check was weakened.

Fresh all-view navigation, trace inspection, intentional operator actions, remaining Cancels, empty/loading/recovery, rapid pending navigation, repeated mount/destroy, native SSE reconnect, polling fallback, narrow layouts, keyboard/focus, console/CSP and assistive-technology acceptance remain open. Automated final-package tests cover the corresponding modeled/protocol behavior only. The broader October 24 Chrome observations and [inspection screenshot](../readiness-2026-10-24/final/studio-inspection.jpg) remain historical evidence for their recorded archive, not fresh acceptance of this one. No new successful acceptance screenshot was saved.

The portable packaged fixture and external `scripts/studio-browser-fixture.mjs` remain available for a stable native run. Run it in an interactive terminal, use only synthetic data and task-owned loopback servers, then send `close`. The first browser fixture's non-TTY tool session could not receive stdin; after verifying its exact command/PID, only that task-owned process was terminated, with exit143 and no remaining listener. The retry fixture accepted `close`, exited0 and left no listener. Monitor browser/DevTools windows may remain open because reliable window targeting was unavailable. No existing application process was signalled.

## Overhead and optional composition scope

[Overhead data](overhead.json) and [summary](overhead-summary.json) compare 20,000 identical bounded CPU operations without/with monitoring, three measured pairs after warmup. Settings: fixed `/fixture/:id` labels, 10% trace sampling, 512-item queue, batch128, one in-flight batch and 2ms injected sink delay; explicit GC and V8 sampled allocation were enabled.

Median disabled/enabled workload was **22.86/731.10ms**, throughput **874,771/27,356 operations/s**, user CPU **32.58/815.56ms**, sampled allocation **1.18/289.64MB**, and event-loop p99 **5.69/10.07ms**. Enabled post-cleanup RSS grew approximately **7.0–30.5MB** over each trial's initial sample; raw heap/RSS trends are preserved. Median drain/close was **5.30ms**, with zero owned timers afterward. This instrument-heavy, profiled microbenchmark shows substantial overhead for this workload. It is not a universal latency promise, leak verdict or production soak, and no invented release threshold was applied.

Accepted PM bytes were verified read-only: `@rawnode/pm@0.1.0`, **94,194 bytes**, SHA-256 `0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f`. [Fresh composition](pm-composition.json) covers direct/runtime/adapter/RuntimeAgent owner shapes, health/metrics, returned/on-disk diagnostic redaction, listener counts, idempotent detach/close and real child shutdown. PM installation did not alter Monitor. PM's historical 47 native/47 packed tests are not Monitor results; withdrawn `340b2fa87…` and older `f7e512c44…` evidence remain historical.

Prepared Events/Unified/Logger composition, live Redis/RawMongo/OTLP/StatsD interoperability/durability, full Foundation boot and production load remain unverified. Host HTTP deadlines, egress, injected-client TLS/ACLs and diagnostic output-root permissions remain deployment responsibilities. HMAC freshness is not nonce-based replay prevention.

## Publication blockers and later approval

`private: true`, `UNLICENSED`, First Principle Lab LLC ownership, the nonempty unresolved-license notice and rejecting guard remain intact. License/provenance, final namespace/version, the supported runtime/platform/browser matrix, remaining browser acceptance, production-load expectations and optional integration scope require owner decisions and corresponding execution. The original ISC declaration and empty LICENSE are evidence, not an invented grant. The [release checklist](RELEASE_CHECKLIST.md) specifies a later separately authorized process with fresh exact-byte verification after any release edit.

No publication, push, tag, deployment, daemon registration, live-production monitoring, incident notification, sibling-repository modification or original-application modification occurred. This handoff contains reviewable local fixes and verified package bytes; it does not claim the unexecuted production/browser gates passed.
