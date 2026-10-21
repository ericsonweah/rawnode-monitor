# Publication procedure — blocked candidate

This preparation performs no publication, push, deployment, dependency installation, daemon registration or system configuration. `private:true`, `license:UNLICENSED`, and `prepublishOnly: node scripts/reject-publication.mjs` reject accidental publication. The guard always exits nonzero; there is no environment-variable bypass.

Before a separately approved release, the owner must decide: license grant/provenance, ownership metadata, npm scope control, final version, supported Node majors, remaining real-browser acceptance, and optional integration coverage. Preserve the root ISC declaration and empty LICENSE evidence rather than inventing a license text. First Principle Lab LLC owns RawNode.

Local review commands require only Node/npm:

```sh
npm run build
npm test
node examples/basic.mjs
npm pack --offline
```

No npm install is necessary. Use an existing `tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 test/types.mts` for optional declaration validation. Do not add TypeScript or `@types/node` dependencies just for validation. The distribution contains JavaScript and declarations directly; build is syntax/import/export/dependency validation rather than transpilation.

For exact offline consumer review, extract the tgz into a fresh temporary `node_modules/@rawnode/monitor` folder, verify its SHA-256 first, import every exported entry, run bundled examples and declarations, then compare the original preserved inventory. That materialization is local tar extraction, not package installation. Keep a fresh consumer tree per artifact version.

An approved release would require a new explicit task to remove the candidate barriers and run the owner's release process. Do not run `npm publish` from this candidate. Even `npm publish --dry-run` is unnecessary: test the rejecting guard directly with `npm run prepublishOnly`.
