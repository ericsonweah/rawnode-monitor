# R6 resolution and replacement artifact review

Date: 2026-10-02. Reviewer scope: the focused LogMultiplexer shutdown fix, its regression tests, the scale --instances compatibility fix, and exact replacement package/source correspondence. Candidate and previous reports remained unchanged. Only this evidence report was written. No application/service process, network request, source startup, installation, or signal was executed by the reviewer.

## Exact artifact

- Package: `@rawnode/pm@0.1.0`.
- Replacement: `artifacts/rawnode-pm-0.1.0.tgz`.
- SHA-256 independently checked from readable bytes: `0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f`.
- Size independently checked: 94,194 bytes.
- All 122 regular files inside the archive were compared byte-for-byte against their corresponding current candidate files: 122 compared, zero mismatches, zero missing candidate files. No archive content was executed or extracted by the reviewer.
- Withdrawn predecessor: SHA-256 `340b2fa87b9ba4a1f18631f75af1c9d056f0e1b1df590f012a8eb6eb435aed33`, 93,266 bytes. Its historical review remains in `adversarial-final-review.md` and must not be read as the replacement artifact's final disposition.

## R6 disposition: resolved within reviewed scope

`candidate/src/logs/LogMultiplexer.js` now creates `pendingDetaches`, returns the same pending completion for repeated detach of a record, and keeps every cleanup promise registered until settlement. `close()` is terminal, rejects later attachment, starts remaining detach operations, and awaits both already-running and newly started detach promises with allSettled semantics before returning or rejecting. This closes the earlier gap where attachment removal made in-progress cleanup invisible to close.

Tail-flush operations and shared writer-close operations both settle before AggregateError is reported. A failing first stream therefore does not skip the second stream's close. The bounded 200 ms EOF drain remains; child pipes inherited by descendants cannot alone hold that phase indefinitely. Arbitrary injected writer/filesystem behavior is not forcibly cancellable.

The specific inspected functions are constructor/attach, `detach(record)` lines 56-63, `_detach(record,attachment)` lines 64-86, and `close()` lines 87-96.

## Regression evidence

Parent-produced execution evidence was inspected, not independently rerun:

- `log-shutdown-fail-before.json` confirms the race on the withdrawn exact package: close returned with detach unsettled and one shared writer remaining.
- `tests/review-regressions.test.js` now starts detach before close with a PassThrough final marker, verifies repeated detach shares completion, verifies close stays pending until the tail arrives, then asserts zero remaining writers/detaches and rejects later attachment.
- A second regression models a rejected stdout writer close while stderr closes after a delay; it verifies the delayed close finishes before AggregateError and that writer/detach maps are empty.
- `native-final.txt` explicitly records both new tests passing (26 ms and 33 ms respectively).

## CLI compatibility disposition: resolved

`candidate/src/console/run.js` computes one `scaleInstances` value from positional input or `options.instances`, validates it before daemon discovery, and dispatches that same value. A Boolean flag without a value rejects. The authenticated task-owned control regression verifies `scale api --instances 2` delivers name api and instances 2; `native-final.txt` reports it passed (60 ms).

## Replacement validation evidence

- `native-final.txt`: 47 passed, zero failed/cancelled/skipped, 4477 ms.
- `packed-consumer.json`: passed, exact replacement SHA-256 above, 122 files; root/runtime/integration/drivers/console imports passed; declaration check passed; three practical examples passed; publication guard rejected as intended; 47 exact packed tests passed with zero failed/cancelled/skipped, 4057 ms.
- `composition.txt`: five paired Monitor tests passed with zero failed/cancelled/skipped, including direct/runtime/adapter bridge registration and actual packed Monitor telemetry/diagnostics over PM child IPC plus shutdown.
- `composition-types.txt` is empty of diagnostics; parent confirms strict paired type check exited zero.

## Final review disposition and limits

No remaining substantive blocker was found in the requested focused fixes. This report resolves R6 and the scale flag caveat identified for the withdrawn artifact. Together with the previously verified R1-R5 and core R7 fixes, the enumerated review findings are resolved for the replacement pin, subject to the documented boundaries already recorded in prior reports.

This is a static review with independent artifact/source byte verification and inspection of parent-produced execution evidence. It is not an independent runtime rerun or a guarantee of every platform, production consumer, arbitrary injected callback, kernel/filesystem failure, descendant process tree, or undocumented secret format. Standalone JsonStateStore callers still coordinate their own concurrent writes; ProcessManager serializes its saves. Production service installation and system daemon registration were not performed or claimed.
