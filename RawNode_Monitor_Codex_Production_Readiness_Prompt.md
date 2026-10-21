# RawNode Monitor — Codex Production and Publication Readiness Assignment

## Objective and working location

Take this existing standalone npm candidate through implementation, focused regression tests, documentation repair, real-interface validation, and verification of its final package. Deliver a reviewable, production-quality candidate and an evidence-based publication-readiness assessment. **Do not publish it.** Complete the engineering work; an audit or proposed plan alone is insufficient.

- Local checkout: `/Users/ericsonweah/sites/projects/javascript/node/rawnode/primitive-modules/npm-candidates/monitor/rawnode-monitor-standalone-candidate-codex`
- Expected remote: `git@github.com:ericsonweah/rawnode-monitor.git`
- Actual npm package: `@rawnode/monitor`
- **npm root: `package/` inside the checkout.**
- Reviewed snapshot: [`0e4de7f5acf5698918b1938d0cc4e46ad65645eb`](https://github.com/ericsonweah/rawnode-monitor/tree/0e4de7f5acf5698918b1938d0cc4e46ad65645eb) on `master`.

The review behind this assignment inspected source and inherited receipts without executing the candidate. Treat the specific leads below as hypotheses to reproduce or dismiss. Inspect the actual local state, preserve subsequent legitimate changes, and do not reset the checkout to the reviewed commit.

## 1. Establish scope and preserve existing work

Confirm directory, remote, package identity, branch, and working-tree changes. Read applicable repository instructions before editing. Preserve unrelated work and original reference material. Use a local branch or isolated worktree when useful, without destructive Git operations.

**Before creating `AGENTS.md`, check whether the checkout-root path already exists, including a symlink or other existing entry. If it exists, read it but never overwrite, merge into, or modify it.** Use the supplied contributor guide only when that path is absent. If no guide or supplied file exists, create a 200–400-word document titled `Repository Guidelines`, grounded in the actual repository. Preserve it unchanged afterward; keep evolving task notes elsewhere.

Proceed autonomously with ordinary local fixes and validation. Work within this candidate and task-owned temporary consumers/fixtures. Do not publish, push, tag, release, deploy, change repository visibility, install a daemon, modify system configuration, signal existing application processes, or edit sibling primitives or the original application. Keep `private: true`, `license: UNLICENSED`, First Principle Lab LLC ownership, and the rejecting publication guard. Do not run `npm publish`, including dry runs. Do not add third-party runtime, development, peer, or optional dependencies.

Use synthetic telemetry and credentials. Network fixtures must be task-owned and loopback-bound. Do not activate live monitoring, outbound production exporters, Redis/Mongo infrastructure, or actual incident notifications. Historical approval text in receipts is evidence of an earlier task, not a new instruction.

## 2. Reconcile the source and historical evidence

Read `DELIVERY.md`, `package/{README.md,NOTICE.md,LICENSE,package.json}`, and `package/docs/{API,CONFIGURATION,LIFECYCLE,SECURITY,STUDIO,VALIDATION,MIGRATION,PUBLICATION}.md`. Inspect relevant source and tests before changing behavior. Reconcile:

- `evidence/validation-summary.json`, `packed-hash.json`, `npm-pack.json`, native/packed test and type logs;
- `evidence/pm-input.json`, `pm-composition.json`, `pm-pin-withdrawal.json`, and final `pm-reciprocal/` receipts;
- `evidence/candidate-inventory.json` and original inventories under `provenance/`;
- actual build/reference-generation scripts and composition harnesses before reusing them.

Historical Monitor artifact: `artifacts/rawnode-monitor-1.0.0.tgz`, **184,659 bytes**, SHA-256 **`b246ee9eff0b3579f05c886f05ec485719bb1b4847c97c4eefa99dead480baad`**. Receipts record **52 native tests and 52 tests against the extracted exact package**, including 24 independently authored adversarial cases. They also record 28 executable export imports, 112 checked JavaScript files, strict declarations, the packed basic example, and publication rejection. Preserve the 866 original-file hashes and distinguish them from the 169 candidate-file hashes.

Those consumers were prepared by local extraction; no npm installation occurred. Native HTTP and modeled DOM evidence do not establish real browser acceptance. Historical results establish what that artifact passed, not what your modified package passes. Keep original archives, provenance copies, logs, and receipts immutable; put new evidence in a distinct task-owned directory.

## 3. Preserve the actual product and public contract

The candidate is ESM JavaScript, Node `>=22`, with zero declared dependencies. Preserve its core Node/vanilla design, explicit capability injection, and current module boundaries. The runtime embeds in its host and owns no HTTP server or process manager. Root import is passive. Construction, startup, shutdown, and browser auto-mounting are distinct behaviors; document them accurately.

Preserve `MonitorRuntime`, `MonitorManager`, root/default exports, all documented capability groups, and the manifest's actual **29 entries including metadata, 28 executable entries**. The historical root inventory has 189 names including default. There is no wildcard export map; do not invent supported private deep imports or a new dual CommonJS distribution. `/console` exposes command classes, not an advertised npm executable. `/provider` is optional Foundation integration, and `/config` remains explicitly configurable.

Retain metrics, tracing/context/sampling, health, resources, signal queues, memory/file/injected/composite storage, exporters, alerts/silences/notifications, SLOs, incidents/runbooks, anomaly/leak/correlation analysis, synthetics, plugins, fleet/Redis adapters, deployment markers, diagnostics, and existing integration adapters. Fix actual behavior without replacing working capabilities with simplified examples.

**Monitor Studio is a real retained browser application.** Preserve its JS/CSS, page/assets, route/controller/manager/authentication layers, and `/studio/client`. Preserve `mountMonitorStudio()` and its refresh/navigate/snapshot/destroy contract, DOM-free import, and intended auto-mount behavior. Existing navigation covers overview, health, metrics, traces, resources, alerts, SLOs, incidents, fleet, deployments, and diagnostics. Additional server routes do not automatically require new navigation views.

## 4. Establish the current baseline

Inspect scripts, then run from `package/`, recording exact commands, tools, exits, counts, and bounded failures:

```bash
npm run build
npm test
node examples/basic.mjs
```

`npm run check` and `prepack` use the same `scripts/check.mjs` validation as build; build is not transpilation. There is no lint script. Run `npm run prepublishOnly` directly and record its intended nonzero rejection; do not disable the guard.

Use an explicitly available TypeScript compiler, historically 5.9.3:

```bash
tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 test/types.mts
```

Do not fetch an unpinned compiler through `npx` or install TypeScript/`@types/node` into the candidate. Missing tooling is a precise verification gap; complete unrelated work. Inspect `scripts/generate-reference.mjs` before use: it rewrites API/configuration documentation and declarations, and can append missing symbols as `any`. Generation success and symbol counts do not prove consumer correctness.

## 5. Reproduce and resolve four focused review leads

For each lead, record confirmed-and-repaired, already addressed, dismissed with evidence, or blocked with a specific reason. Add deterministic regressions for confirmed behavior defects. These are source-based investigations, not assertions that this review executed failures.

### A. Sanitize Studio failure responses through the existing boundary

Inspect `src/studio/MonitorStudioController.js`, `support.js:errorRecord()`, and the serializer/redactor. Successful read/mutation responses call `sanitizeTelemetry()`, while the reviewed `failure()` path sends `errorRecord()` directly to JSON. Its message/details can bypass redaction and size limits; cyclic or BigInt details can also break error reporting itself.

Use authorized synthetic read and mutation requests whose controlled capability throws a stable code/status, a recognized bearer-token message, and secret-keyed details. Separately cover oversized, cyclic, and BigInt details. Require bounded, redacted, serializable JSON, useful safe status/code, no stack disclosure, and no secondary serialization failure. Check other responses that share this boundary, including ingestion errors. Reuse existing security policy and serializer; do not promise universal secret detection or invent a second serialization framework.

### B. Make Cancel terminate Studio operator actions

Inspect `resources/assets/js/monitor/studio.js`, especially `bindAlertActions()` and `bindIncidentActions()`. Reviewed prompt handlers turn `null` into defaults, then submit a mutation. Cancelling a silence dialog can produce an all-rules silence; cancelling an incident-resolution note can still resolve the incident.

Cancel each silence prompt independently and cancel incident resolution. Assert zero mutation requests and unchanged state. Distinguish `null` cancellation from a deliberately submitted empty rule ID, whose documented all-rules meaning may remain. Verify successful intentional actions, sensible input validation, visible request failures, and navigation/unmount while an action is pending. Retain server authorization/origin checks. Confirm the repaired behavior in the actual browser, as well as focused automated fixtures.

### C. Preserve health-check registration identity

Inspect `src/health/HealthRegistry.js`. In the reviewed code, replacing a check leaves its name-keyed TTL cache intact, and the old registration's disposer unregisters by name. This can reuse old healthy/critical metadata or remove the new registration.

Register and cache a healthy critical dependency, replace it with an unhealthy check with zero cache TTL, then call ordinary readiness without `fresh: true`. Require the replacement to run and its actual result/metadata to govern readiness. Invoke the old disposer and require the replacement to remain; its own disposer must remove it. Keep explicit `unregister(name)` semantics. Cover a delayed old callback and preserve the existing identity guard that prevents it from populating the replacement's cache. No long sleep or external service is needed.

### D. Prevent exporter work from restarting after close

Inspect `src/exporters/HttpJsonExporter.js` and `support.js:retry()`. The reviewed exporter checks `closed` only at `export()` entry. Split batches, compression continuations, and retry callbacks can resume later; `_request()` has no lifecycle check, while `close()` marks closed and destroys its agent.

Use controlled barriers and task-owned loopback responses to close during retry backoff, between split chunks, and with an active request. Verify no new request/chunk admission after close, bounded caller settlement, released owned connections/listeners/timers, and repeated-close safety. Keep ordinary pre-close retry behavior and honest accounting of accepted, failed, or uncertain partial delivery. Do not claim shutdown undoes telemetry already received remotely. Test direct public exporter use as well as runtime-owned use; a runtime cancellation signal must not conceal a standalone lifecycle defect.

As an adjacent storage check, inspect `JsonlTelemetryStore.writeMany()/close()`: initialization precedes registration of write chains, while close waits only on the current chain snapshot. A deferred initialization fixture should establish whether an admitted write can outlive reported close. Define and verify the admission/drain boundary without discarding accepted data silently. Keep this focused on actual lifecycle behavior.

## 6. Complete targeted runtime, data, and performance hardening

Credit and preserve existing repairs: coalesced starts/collections, terminal close, startup cancellation, bounded stuck-callback concurrency, ignored late observations, metric handle invalidation/cardinality accounting, synthetic replacement identity, partial-write detection, and independent cleanup. Follow concrete failures rather than expanding into an unrelated rewrite.

- **Metrics/traces/health:** verify units, monotonic durations, reset/removal, label normalization, global/per-instrument cardinality, overflow policy, bounded histories/span retention, sampling/context propagation, and readiness/liveness distinctions. Use route templates rather than request-specific labels. Trusted low-level inputs can legitimately produce definition/type errors; do not impose an undocumented hostile-JavaScript sandbox.
- **Pipeline/storage:** verify item/byte accounting, overflow/drop reasons, queued waiters, cancellation, required versus optional sinks, partial acknowledgements, flush semantics, and error visibility. Unknown timed-out writes must not be blindly retried. File storage needs bounded scanning, rotation/retention, meaningful I/O errors, and cleanup. Composite acknowledgement must reflect the required/durable store contract, not merely a successful memory write.
- **Plugins/integrations/resources:** preserve observer cleanup and ownership, no overlapping stuck callbacks, bounded notifications, late-result suppression, and safe replacement/disposal. Monitor, Studio, bridges, and host servers have distinct lifecycles. Shutdown must not signal unrelated processes, close a borrowed service indiscriminately, or resurrect timers. Injected callbacks/clients may remain active if they ignore cancellation; report that limitation accurately.
- **Exporters/synthetics/fleet:** retain opt-in destinations, response/payload limits, credential-safe redirects, deadlines, cancellation, concurrency, and lease/envelope rules. Distinguish a socket send, accepted queue entry, HTTP acknowledgement, and durable persistence. OTLP-JSON formatting and injected Redis/RawMongo contracts do not prove full protocol interoperability or live backend durability.

Add a bounded representative overhead check when needed to substantiate performance claims: compare the same fixture with monitoring disabled/enabled, identify sampling/labels/queue/sink settings, and measure CPU, allocation/RSS trend, event-loop delay, throughput, and cleanup under controlled sink delay. Use core Node facilities. Report machine/workload details and observed results; do not invent universal latency promises or arbitrary release thresholds. Stop expanding tests once concrete risks and required gates are resolved.

## 7. Validate actual Studio behavior and security

Use `examples/studio-fixture.mjs` from the final exact package in a task-owned loopback environment with synthetic telemetry. Inspect its controls first; it accepts `close` on stdin and has a 15-minute TTL. It is a validation fixture, not a production server. Check current browser availability; the historical unavailable-browser receipt does not describe the new environment.

Exercise the real browser's packaged HTML/JS/CSS, all existing navigation views, trace details, operator actions and cancellation, empty/loading/error/recovery states, rapid navigation with pending requests, repeated mount/destroy, single polling/stream ownership, native SSE reconnection, and polling fallback. Verify escaping, redaction, CSP-compatible presentation, narrow layouts, keyboard/focus behavior, accessible labels/status feedback, and console/network errors. Record browser/version and concise evidence tied to the artifact. If browser access is unavailable, complete independent engineering, retain the portable fixture, and explicitly leave real-browser acceptance unverified. Modeled DOM or successful asset requests cannot replace it.

Preserve socket/Host loopback authorization, origin/CSRF enforcement for reads and mutations, custom-authorizer behavior, rate/client/queued-byte limits, and explicit proxy trust. Token-required sessions use in-memory tokens and polling; never move bearer tokens into URLs or persistent browser storage. Protected shell/assets need an appropriate authenticated proxy/session or custom authorizer; a token entered after page load does not authorize the initial navigation.

Remote ingestion stays disabled by default. If exercising its optional path locally, use synthetic HMAC keys and verify raw-body/timestamp authentication, bounded body handling, malformed signatures, and unknown signal kinds. Freshness/authentication is not nonce-based replay prevention. Preserve redaction in runtime output, Studio success/error responses, exported telemetry, and returned/on-disk diagnostic bundles according to documented boundaries. Bundle output roots remain trusted filesystem authorities. Host HTTP deadlines, egress policy, and injected-client TLS/ACLs remain host responsibilities.

## 8. Verify the exact distribution and optional compositions

Historical runtime testing used macOS 15.7.9 Intel, Node 24.21.0, npm 11.19.0. Exercise the declared Node 22 floor and Node 24 where available, recording exact versions and unavailable legs. Use bounded task-owned fixtures and existing CI infrastructure if appropriate; do not silently raise the engine requirement or fabricate other-platform passes.

After package changes, inspect packing hooks and run local `npm pack --offline` from `package/`, placing the archive outside the packed tree. Keep the historical archive unchanged. Record the new hash, bytes, package identity, packed file count, source provenance, and tool versions. Inspect contents for required runtime/declarations/browser assets/config/docs/examples, unintended secrets or machine paths, and imports that depend on the original application. Preserve deliberate distribution contents unless there is a justified packaging correction.

Prepare a clean extraction and a fresh minimal consumer using the same archive, including a local/offline npm installation with lifecycle scripts controlled when available. Label extraction and installation accurately. Compare file paths/content against the archive and ensure resolution cannot fall back to the checkout, workspace links, siblings, or stale `node_modules`.

Run the complete native suite and relevant regressions from artifact consumers, the basic example, build/check, strict types, publication rejection, and actual installed package-specifier resolution for every manifest entry. Exercise `/studio/client` with and without a DOM as appropriate, and the real browser separately. `check.mjs` imports source URLs and skips that client's runtime import; it alone does not prove installed exports or browser correctness. Expand declaration consumers beyond the current root/Studio/provider/config/client subset. Preserve intentional broad extension types while fixing concrete runtime/type mismatches.

**PM composition:** the current accepted historical input is `@rawnode/pm@0.1.0`, 94,194 bytes, SHA-256 `0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f`. The repository does not bundle it. Its historical location is `/Users/ericsonweah/Documents/Codex/2026-10-02/task-3/artifacts/rawnode-pm-0.1.0.tgz`; inspect available exact bytes read-only and verify identity before use. Do not substitute a latest package, edit PM, or reuse withdrawn `340b2fa87…` evidence as current. `f7e512c44…` is also historical.

Inspect/adapt `evidence/pm-composition.mjs` and reciprocal harnesses for fresh consumer paths and the new Monitor hash. Verify bridge owner shapes, health/metrics, returned and disk diagnostic redaction, listener counts, and idempotent detach/close. The five reciprocal cases and real child IPC are attributed to the PM lane; its 47 native/47 packed tests are not Monitor tests. If exact PM bytes are absent, report the composition gap and finish other gates. Prepared Events, Unified/Logger, live Redis/RawMongo/OTLP/StatsD, and full Foundation boot remain distinct integration scopes; do not claim them from models or historical intent.

If packaged bytes change after verification, repack and rerun required artifact checks against fresh consumers of the final archive. Keep old results associated with their original hashes. Store new reports outside the packed tree to avoid a self-changing verification target.

## 9. Final documentation, deliverables, and verdict

Leave coherent local fixes, meaningful regressions, synchronized declarations/docs, the fresh tarball, and reproducible evidence. Update current documentation that still treats PM composition as merely future work, while preserving historical receipts and distinguishing the new result from the old exact pin.

Produce a concise readiness report and release checklist covering:

1. Changes/reasons, each review lead's disposition, public compatibility, and ownership/lifecycle decisions.
2. Commands, runtime/compiler/browser versions, pass/fail/cancel/skip counts, meaningful errors, and evidence paths tied to the final archive hash.
3. Real browser, runtime/type, package, overhead, and composition coverage; separate actual results, models, unavailable tooling, and untested services.
4. Remaining defects and owner decisions, clearly distinguished from completed engineering work.
5. Exact proposed release steps for later approval, with publication still blocked.

Preserve the candidate's **UNLICENSED metadata and nonempty unresolved-license notice**. The original root declared ISC with an empty original LICENSE; do not convert that into an invented grant. First Principle Lab LLC ownership remains explicit. Version `1.0.0` is provisional. Finish independent engineering work, then list owner decisions on license/provenance, final namespace/version, supported runtime/platform matrix, browser acceptance, and optional integration scope.

End with a clear engineering-readiness verdict and publication blockers. State what was actually executed, what remains unverified, and that no publication, push, tag, deployment, daemon registration, live-production monitoring, or sibling/application modification occurred. Supply the final archive path/hash and report/evidence paths. Make every readiness claim no stronger than its supporting evidence.

### Pinned source references

- [Package manifest](https://github.com/ericsonweah/rawnode-monitor/blob/0e4de7f5acf5698918b1938d0cc4e46ad65645eb/package/package.json), [delivery report](https://github.com/ericsonweah/rawnode-monitor/blob/0e4de7f5acf5698918b1938d0cc4e46ad65645eb/DELIVERY.md), and [validation summary](https://github.com/ericsonweah/rawnode-monitor/blob/0e4de7f5acf5698918b1938d0cc4e46ad65645eb/evidence/validation-summary.json).
- [Studio controller](https://github.com/ericsonweah/rawnode-monitor/blob/0e4de7f5acf5698918b1938d0cc4e46ad65645eb/package/src/studio/MonitorStudioController.js), [Studio client](https://github.com/ericsonweah/rawnode-monitor/blob/0e4de7f5acf5698918b1938d0cc4e46ad65645eb/package/resources/assets/js/monitor/studio.js), [health registry](https://github.com/ericsonweah/rawnode-monitor/blob/0e4de7f5acf5698918b1938d0cc4e46ad65645eb/package/src/health/HealthRegistry.js), and [HTTP exporter](https://github.com/ericsonweah/rawnode-monitor/blob/0e4de7f5acf5698918b1938d0cc4e46ad65645eb/package/src/exporters/HttpJsonExporter.js) behind the unexecuted review leads.
