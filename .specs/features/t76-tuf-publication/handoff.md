---
schema: verchestra-feature-handoff/v1
feature: t76-tuf-publication
issue: 17
status: in_progress
branch: r2-pr3
baseRevision: d05ade95e06b940faed2861731a0755d78850113
lastCompletedTask: T9
nextTask: "T7 — rebuild the candidate at a revision containing the sealed-launcher fix (the be92397/af8bcf0 candidates seal dev-shim launchers and fail activation health on a live install), then: operator provisions the release signing secret and storage endpoint, dispatches t76-publish-release.yml at that exact reviewed SHA with the base URL and prior rollback run, uploads the emitted publication/ tree by hand, and verifies the live endpoint with the verification launcher package."
lastGate: "Sealed-launcher closure (7) and reproducible-target-build (3) suites pass with zero failures/skips/todos; gate:quick, gate:build, and gate:security PASS with the sealed launcher bundling in place"
updatedAt: 2026-08-26T00:00:00Z
---

# Scope

TP-01 through TP-09 in `spec.md`. The publisher library slice (T1–T3), the
delegation-path derivation fix (T4), the schemaVersion-2 pinned-input map
(T5), and the operator-base-URL publication script, workflow, and tests (T6)
are complete.

# Completed Evidence

- `scripts/t76-publish-release.mjs` — signs one TUF publication per fleet
  target from a sealed candidate closure; validates the operator base URL
  fail-closed (`VES_T76_PUBLISH_BASE_URL_INVALID`) before any output exists;
  emits exactly one `release-inputs/` directory (shared `root.json` plus a
  schemaVersion-2 `release-source.json` mapping all five target keys); draws
  the per-target rollback proof from a sealed prior `t76-target-index.json`
  (`--rollback-index`, `VES_T76_PUBLISH_ROLLBACK_INCOMPLETE`,
  `VES_T76_PUBLISH_CANDIDATE_INVALID`); names each asset's `remoteKey`
  mirroring the emitted `publication/` tree.
- `.github/workflows/t76-publish-release.yml` — manual, read-only, nine
  SHA-pinned actions, env-mediated inputs, three exact-run-id artifact
  downloads (candidate index, sealed targets, prior rollback index), one
  secret in one step, no storage tool or endpoint identity, verification
  build over the single `release-inputs` directory.
- `tests/build/t76-release-publication.test.mjs` (18 tests) — includes the
  cross-contract round-trip through the launcher's real `loadPinnedInputs`
  and `buildVestraLauncher`, TUF client staging of the win32-x64 and
  linux-arm64 repositories, and every new fail-closed path.
- `tests/agent-readiness/t76-publish-workflow.test.mjs` (12 tests) — includes
  the ownership-boundary assertions (no `github.repository`, no storage CLI
  string, exactly one secret name).
- `docs/canonical-json-census.json` — `scripts/t76-publish-release.mjs`
  classified `migrated-v2` after `census:refresh`.
- Gate evidence recorded in `validation.md`.
- T9 (TP-10): `scripts/t76-build-candidate.mjs` now bundles
  `apps/vestra-cli/closure/{vestra,verchestra}-entry.ts` deterministically
  (esbuild JS API, same option-vector discipline as
  `scripts/build-vestra-launcher.mjs`, plus a `define` carrying the sealed
  semantic version and an `alias` substituting the lazy `node:sqlite` shim)
  instead of sealing `apps/vestra-cli/bin/*.mjs` verbatim, asserts the build
  tree is clean (`VES_T76_BUILD_TREE_DIRTY`), and seals the closure entries as
  release sources. The sealed launcher (`apps/vestra-cli/src/sealed-launcher.ts`)
  delegates every ordinary argument vector to the real `main()` and answers
  `--activation-health` with honest observations: the compiled-in migration
  registry (extracted to
  `packages/platform-node/src/runtime-store/runtime-migrations.ts` and
  re-exported through `/readonly` so the observation never loads
  node:sqlite), the release-layout `native/*` byte sizes, the compiled-in
  driver classes plus the packaged `drivers` self-test profile, and a
  behavior projection of the installed release manifest.
  `tests/build/sealed-launcher-closure.test.mjs` drives the real
  `NodeActivationHealthGate` against the staged layout - and proves the old
  dev-shim launchers fail it exactly the way the live install failed.

# Next Exact Action

Two operator steps remain, in order: run the verification launcher package on
a Linux host against the live endpoint (`node bin/vestra.mjs --version` from
the package built with `--release-inputs`), then `npm publish` the packed
`verchestra-0.0.0-qualification.tgz` by hand. Everything before those is done
and recorded under "Live publication evidence" in validation.md: the
candidate at `a49f3dd5aa3e639db87f8715077446ec075600e9` (run 32927839487) is
signed and published (run 32929312169), all 990 objects are uploaded to the
operator's endpoint with per-object integrity verification, endpoint
conformance is probed, and the live Windows activation passes end to end
through the real health gate and verified handoff.

# Blockers

Any candidate built before the sealed-launcher fix (including be92397 and
af8bcf0) fails activation on a real install: it stages, then
`VES_ACTIVATION_HEALTH_FAILED` because its launchers import
`../src/main.ts`. T7 dispatched at `a49f3dd`, which contains T9 and the
win32 sealed-runtime extension; the earlier af8bcf0 objects that no longer
appear in any manifest remain in the bucket as unreferenced garbage (TUF
never resolves them; deletable at leisure).

None otherwise for repository work. T7 requires operator-held secret and storage
custody that must never exist in a development environment.

# Decisions

- The publication host is an operator-supplied base URL (object storage
  behind a custom domain), not GitHub Releases; the manifest's `host` is
  `"r2"` and per-target URLs are `<base><targetKey>/{metadata,targets}/`.
- One `release-inputs/` directory serves all five targets via the launcher's
  schemaVersion-2 per-target source map; per-target release-input directories
  no longer exist.
- Rollback authority comes only from a sealed prior reconciled index, never
  from digest values typed into a dispatch form; the prior index must seal a
  different revision and cover the whole fleet.
- CI owns no upload path: no storage credential, CLI, or endpoint identity
  appears in the workflow, and nothing publishes.
- Sealed launchers are bundles of tracked closure entries; the development
  shims in `apps/vestra-cli/bin/` are never sealed. The builder bundles only
  from a clean tree at the exact sealed revision, and tests satisfy that with
  a sealed single-commit replica of the working tree
  (`tests/helpers/sealed-repository-fixture.mjs`), never by committing into
  the developer's checkout.
- The sealed runtime component is still `runtime/node` on every platform; a
  win32 host cannot spawn an extensionless executable, so the health gate
  would fail before any launcher runs there. Recorded in `validation.md`;
  renaming the component is a separate change because publication path
  derivation and fixtures pin the current logical path.

# Files Intentionally Left Unchanged

`packages/distribution/src/tuf-publication.ts` and
`apps/vestra-launcher/src/pinned-inputs.ts` (landed in the two prerequisite
changes and consumed as-is), `scripts/build-vestra-launcher.mjs`, and
`.github/workflows/t76-candidate-build.yml`.
