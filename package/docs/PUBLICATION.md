# Publication procedure — blocked candidate

This preparation performs no publication, push, tag, deployment, daemon registration or system configuration. The readiness pass uses controlled local offline npm installation of exact archives in fresh temporary consumers, with lifecycle scripts disabled; it adds no dependencies to this candidate. `private:true`, `license:UNLICENSED`, and `prepublishOnly: node scripts/reject-publication.mjs` reject accidental publication. The guard always exits nonzero; there is no environment-variable bypass.

Before a separately approved release, the owner must decide: license grant/provenance, ownership metadata, npm scope control, final version, supported Node majors, remaining real-browser acceptance, and optional integration coverage. Preserve the root ISC declaration and empty LICENSE evidence rather than inventing a license text. First Principle Lab LLC owns RawNode.

Local review commands require only Node/npm:

```sh
npm run build
npm test
node examples/basic.mjs
npm pack --offline
```

Native checks need no npm install. Distribution review additionally installs the exact local archive offline with --ignore-scripts --no-audit --no-fund --package-lock=false and a task-owned cache. Use an existing `tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 test/types.mts` for optional declaration validation. Do not add TypeScript or `@types/node` dependencies just for validation. The distribution contains JavaScript and declarations directly; build is syntax/import/export/dependency validation rather than transpilation.

For exact offline consumer review, extract the tgz into a fresh temporary `node_modules/@rawnode/monitor` folder, verify its SHA-256 first, import every exported entry, run bundled examples and declarations, then compare the original preserved inventory. That materialization is local tar extraction, not package installation. Keep a fresh consumer tree per artifact version.

An approved release would require a new explicit task to remove the candidate barriers and run the owner's release process. Do not run `npm publish` from this candidate. Even `npm publish --dry-run` is unnecessary: test the rejecting guard directly with `npm run prepublishOnly`.

Before any later approved release, record the owner decisions and chosen runtime/browser/integration matrix; complete missing acceptance; update license/version/namespace only under that new authorization; review the diff; repeat native and strict declaration checks; create a new archive outside the packed tree; record its hash and verify fresh extraction and offline installation, every installed export, browser assets/actions, composition and guard behavior; obtain explicit approval of those exact bytes. Any package edit invalidates earlier artifact verification. Only a separately authorized release task may change the publication barriers and execute the owner-approved publication process. Current readiness receipts and the release checklist live outside this package in readiness-2026-10-21/.
