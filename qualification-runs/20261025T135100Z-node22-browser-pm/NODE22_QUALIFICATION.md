# Node 22.0.0 qualification

**PASS for the executed local package and PM pair scope.** Native Safari acceptance subsequently passed in the separate [browser receipt](BROWSER_RECEIPT.json), using a Node 24.21.0 fixture. This Node 22 receipt does not qualify other operating systems or real services, recommend an old patch for production security maintenance, or authorize publication. The retained machine audit's earlier browser-incomplete limitation describes the time it was produced, before that separate native lane finished.

The nominated `@rawnode/monitor@1.0.0` archive is [final/artifacts/rawnode-monitor-1.0.0.tgz](final/artifacts/rawnode-monitor-1.0.0.tgz), **214,938 bytes, 177 files**, SHA-256 **`a749983cc32e7ed9df10088dbe671fc4c6a3d47ed9a22da8a9d48d1e789c2615`**. All results below use that artifact or source files proven identical to its complete inventory. Packing ran separately on retained Node 24.21.0; Node 22 consumers actually extracted and installed those same bytes with npm 10.5.1. [Final audit](node22-final/qualification.json) and [consumer identity](node22-final/distribution.json) retain paths, versions, commands, inventory, and harness hashes.

## Runtime and change

The declared floor remains `engines.node: >=22`. Read-only discovery found Node 24.21.0 and an unrelated Node 26 installation, but no usable Node 22 in inspected locations. Node 26 was not executed. An explicitly approved official Node 22.0.0 Darwin x64 tarball was downloaded into a task-owned temporary directory, with its published SHA-256 checked. No global installation changed. The runtime archive hash is `422a3887ff5418f0a4552d89cf99346ab8ab51bb5d384660baa88b8444d2c111`; the binary hash is `7bf07129d8283073d722ff32070b2976c6e00c9690ffea54d6266d811f1b843e`. A release signature was not checked. [Download receipt](runtime/node22-input.json), [discovery](runtime/discovery.json), and [platform receipt](runtime/platform.json) retain the evidence.

Execution used macOS 15.8.1, build 24H32, x86_64 / Node `darwin x64`, on the existing host. Virtualization was not independently established. The architecture query returned x86_64 and unknown ARM/Rosetta OIDs after its restricted attempt was denied. No extra VM, container, remote runner, or host service was started.

Exact Node binary: `/private/tmp/rawnode-monitor-node22-20261025T135100Z-uWarSj/node-v22.0.0-darwin-x64/bin/node`. Its bundled npm is **10.5.1**. Existing TypeScript **5.9.3** at `/usr/local/lib/node_modules/typescript/bin/tsc` executed under this same Node 22 binary for package, outside-package, and paired PM types. `skipLibCheck:false` was explicit. The existing Python tool was used only for receipt/checksum bookkeeping; it did not supply runtime or semantic-type acceptance.

The unchanged October 25 archive initially produced 95/97 passes after loopback access was allowed. Its two failures were an experimental Node 22.0.0 MockTimers bug: mocked `clearInterval(null/undefined)` throws, although native cancellation accepts both. The first restricted attempt also retained 18 unrelated loopback permission failures. No failed attempt was discarded.

The sole package change from this lane is a test fixture helper in `package/test/studio-actions.test.mjs`, plus two call replacements. It restores native no-op semantics only for nullish mock interval handles and restores global state during cleanup. No production code, assertions, names, test selection, or engine range changed. An independent probe proves active interval scheduling and cancellation remain operative. The six affected-file cases pass on both Node 22.0.0 and retained Node 24.21.0. The seven October 25 regressions remain untouched and included in the 97-case suite. [Diagnosis and controls](runtime/MOCK_TIMER_DIAGNOSIS.md) links all baseline failures, probes, and focused reruns. `--test-timeout` works at the floor; no flag was removed.

## Executed gates

These are the same 97 distinct tests in three consumers, not 291 distinct cases. None were skipped, canceled, or marked todo. No final command hit its external watchdog.

| Gate | Required scope | Outcome | Evidence |
| --- | --- | --- | --- |
| Source build/test/example/types/guard | Mandatory package floor | PASS: 97/97, 112 syntax-checked JavaScript files, 29 checked export targets; example and both strict declaration consumers exit 0; publication guard intentionally exits 1 | [Source commands](node22-source-after/commands.json) |
| Clean extraction, all six gates | Mandatory exact consumer | PASS: 97/97; all positive commands exit 0; guard exits 1 | [Extracted commands](node22-final/logs/extracted/commands.json) |
| Actual offline npm installation, all six gates | Mandatory exact consumer | PASS: 97/97; offline install with scripts suppressed, no source links; all positive commands exit 0; guard exits 1 | [Installed commands](node22-final/logs/installed/commands.json), [install and export commands](node22-final/distribution-commands.json) |
| Every public import | Mandatory extracted and installed boundary | PASS: 29 entries including metadata / 28 executable entries, 189 root names, DOM-free `/studio/client`, private deep import rejection, resolved paths confined to each consumer | [Extracted imports](node22-final/logs/distribution/extracted-imports.stdout.txt), [installed imports](node22-final/logs/distribution/installed-imports.stdout.txt) |
| Strict outside-package types | Mandatory extracted and installed boundary | PASS: root and every export consumer, TypeScript 5.9.3 on Node 22.0.0 | [Commands](node22-final/distribution-commands.json) |
| Studio HTTP and SSE protocol | Mandatory local protocol scope | PASS: 33 assertions; packaged shell/assets, API and error/empty/delay modes, redaction, origin control, actual SSE frames, manual stream reconnect, cancellation and idempotent teardown | [Protocol receipt](node22-final/studio-final-smoke.json) |
| Authorization and remote-ingest fixture | Mandatory existing local security scope | PASS: 19 assertions; explicit bearer headers, origin denial, exact-byte HMAC, malformed/missing/expired signatures, tamper, body cap, unknown-kind accounting and stored redaction | [Security receipt](node22-final/ingest-auth-final-smoke.json) |
| Accepted PM pair | Mandatory local supported pair | PASS: direct owner shapes plus five reciprocal cases including actual owned child IPC, and strict paired declarations | [PM receipt](node22-final/pm-composition.json), [raw reciprocal output](node22-final/logs/pm-composition/reciprocal.txt) |
| Post-run integrity | Mandatory artifact and ownership boundary | PASS: all 177 source/extracted/installed package file hashes still match; extracted/installed archive modes match; final archive, October 25 archive, and accepted PM input rehashed | [Final audit](node22-final/qualification.json) |
| Native browser interactions | Separate mandatory Studio scope | PASS in the subsequently completed native Safari 27.0 lane with a Node 24.21.0 fixture; Node 22 protocol checks remain a separate evidence category | [Final browser receipt](BROWSER_RECEIPT.json), [scope and reproduction](BROWSER_HANDOFF.md) |
| Additional OS, architecture, or live backend | Configuration-specific | UNRUN here; no additional release profile inferred or infrastructure activated | See the parent service/platform scope |

JSON module imports emitted Node 22's experimental warning, retained in raw stderr. Warnings were not suppressed and commands succeeded. All suites preserve their ordinary per-file concurrency; complete source/extracted/installed runs were serialized across runtime lanes to avoid artificially loading deadline tests.

## PM ownership and cleanup

The verified PM input remains `@rawnode/pm@0.1.0`, **94,194 bytes**, SHA-256 **`0fa82b2c1b7d27ddd9d185781003c1547002f7c9263d8754d2e48e2bd546aa8f`**. Its actual `engines.node` is `>=20.19.0`, which the selected floor satisfies. Its archive and package bytes were not changed and it is not a Monitor dependency.

The real child reported the exact Node 22 executable and version through an owned temporary identity file. Its natural exit was code 0, signal null; Monitor and RuntimeAgent were closed, the bridge stopped, owned Monitor timers were zero, and pending runtime requests were zero. Direct fixtures assert listener cardinality, metric/health bridging, returned/on-disk synthetic diagnostic redaction, idempotent detach, and survival of a borrowed PM resource. The five reciprocal cases are separate from Monitor's 97 cases and from PM's historical native/packed counts. No existing PM workspace or application process was attached.

Both HTTP fixtures close idempotently with no listening server, stream clients, Monitor signal listener, or Monitor timers. All final runners exited naturally; no watchdog fired. Task-owned temporary consumers and the downloaded runtime remain as reviewable local material. No daemon, autostart, production monitoring, remote service, external notification, registry publication, push, tag, or sibling/original-application edit was performed by this lane.

## Reproduction entry points

The recorded entry points use the exact runtime path above and run from the repository root. All command/working-directory/exit details are in the linked JSON receipts. For a fresh attempt, first copy the harnesses and identified final distribution receipt into a newly named run and change the run paths below, preserving these receipts.

```sh
node22_path=/private/tmp/rawnode-monitor-node22-20261025T135100Z-uWarSj/node-v22.0.0-darwin-x64/bin/node
"$node22_path" qualification-runs/20261025T135100Z-node22-browser-pm/scripts/mock-timer-probe.mjs
"$node22_path" qualification-runs/20261025T135100Z-node22-browser-pm/scripts/runtime-checks.mjs "$node22_path" package qualification-runs/20261025T135100Z-node22-browser-pm/node22-source-after
"$node22_path" qualification-runs/20261025T135100Z-node22-browser-pm/scripts/node22-consumers.mjs
"$node22_path" qualification-runs/20261025T135100Z-node22-browser-pm/scripts/node22-final-checks.mjs
"$node22_path" qualification-runs/20261025T135100Z-node22-browser-pm/node22-final/scripts/run-services.mjs
"$node22_path" qualification-runs/20261025T135100Z-node22-browser-pm/scripts/audit-node22.mjs
```

The consumers harness consumes the identified final distribution receipt and never repacks Monitor. npm configuration/cache isolation and offline installation prevent registry fallback. The PM runner uses explicit Node 22 paths for npm, compiler and nested child execution. The parent final distribution receipt retains the native offline prepack and identical repeat-pack proof.

**Monitor floor runtime/package qualification: PASS for this host and artifact. Native Studio interaction acceptance: PASS in the separate selected Safari/Node 24 fixture scope. PM/platform/service qualification: local pinned pair PASS; broader profiles UNRUN. Publication authorization: NOT GRANTED.**
