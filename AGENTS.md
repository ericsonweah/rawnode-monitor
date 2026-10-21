# Repository Guidelines

## Project Structure & Module Organization

`package/` is the npm root for `@rawnode/monitor`. Runtime code lives in `package/src/`, organized by capability; `MonitorRuntime.js` coordinates lifecycle. Configuration lives in `package/config/`, declarations in `package/types/`, and tests in `package/test/`. Studio JavaScript/CSS are under `package/resources/assets/`. Examples and documentation have separate package directories. Repository-level `provenance/`, `evidence/`, and `artifacts/` preserve original inputs and historical verification.

## Build, Test, and Development Commands

Use Node.js >=22. From `package/`:

- `npm run build` or `npm run check`: validates JavaScript syntax, native imports, export targets, and publication safeguards; no transpilation occurs.
- `npm test`: runs Node's test runner on `test/*.test.mjs`.
- `node examples/basic.mjs`: exercises the standalone runtime.
- `node examples/studio-fixture.mjs`: starts a temporary loopback Studio fixture; send `close` to stdin afterward.
- `tsc --noEmit --strict --module nodenext --moduleResolution nodenext --target es2022 test/types.mts`: checks declarations using an explicitly available compiler.
- `npm pack --offline`: creates the local archive and runs prepack validation.
- `npm run prepublishOnly`: must reject publication.

No dependency installation is required. Historical validation used TypeScript 5.9.3.

## Coding Style & Naming Conventions

Follow adjacent ESM JavaScript: two-space indentation, semicolons, explicit `.js` imports, PascalCase classes, and camelCase members. Preserve capability injection and the zero-dependency design. No formatter or lint script is configured. Inspect `scripts/generate-reference.mjs` before use: it rewrites documentation and declarations. Validate generated output against actual behavior.

## Testing Guidelines

Use `node:test` and `node:assert/strict`; name tests `*.test.mjs`. Add focused behavioral regressions, bounded callbacks, and deterministic lifecycle checks. Clean up task-owned timers, listeners, files, and loopback servers. No numeric coverage threshold is configured. Verify fresh consumers of the exact packed archive; preserve historical receipts. Distinguish actual browser/service results from models and unavailable integrations.

## Commit & Pull Request Guidelines

History contains one “Ready for Codex” commit, so no broader convention is established. Use concise imperative subjects. Explain the problem, resulting behavior, compatibility impact, verification, and remaining limits; link relevant issues and include screenshots for visible Studio changes.

## Release Boundaries

Preserve `private: true`, `UNLICENSED`, First Principle Lab LLC ownership, and the rejecting guard. License provenance and final version require owner decisions. Publication is not authorized.
