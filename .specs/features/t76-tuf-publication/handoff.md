---
schema: verchestra-feature-handoff/v1
feature: t76-tuf-publication
issue: 17
status: in_progress
branch: r2-pr3
baseRevision: d05ade95e06b940faed2861731a0755d78850113
lastCompletedTask: T6
nextTask: "T7 — operator provisions the release signing secret and storage endpoint, dispatches t76-publish-release.yml at an exact reviewed SHA with the base URL and prior rollback run, uploads the emitted publication/ tree by hand, and verifies the live endpoint with the verification launcher package."
lastGate: "Focused publication (18), workflow readiness (12), tuf-publication (6), launcher package (11), and canonical-json census (10) suites pass with zero failures/skips/todos; gate:quick, gate:build, and gate:security PASS on this branch"
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

# Next Exact Action

Operator-only: provision `VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64` and the
object-storage endpoint behind the chosen HTTPS base URL, dispatch
`t76-publish-release.yml` at an exact reviewed SHA (candidate run id, base
URL, expiry, prior rollback revision and run id), then follow the emitted
manifest's manual steps: upload `publication/` preserving every remote key,
verify digests, verify the live endpoint with the verification launcher
package, and only then build and `npm publish` by hand.

# Blockers

None for repository work. T7 requires operator-held secret and storage
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

# Files Intentionally Left Unchanged

`packages/distribution/src/tuf-publication.ts` and
`apps/vestra-launcher/src/pinned-inputs.ts` (landed in the two prerequisite
changes and consumed as-is), `scripts/build-vestra-launcher.mjs`, and
`.github/workflows/t76-candidate-build.yml`.
