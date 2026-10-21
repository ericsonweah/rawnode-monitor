# Final focused adversarial review

Date: 2026-10-02. Review mode: static, read-only candidate. Reviewer wrote only this evidence report, did not modify the previous report, and did not execute application/service processes, network requests, startup/install commands, or signals.

## Reviewed artifact and evidence

- Package: `@rawnode/pm@0.1.0`.
- Artifact: `artifacts/rawnode-pm-0.1.0.tgz`.
- Independently read-byte SHA-256: `340b2fa87b9ba4a1f18631f75af1c9d056f0e1b1df590f012a8eb6eb435aed33`.
- Independently checked size: 93,266 bytes.
- `evidence/native-final.txt`: 44 tests passed, zero failed/skipped/cancelled, 4499 ms.
- `evidence/packed-consumer.json`: same artifact SHA-256; 122 package files; root/runtime/integration/drivers/console imports passed; declarations passed; three examples passed; publication guard rejected; exact packed suite reports 44 tests passed, zero failed/skipped/cancelled.
- `evidence/log-retention.json`: 12 generations, one file, zero open writers, all 12 exit-tail markers retained.
- `evidence/composition.txt`: five actual paired-package tests passed, including direct/runtime/adapter Monitor bridge registration/query/detach and child IPC plus shutdown.
- `evidence/composition-types.txt` contains no diagnostics; parent reports strict paired type check passed.

Execution results above were produced by the parent and read by this reviewer; tests were not independently rerun. Artifact hash/size were independently checked with read-only file tools. This report applies to that exact pinned artifact and the frozen candidate inspected with it.

## R1-R7 disposition

| ID | Prior severity | Final disposition | Evidence and limits |
| --- | --- | --- | --- |
| R1 | P1 | Resolved for built-in startup/resurrection path | `ProcessManager.close()` calls `supervisor.close()` before awaiting `_startPromise`; `_closing` interrupts initialization, and readiness is rejected immediately. `review-regressions.test.js` tests close during resurrection against a 20-second readiness deadline with prompt settlement. Arbitrary injected startup/filesystem work is still not forcibly cancellable. |
| R2 | P1 | Resolved for per-record termination failures | `Supervisor._close()` catches each record termination error, attempts remaining records, clears runtime request timers, then reports AggregateError. The manager retains lock/PID if any handle lacks confirmed stoppedAt. Regression uses 12 modeled records and verifies all attempts finish before rejection. Ordinary built-in registry/group operations are assumed not to throw unexpectedly. |
| R3 | P1 | Resolved | Unstarted close gates journal/audit writes on `_ownsState`; saves require ownership. Regression compares active owner's journal/audit bytes before and after an unstarted contender closes. |
| R4 | P1 | Resolved for ProcessManager desired-state saves | `_stateSaveLock` serializes snapshot creation and commit; shutdown drains that lock. Regression holds first save, queues later stopped intent, and verifies later intent persists. Reusable standalone JsonStateStore itself still has no concurrent-writer serialization; callers using it directly must coordinate. |
| R5 | P2 | Resolved for repeated generations at fixed app/slot/stream | Log writers are shared by app/slot/stream and use fixed filenames with reference counts. Retention evidence confirms 12 generations did not create 12 files. Unbounded distinct app names/slots remain an explicitly documented operational limit. |
| R6 | P2 | Partly resolved; remaining blocker described below | Detach now performs a bounded 200 ms pipe EOF drain and closes shared writers in finally after partial-line write failures. Exit-tail evidence passed. However already-running detach promises are absent from close's awaited set; first writer-close error can also skip remaining writer cleanup. |
| R7 | P2 | Substantially resolved | history restored; unknown commands and missing required names are rejected before daemon discovery; owned spawn has error handler and bounded timeout cleanup through its own ChildProcess; foreground signal handlers removed in finally. Tests cover invalid CLI syntax and failed foreground startup. Detached discovery timeout cleanup is inspected but no explicit execution evidence for that path was observed. |

## Remaining substantive concern: in-progress log detach is omitted from close

Location: `candidate/src/logs/LogMultiplexer.js`, `detach()` lines 55-76 and `close()` line 78; `candidate/src/foundation/Supervisor.js`, `_onExit()` lines 286-304.

`detach()` removes the attachment synchronously at line 57, before awaiting pipe EOF, pending capture, final partial-line write, and shared-writer close. `close()` only awaits the attachments still in the map. Therefore an already-running detach is invisible to close. Supervisor marks `record.stoppedAt` before awaiting detach, so a concurrent supervisor/manager shutdown can also omit this record and release state ownership before that old writer has closed.

This is not disproved by successful sequential-generation retention or exit-tail tests. It is an interrupted lifecycle path requiring its own test.

Deterministic reproduction requested of the parent: use the existing PassThrough log fixture; begin `const pending = logs.detach(record)` without awaiting it; then await `logs.close()`. Assert that close does not finish before pending finishes and all shared writers close. A delayed writer/held partial flush makes the ownership risk explicit without child processes or network.

Fix: track/share every detach completion by record, retain it in a pending-detach set through finally, and have close await all currently active plus already-started detaches. Repeated detach should return the same completion. Close each stream writer with all-settled semantics so one failing close does not skip another, then report aggregate errors. Validate manager close after exit has started a slow log detach.

Status: reported promptly to parent. Until remediated or explicitly accepted, the artifact should not claim close waits for all owned logging cleanup. This is a remaining lifecycle/ownership release concern in the reviewed pin.

## Additional boundaries checked

- `RawNodeRuntimeAdapter` now bounds optional events.dispatch in drain/shutdown and forceClose callbacks. These are per-callback/per-phase bounds, not one aggregate deadline for an arbitrary number of resources.
- Quoted multiword secret assignments and separate secret argv flags now have explicit redaction logic and tests. Arbitrary unlabeled/custom secret formats remain outside the documented heuristic guarantee.
- Ownership lock release checks inode/device and nonce. Stale locks require verified manual recovery; no unrelated process is probed/signalled. Mutation/symlink attacks inside an untrusted state directory remain explicitly out of scope.
- HTTP close has a one-second transport cutoff. Destroying connections cannot cancel arbitrary injected Promise side effects.
- Direct `JsonStateStore.save()` callers require external serialization; the production manager path has it.
- Runtime callback deadlines cannot forcibly cancel injected work, which is documented. Noncooperative injected drivers, kernel/device failures, and descendant process cleanup remain caller/operator responsibilities.
- One minor CLI compatibility caveat remains: runCli scale validation reads `positionals[1]` only, while dispatch still accepts `options.instances`. The `scale api --instances 2` spelling accepted by the earlier implementation is rejected before dispatch. Positional `scale api 2` remains supported and documented.

## Conclusion

The prior R1-R5 and core R7 changes are present and backed by relevant parent evidence. R6 is only partly resolved: concurrent in-progress log detach is not included in close completion. No new blocker was found in the other specifically requested boundaries. This is a bounded static review, not a guarantee of production/platform behavior or an independent execution of the reported suites.
