# RawNode Monitor readiness — 24 October 2026

**Engineering verdict: a reviewable hardened candidate, with passing Node/package gates. Publication remains blocked.** Real Chrome verification found and drove a repaired inspection/polling defect. Native operator-dialog acceptance remains incomplete because browser control became unreliable; this is an explicit acceptance gap, not a claimed pass. No known failing automated engineering gate remains.

The working tree was clean on `master` at `884a4974ba14d15a21ed4014bbe004ebf95384a7`, newer than the assignment's reviewed `0e4de7f` snapshot. Remote identity matches `git@github.com:ericsonweah/rawnode-monitor.git`. Existing repairs were preserved. `AGENTS.md`, original archives, provenance, historical receipts and the October 21 readiness directory remain unchanged.

## Exact final deliverable

- Archive: [final/artifacts/rawnode-monitor-1.0.0.tgz](final/artifacts/rawnode-monitor-1.0.0.tgz)
- SHA-256: `218b62b5fc0d99040b34761a975606bce397bcf26c2d59c3202300280ea70e31`
- Size: **206,728 bytes**, **176 files**, `@rawnode/monitor@1.0.0` (private, provisional).
- [Final audit](final/final-verification.json), [distribution inventory](final/distribution.json), [review patch](review.patch), [changed-file hashes](changed-files.json), [release checklist](RELEASE_CHECKLIST.md).

The earlier October 24 archive `dabc48241a20067dd7c69a6139258e27524c5136db5400579fa876b08c0e4593` (204,907 bytes) remains under this directory's `artifacts/` with its own receipts. Its browser inspection failure prompted the final replacement; its results must not be substituted for final results.

## Findings and changes

| Review lead | Disposition in this checkout | Evidence |
| --- | --- | --- |
| A: Studio failure sanitization | Already addressed at starting HEAD. Existing serializer/redactor handles authorized reads/mutations, authorizer and ingestion failures, cyclic/BigInt/oversized details, status/code and stack omission. | Studio security regressions; final HTTP/auth checks |
| B: Cancel operator actions | Already addressed at HEAD: each `null` prompt exits before mutation; intentional empty rule ID retains all-rules meaning. Model regressions verify each Cancel, success, validation, visible errors and stale action ownership. | Final bundled Studio action tests; native-dialog acceptance limit below |
| C: Health replacement identity | Already addressed: invalidated cache, identity-bound disposer, explicit unregister and late callback guard. | Health replacement/disposer/late-callback regressions and final suite |
| D: Exporter admission after close | Already addressed: own abort controller, continuation guards, pending exports and idempotent close. Standalone and runtime cases cover backoff, chunks, compression and active requests. | Existing 11 lifecycle regressions |
| JSONL initialization/drain | Already addressed: full write is registered before initialization yields; close stops admission and drains accepted operations. | Deferred-initialization and flush/drain regressions |

Three further defects were confirmed and repaired:

1. An HTTP acknowledgement timeout was automatically retried even though the receiver might already have accepted the payload. Timeout errors now set `retryable:false` and `details.delivery:"unknown"`.
2. A split export's acknowledged prefix was replayed when a later chunk failed and the pipeline retried the entire export. Per-operation acknowledgement counts now survive that failure and suppress whole-export replay. Errors report `acknowledgedSignals`/`unacknowledgedSignals`. Both new loopback tests failed before the repair, then passed; ordinary explicit HTTP retry behavior remains covered. Socket/aborted-response retry policy is otherwise unchanged: this is **not exactly-once delivery** or proof of durable persistence.
3. In actual Chrome, the trace detail visible at 02:57:35 disappeared at the next polling render. Trace, incident and full-diagnostic inspection now pause automatic refresh with an explicit resume control. Active filters, focused controls and expanded details are retained. Manual Refresh/navigation resumes updates. Two mocked-clock behavioral regressions cover the repair, and the final browser retained the trace across polling intervals.

Declarations now expose existing typed health registration/disposal and report counts/duration, `MetricRegistry.has()/names()` and `SyntheticMonitor.unregister()`. The operator token and authorization dialog have accessible labels. API, lifecycle, migration, Studio, validation, publication and changelog documentation were synchronized directly; the inspected generator was not run or allowed to append `any` declarations.

The 29 manifest entries (28 executable), 189 root names including default, ESM/Node >=22, capability injection and zero-dependency design remain. No capability group was removed. Runtime, Studio, bridge and host-server ownership remain distinct. Root import is passive; browser auto-mount remains separate. Non-cooperative injected work can outlive the library's bounded wait. HTTP timeout callers now receive a non-retryable uncertainty error; inspection retains a snapshot until resumed. These are the material behavior changes.

## Executed verification

Environment: macOS **15.8.1 Intel x64**, Node **v24.21.0**, npm **11.19.0**, explicitly installed TypeScript **5.9.3**. Node 22 was not present in inspected PATH/nvm/nodebrew/fnm/Volta/Homebrew locations; no compiler/runtime was downloaded and the engine floor was not raised.

| Gate | Final result |
| --- | --- |
| `npm run build` (native, extracted, installed) | Exit 0 each; 112 JavaScript files, 29 entries |
| `npm test` (same three trees) | **90 passed each; 0 failed, cancelled, skipped or todo** |
| `node examples/basic.mjs` (same trees) | Exit 0 each; ready/running |
| Strict `test/types.mts` and `test/exports-types.mts` | Exit 0 each tree; external fresh-consumer copies also pass |
| `npm run prepublishOnly` | Expected exit **1** in each tree; guard rejects |
| `npm pack --offline --json --pack-destination …` | Exit 0; prepack validates exact source |
| Fresh extraction and separate offline npm installation | Exact bytes match source/archive/each other; no symlinks or checkout fallback |
| Installed ESM package specifiers | All 29 entries resolve inside each fresh consumer; 28 executable imports, DOM-free client, unsupported private deep import rejected |
| Final loopback Studio HTTP/SSE | **33 checks passed**, owned fixture closed |
| Final bearer/HMAC ingestion | **19 checks passed**, owned fixture closed |
| Exact PM composition | Four owner shapes, **5/5 reciprocal tests**, actual task-owned child IPC, strict paired types |

Exact commands, cwd, timing and exits are in [consumer checks](final/consumer-checks.json), `final/logs/final-{native,extracted,installed}/commands.json`, `final/logs/distribution/commands.json` and composition logs. Type flags are `--noEmit --strict --module nodenext --moduleResolution nodenext --target es2022`; the all-entry consumer also uses `--resolveJsonModule`. Build/check/prepack share syntax/import/publication validation; there is no transpilation or lint script. Offline installation used `--ignore-scripts --no-audit --no-fund --package-lock=false` and a task-owned cache, followed by explicit build/guard checks. No dependencies were added to the candidate.

A fresh extraction of starting HEAD passed **86/86** tests. Initial sandbox runs reported `listen EPERM` for loopback cases; authorized reruns passed. An interim root rerun included the two new, then-failing exporter reproductions. Those failures and the intermediate archive are retained rather than relabeled as final passes. [Baseline/source review](head-baseline-and-exporter-review.json), [exporter investigation](exporter-review.json), [Studio investigation](studio-review.json).

The final audit re-extracted the tarball and checked every file against source and both consumers. It found no unintended machine paths, forbidden imports, secret-file paths or recognized private-key patterns; these scans are not universal secret detection. All **1,220** immutable baseline files match, including **866 original-file hashes**, distinct from the **169 historical candidate hashes**. The original 184,659-byte Monitor archive still hashes to `b246ee9eff0b3579f05c886f05ec485719bb1b4847c97c4eefa99dead480baad`.

## Actual browser coverage and limits

[Browser receipt](final/browser.json) binds observations to the final installed archive. Chrome reported **155.0.0.0** in its User-Agent; its full build could not be retrieved (the browser URL policy rejected `chrome://version`, with no bypass). The real packaged application rendered all eleven views, escaped synthetic markup, redacted trace/incident details, preserved inspection/filter focus, showed empty/loading/escaped-error/recovery states, and survived rapid delayed navigation and pending work during unmount. Twenty mount cycles left one stream; native EventSource reconnected after a server disconnect. Unavailable EventSource used actual fetch polling with no stream and increasing request counts. At 390×844, document/main width was 390 and the cards/navigation remained usable. Keyboard Tab moved from the labeled span filter to the labeled outcomes select. Captured error/warning logs were empty in the successful inspection query. This is not a screen-reader audit or a multi-browser matrix.

![Final Chrome inspection pause and resume control](final/studio-inspection.jpg)

Native prompt acceptance is **incomplete**. Intermediate browser cancellation attempts left mutation/silence counts at zero. Final native control subsequently produced unexpected acceptances while attempting cancellation and retained a stale “prompt active” state even when dismissal returned “No dialog is showing”; closing/navigation was then blocked by the controller. These ambiguous inputs are not treated as product failures or passing Cancel tests. A portable wrapper now records unchanged native `window.prompt` returns for a stable future acceptance run. Each final native Cancel, deliberate silence/removal/resolution, and mutation-failure-feedback scenario still needs independent browser completion. Automated final-package fixtures cover those exact behaviors. No bearer token was put in a URL or persistent storage, and origin guards were never relaxed to accommodate automation.

All task-owned Studio processes were closed through stdin and exited 0. The temporary viewport override was reset. Only task-created browser tabs were used; existing user tabs were not edited.

## Overhead and composition scope

[Final overhead data](final/overhead.json) compares 20,000 identical bounded synthetic CPU operations with monitoring absent/present, three measured pairs after warmup. Settings: fixed `/fixture/:id` labels, 10% trace sampling, 512-item/2 MiB queue, batch 128, one in-flight batch, 2 ms injected sink delay, explicit GC and V8 sampled allocation. Machine: Intel i9-8950HK, 12 logical CPUs, 32 GiB RAM.

Median disabled/enabled workload time was **27.38/911.25 ms**, throughput **730,374/21,948 operations/s**, CPU **39.8/1,032.3 ms**, sampled allocation approximately **0.97/285.21 MiB**, event-loop p99 **7.06/10.81 ms**. Enabled post-cleanup RSS deltas ranged **7.27–26.29 MiB** (three short trials); raw trends are retained. Drain/close median was **5.43 ms**, with zero queued records, waiters, drops or owned runtime timers afterward. Profiling and the harness perturb these numbers. This instrument-heavy microbenchmark is not a production soak, a memory-leak verdict, or a universal overhead promise; production workload sizing remains an owner gate.

Accepted PM bytes were verified read-only before use: `@rawnode/pm@0.1.0`, **94,194 bytes**, SHA-256 `0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f`. Fresh composition checked direct/runtime/adapter/RuntimeAgent shapes, health/metrics, returned and disk diagnostic redaction, listener counts, detach/close and real child shutdown. PM installation left Monitor bytes unchanged. PM's historical 47 native/47 packed tests are not Monitor results. Withdrawn `340b2fa87…` and older `f7e512c44…` remain historical only.

## Publication blockers and next decisions

`private:true`, `UNLICENSED`, First Principle Lab LLC ownership, the nonempty unresolved-license notice and rejecting guard are preserved. The original root's ISC declaration plus empty LICENSE is provenance evidence, not a grant. The owner must resolve license/provenance and final namespace/version; choose and execute the supported Node/platform/browser matrix (including Node 22 and remaining native browser actions); approve production load expectations and optional integration scope. Prepared Events/Unified/Logger, live Redis/RawMongo/OTLP/StatsD interoperability/durability, full Foundation boot and production soak remain unverified. Trusted injected clients, TLS/ACLs, HTTP transport deadlines, egress and diagnostic output-root permissions remain host responsibilities. HMAC freshness is not nonce replay prevention.

[The release checklist](RELEASE_CHECKLIST.md) defines a separate later approval process. Nothing was published, pushed, tagged, deployed or registered as a daemon. No live production monitoring, incident notifications, sibling-repository edits or original-application modifications occurred. Local task-owned fixtures, temporary consumers and the explicitly permitted read-only PM archive were the only integration inputs.
