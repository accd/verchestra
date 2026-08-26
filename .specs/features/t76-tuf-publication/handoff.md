---
schema: verchestra-feature-handoff/v1
feature: t76-tuf-publication
issue: 17
status: complete
branch: docs/t76-validation-chain-advance
baseRevision: a49f3dd5aa3e639db87f8715077446ec075600e9
lastCompletedTask: T8
nextTask: "T77 — independent acceptance and the explicit 1.0 decision: drive requirements closure with scripts/requirements-trace.mjs against docs/requirements-register.json until every VES requirement carries evidence (T77 closure MET), then obtain real second-reviewer independence and record the human promote-or-reject decision."
lastGate: "gate:quick PASS, site:check PASS, site:test PASS, agent:check PASS, test:agent-readiness PASS in the chain-advance worktree; the bound revision's own evidence is candidate run 32927839487 (five targets x five gate profiles, all pass)"
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

T76 is complete. The remaining work is T77: run
`pnpm requirements:trace` and close every VES requirement still waiting for
evidence in `docs/requirements-register.json` until the script reports
`T77 closure MET`, then obtain the real second-reviewer independence that
`docs/audits/2026-08-verchestra-product-repository-audit.md` records as
mandatory before T77 can close, and record the human 1.0 promote-or-reject
decision.

One post-revision hardening item is landing in parallel and is deliberately
excluded from this revision's evidence: emitting the `views` array into
`publication-manifest.json` and adding a real cross-adapter equivalence test
(HTTPS-online against filesystem-offline over the same emitted tree). The
limitation it addresses is recorded honestly in
`docs/qualification/t76-validation.md` under "Recorded limitation".

# Blockers

None. The live publication, activation, reproducibility, and registry evidence
are recorded in `docs/qualification/t76-validation.md` and under "Live
publication evidence" in `validation.md`. Historical note: any candidate built
before the sealed-launcher fix (including be92397 and af8bcf0) fails activation
on a real install with `VES_ACTIVATION_HEALTH_FAILED`, because its launchers
import `../src/main.ts`; the published candidate `a49f3dd` contains the fix and
the win32 sealed-runtime extension. The earlier af8bcf0 objects that no longer
appear in any manifest remain in the bucket as unreferenced garbage (TUF never
resolves them; deletable at leisure).

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
