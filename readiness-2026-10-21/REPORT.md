# RawNode Monitor readiness report — 2026-10-21

**Verdict: engineering fixes and local distribution verification are complete for this Node 24/macOS candidate; ready for owner review, not publication-ready.** Real-browser acceptance, the Node 22 floor/other platforms and production load remain unverified. License/provenance and release identity still require owner decisions. No publication was attempted.

The final `@rawnode/monitor@1.0.0` archive is [artifacts/rawnode-monitor-1.0.0.tgz](artifacts/rawnode-monitor-1.0.0.tgz): **202587 bytes, 175 files**, SHA-256 **`e32c999d758434c58e5abea0a1fa055c5d0b3450e4e1e34e7d6ad76fb6be74d7`**. Version 1.0.0 remains provisional. [distribution.json](distribution.json) records all file hashes, pack metadata, exact temporary consumers and inspections. [final-verification.json](final-verification.json) consolidates the final gates.

## Scope, fixes and compatibility

Work began on `master`, commit `0e4de7f5acf5698918b1938d0cc4e46ad65645eb`, with remote `git@github.com:ericsonweah/rawnode-monitor.git`. Only the supplied root instruction/prompt files were initially untracked. `AGENTS.md` existed and was read without modification. Readiness verification completed before commit/push. The owner subsequently authorized committing and pushing these deliverables; see the repository-push addendum below. Historical `DELIVERY.md`, `evidence/`, `artifacts/` and `provenance/` were preserved; all **866 original-file hashes**, **169 historical candidate-file hashes** and **933 immutable task-input files** matched. The original ISC declaration and empty original LICENSE remain provenance, not a grant. Candidate `private: true`, `UNLICENSED`, nonempty unresolved-license notice, First Principle Lab LLC ownership and rejecting publication guard remain intact.

| Review lead | Disposition and resulting behavior | Focused regression |
| --- | --- | --- |
| A: Studio failures | Confirmed and repaired. Existing serializer/redactor covers read, mutation, authorizer and ingestion failures. Safe HTTP status and sanitized code survive; bearer/secret fields redact, cyclic/BigInt/oversized details serialize, stacks stay absent. | `package/test/studio-security-regression.test.mjs` |
| B: Cancel mutations | Confirmed and repaired. Each Cancel terminates the action. Empty submitted silence rule ID intentionally means all rules. Duration validation, visible failures, duplicate prevention and pending navigation/destroy ownership are covered. | `package/test/studio-actions.test.mjs` |
| C: Health identity | Confirmed and repaired. Replacement clears TTL metadata/cache; an old disposer or late callback cannot remove/cache for the replacement. Explicit unregister retains name semantics. | `package/test/readiness-lifecycle.test.mjs` |
| D: Export after close | Confirmed and repaired for direct and runtime-owned exporters. Owned abort and admission tracking stop retry, split and compression continuations; active requests settle and owned connections drain. Already acknowledged chunks stay counted. | `package/test/readiness-lifecycle.test.mjs` |
| Adjacent JSONL drain | Confirmed and repaired. Admission is recorded before initialization yields; close stops new admission and drains earlier writes across kinds. Flush snapshots admitted operations. | `package/test/readiness-lifecycle.test.mjs` |

Additional reproduced fixes: matching 52-bit ratio-sampling bound; correct async context binding; malformed baggage-key handling; one `unmatched` route label without a template; retired resource cache/event suppression; coalesced Redis subscription startup and late disposal; finite cluster timestamp validation; alert context/rule/notification/incident deadlines and stale-result suppression; bounded nonoverlapping notification sends and safe optional-channel error reporting. Cross-review caught and repaired cleanup skipped by pre-aborted close and stale actions retaining polling ownership.

Concrete envelope/span/tracer declarations and all-entrypoint type consumers now match actual runtime shapes. Fractional sampling can retain fewer spans than before; unmatched labels become bounded; inaccurate timestamp/envelope declarations can reveal consumer errors. Public names, default/root exports, all capability groups, 29 map entries/28 executable entries and 189 root names remain. No dependencies, CommonJS distribution, executable or wildcard/deep-import contract was added.

Monitor still embeds in its host and owns no server/process manager. Import is passive; construction registers definitions/listeners; start and terminal close are explicit. Studio, bridges and host servers have separate owners. Close cannot undo a server-accepted mutation, telemetry received remotely, or non-cooperative injected work. File errors remain observable to write callers; close drains rather than silently discarding admissions. HTTP statistics indicate 2xx acknowledgement, not remote durability.

## Executed verification

Environment: macOS **15.8.1**, Intel x64 Core i9-8950HK 2.90 GHz, 12 logical CPUs, 32 GiB RAM; **Node v24.21.0**, **npm 11.19.0**, **TypeScript 5.9.3**. No Node 22 binary was found in PATH or the inspected nvm/nodebrew/Homebrew locations. No compiler was fetched. Browser tool inventory returned **`apps: [], browsers: []`**; no browser/version or screenshot is available.

| Gate | Actual result | Evidence |
| --- | --- | --- |
| Untouched historical archive | Fresh extraction; original suite 52 pass, 0 fail/cancel/skip | `logs/historical-baseline/` |
| Final native suite | 86 pass, 0 fail/cancel/skip | `logs/final-native/` |
| Exact extracted suite | 86 pass, 0 fail/cancel/skip on isolated full rerun | `logs/final-extracted-isolated/` |
| Exact offline-installed suite | 86 pass, 0 fail/cancel/skip | `logs/final-installed/` |
| Build, basic example, baseline and expanded strict types | Exit 0 in all three final trees; 112 JS files checked | `logs/final-{native,extracted,installed}/` |
| Explicit publication guard | Expected exit 1 in all three trees | Their `guard.txt` and `commands.json` |
| Package installation and exports | Offline local npm install, scripts disabled; both external consumers resolve all 29 entries including metadata; DOM-free client; private deep import rejected | `logs/distribution/`, `distribution.json` |
| Exact installed Studio fixture | 33 actual HTTP/SSE checks pass: shell/assets, APIs, trace redaction, modes, stream signal/disconnect/manual reconnect and cleanup | `studio-final-smoke.json` |
| Optional ingestion and token security | 19/19 actual HTTP checks pass: exact raw HMAC/redaction, malformed/missing/stale/tampered authentication, >1 MiB body, unknown kind, bearer shell/assets and origin checks; fixture fully closed | `ingest-auth-final-smoke.json` |
| Exact accepted PM composition | Four owner shapes, strict paired types and 5/5 reciprocal cases including real task-owned child IPC; returned/disk diagnostics redact; listeners/detach/close clean up | `pm-composition.json`, `logs/pm-composition/` |

Commands are retained as arrays with cwd, versions, exits and timing in each `commands.json`. Native commands were `npm run build`, `npm test`, `node examples/basic.mjs`, baseline `tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 test/types.mts`, expanded `test/exports-types.mts` with `--resolveJsonModule`, and `npm run prepublishOnly`. Packing ran `npm pack --offline --json --pack-destination …`; installation used `--offline --ignore-scripts --no-audit --no-fund --package-lock=false` and an owned cache. Extracted materialization is labeled separately from installation. Installed/extracted file contents match the final checkout/archive; installed specifiers resolve inside their own `/private/tmp` consumers, without workspace links. Archive scans found required assets/types/config/docs/examples/tests and no unexpected secret/key/cache files, machine home paths or original-application imports; these pattern checks are not universal secret detection.

Initial sandbox loopback failures were `EPERM`; explicit escalated reruns succeeded. An initial concurrent extracted run passed 85/86: a pre-existing stalled-sink test exceeded its 300 ms flush deadline while three complete suites ran concurrently. The full isolated rerun passed 86/86 without changing bytes; the failed receipt remains in `consumer-checks.json`. Reproduction now serializes whole suites. Early pack-output parsing and ESM-only benchmark-resolution harness errors were repaired; the benchmark's initial error is retained separately. The supplemental ingestion harness also corrected a success-response size cap and a null-prototype stats-map comparison; both initial failure receipts are retained as `ingest-auth-harness-{limit,prototype}-failure.json`, followed by the complete 19/19 pass. These were harness-only changes; package bytes stayed unchanged. No remaining confirmed functional defect from these investigations is known; deadline-test sensitivity under workstation contention remains a verification limitation.

Historical PM accepted pin **`0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f`**, **94194 bytes**, was verified read-only before offline installation. Monitor bytes stayed unchanged after PM installation. Fresh composition is tied to the new Monitor hash; historical withdrawn `340b2fa87…` and older `f7e512c44…` results were not reused. PM's historical 47 native/47 packed tests were not rerun or counted as Monitor tests.

## Observed overhead and acceptance limits

[overhead.json](overhead.json) retains three measured pairs after warmup: 20000 identical synthetic compute operations per leg, fixed `/fixture/:id`/GET labels, 10% tracing, event every 16 operations, 512-item/2 MiB queue, 128-record batches, one in-flight batch, 2 ms injected sink delay, drop-oldest policy and no outbound exporter. V8 allocation sampling at 32768 bytes includes collected objects; measurement adds overhead to both legs. Medians:

| Measurement | Monitoring absent | Monitoring enabled |
| --- | ---: | ---: |
| Workload elapsed | 25.09 ms | 1008.30 ms |
| Throughput | 797204 ops/s | 19835 ops/s |
| CPU user/system | 35.53 / 1.29 ms | 966.85 / 32.32 ms |
| Sampled allocation estimate | 0.97 MiB | 279.02 MiB |
| RSS change during work | 0.14 MiB | 9.75 MiB |
| Event-loop p99 | 7.07 ms | 15.77 ms |
| Drain and close | effectively zero | 5.96 ms |

Enabled trials delivered 3206/3216/3254 records to the injected sink, with zero reported drops, empty closed pipelines and zero owned runtime timers. Heap/RSS trends and post-GC cleanup samples are retained; this short run does not establish absence of long-term leaks. The measured instrumentation cost is material for this tiny fixture (about 40× elapsed time), not evidence of negligible overhead. There is no invented release threshold or production latency/soak claim.

Real-browser rendering, all navigation/action acceptance, native EventSource reconnect/polling fallback, CSP presentation, narrow layouts, keyboard/focus and assistive technology remain **unverified**. Modeled action/DOM tests and HTTP/manual SSE reconnect do not replace them. Node 22/other platforms, production soak, prepared Events/Unified/Logger, live Redis/RawMongo/OTLP/StatsD protocol/durability and full Foundation boot remain distinct unverified scopes. OTLP JSON formatting, socket sends and injected contracts do not prove backend interoperability.

## Owner decisions and deliverables

See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for ordered later release steps. The owner must resolve license/provenance; final scope/namespace/version; Node/OS support; browser acceptance; production performance expectations and optional integration scope. These are separate from completed engineering. The final source, focused regressions, synchronized package docs/declarations, archive, scripts and hash-linked receipts are local and reviewable. Reproduce from the repository root with `node readiness-2026-10-21/scripts/distribution.mjs`, then the corresponding `node readiness-2026-10-21/scripts/final-consumers.mjs`, `run-pm-composition.mjs`, `studio-final-smoke.mjs`, `ingest-auth-final-smoke.mjs` and `audit-final.mjs` (all under that same scripts directory); loopback legs require the corresponding environment permission. Repacking creates fresh consumers and must be followed by all required gates against its resulting hash.

[review.patch](review.patch) captures all 34 changed package files (28 modified, six added); [changed-files.json](changed-files.json) records their hashes. The root instruction files and historical material are excluded from that patch.

**During readiness validation, no publication, push, tag, deployment, daemon registration, live-production monitoring, sibling-repository edit or original-application modification occurred.** Publication remains blocked by metadata and the rejecting guard.

## Repository-push addendum

The owner subsequently requested: “Let's push it to the repository.” This authorizes a local readiness commit and an ordinary push to the existing origin/master branch, subject to its current remote state. It does not authorize npm publication, tagging, deployment, daemon registration, production monitoring or sibling/application changes. Task-owned npm cache and redundant historical extraction are excluded from Git; the original archive remains tracked, and the audit script reconstructs its extraction when needed. Package bytes and their verified hash remain unchanged. The final push outcome and commit identity are reported separately after Git confirms the update.
