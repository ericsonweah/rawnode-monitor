# Later release checklist — no current authorization

The current private candidate is engineering-verified on Node 24/macOS, with the explicit gaps in [REPORT.md](REPORT.md). The exact reviewed archive hash is `e32c999d758434c58e5abea0a1fa055c5d0b3450e4e1e34e7d6ad76fb6be74d7`. Do not publish or disable its guard in this task.

- [x] Resolve the four review leads and adjacent file drain; retain focused regressions and lifecycle ownership.
- [x] Synchronize declarations/docs; preserve all exports and zero dependencies.
- [x] Verify native and fresh exact-extracted/offline-installed consumers, types, exports, examples, publication rejection, provenance and package contents.
- [x] Verify installed Studio HTTP/SSE and exact accepted PM runtime/type composition; retain separate modeled evidence.
- [x] Record a bounded CPU/allocation/RSS/event-loop/throughput/cleanup workload without universal performance claims.
- [ ] Owner resolves original ISC declaration/empty LICENSE provenance and supplies an actual intended license grant. Preserve First Principle Lab LLC ownership and historical material; do not invent a grant.
- [ ] Owner approves npm namespace/control and final version; `1.0.0` remains provisional.
- [ ] Owner chooses the supported Node/OS matrix and executes Node 22 plus additional promised platforms.
- [ ] Execute real-browser acceptance from the exact package using `examples/studio-fixture.mjs` and `docs/STUDIO.md`: every view, trace detail, each Cancel, intended operations, failure/recovery, delayed navigation/unmount, mount ownership, native reconnect/polling fallback, CSP, narrow layout, keyboard/focus, accessible feedback and console/network errors. Record browser/version and screenshots.
- [ ] Owner defines production workload/soak and performance acceptance, accounting for the measured small-fixture overhead. Run the promised duration/load/sink combinations.
- [ ] Owner selects optional integration promises; verify prepared Events/Unified/Logger, live Redis/RawMongo/OTLP/StatsD or full Foundation boot only if included. Preserve protocol/durability distinctions.

After those decisions, a **new explicitly authorized release task** should:

1. Apply only approved license/namespace/version/compatibility changes and review their exact diff. Keep historical receipts immutable.
2. Rerun native build/tests/basic/strict types and supported runtime/browser/integration gates. Use controlled loopback/synthetic fixtures unless separate production access is expressly authorized.
3. Pack outside the package tree; record bytes/files/SHA-256. Make fresh extraction and scripts-disabled offline-install consumers from that archive. Verify bytes, every installed manifest entry, client behavior, complete tests, types/examples and selected compositions. A package edit requires repacking and fresh verification.
4. Review the release notes, archive contents, provenance/license, support matrix and acceptance evidence. Obtain explicit owner approval of the exact candidate bytes and publication process.
5. Only within that new authorization, make the owner's reviewed publication-barrier changes, repack/reverify their resulting bytes and execute the approved release process. Npm publication, tagging, deployment and daemon registration remain outside this completed task. A subsequent owner request separately authorizes committing and pushing the verified readiness deliverables to the existing repository; see the REPORT.md addendum.
