---
schema: verchestra-feature-handoff/v1
feature: canonical-json-t4a
issue: 58
status: complete
branch: feat/canonical-json-t4a-chain-digests
baseRevision: f1c72a067037d681c16c8d623be1fbe2493daf95
lastCompletedTask: T9
nextTask: Human review and merge into main. Next T4 slice is T4b (authority.ts, work-claims.ts) per docs/canonical-json-compatibility.md's T4 slice ordering table.
lastGate: pnpm test:architecture (19/19), pnpm test:security (947/958, 11 pre-existing), pnpm test:release (28/28), pnpm test:unit (1975/1975), pnpm test:contract (483/483)
updatedAt: 2026-08-09T00:00:00Z
---

# Scope

Issue #58, T4a slice: migrate the four unqualified-chain digest owners
introduced by T72-T74 (`promotion-gate.ts`, `campaigns.ts`, `doctor.ts`,
`self-test.ts`) to V2 canonical JSON before their qualification reports
freeze their bytes. Full plan: `spec.md` (CJ4-01 through CJ4-11, all 11
ticked with evidence), `tasks.md` (T1-T9, all complete).

# Completed evidence

- **T1** (`b92dd7d`): `formatCanonicalDigestV2` added to
  `packages/domain/src/canonical/canonical-digest.ts` as the sole `v2:sha256:`
  prefix authority; `buildInventoryFingerprintV2` refactored to call it,
  byte-identical output confirmed by the existing pinned V1 test.
- **T2** (`bea7fbc`): `docs/canonical-json-compatibility.md` refreshed —
  rows added for the four T4a owners plus a previously-understated
  11-site gap in `evidence/execution-package.ts` (deferred to T4i), and the
  full T4a-T4j slice-ordering table with risk rationale.
- **T3** (`50ea144`): `tests/security/canonical-json-locale-allowlist.test.mjs`
  — a repo-wide ambient-locale ceiling sensor covering 48 files / 133 sites
  found by full census (the ~19 matrix-classified owners plus everything
  else, frozen at discovery so a genuinely new site anywhere is still
  caught). Two mutation tests prove the mechanism fails closed.
- **T4** (`75dab72`): `promotion-gate.ts` migrated — `canonicalizeOracle` and
  `evaluatePromotion`'s block ordering now use `canonicalizeJsonV2` +
  `normalizeDeclaredSet`. No persisted fixture pinned the prior bytes.
- **T5** (`7f1adc4`): `campaigns.ts` migrated — `buildCampaignSummary`'s
  result ordering uses `normalizeDeclaredSet`. `canonicalizeCorpus` (the real
  `corpusDigest` input) already had zero locale dependency.
- **T6** (`6ccb1c7`): `doctor.ts` migrated — `sortedUnique` uses
  `normalizeDeclaredSet`.
- **T7** (`4cd6afa`): `self-test.ts`'s `semanticFingerprint` classified
  presentation (not itself hashed/signed) but migrated anyway: locale drift
  could make convergent runs compare non-convergent
  (`VES_SELFTEST_NONCONVERGENT`), a portability defect independent of
  whether a digest is at stake.
- **T8** (`035682f`): `tests/security/canonical-json-sensor.test.mjs`
  extended — mutation C is a new dynamic discrimination sensor for the
  shared `normalizeDeclaredSet` primitive (a real behavioral kill,
  Z-before-a code-unit divergence), plus one static per-owner mutation for
  each of the four T4a files. 7/7 mutations killed.
- **T9** (this commit): T3's ceilings for the four T4a owners tightened from
  their pre-migration counts to 0; matrix rows flipped from "Scheduled" to
  "Migrated" with commit evidence; all CJ4 criteria ticked in `spec.md`.

# Next exact action

None for T4a — it is complete and ready for human review and merge.

The next T4 slice is **T4b**: `authority.ts` (1 site) and `work-claims.ts`
(3 sites), per `docs/canonical-json-compatibility.md`'s T4 slice-ordering
table. Both are persistent authority bindings (approval bindings,
capability-grant digests, claim scope digests) — unlike T4a, these likely
have real persisted bytes to check before migrating; read the matrix's
"Compatibility rules" table first to determine whether a schema/version
bump is required.

# Verification

`pnpm test:architecture` 19/19, `pnpm test:security` 947/958 (the 11
failures are native-module/environment gaps — memory-lifecycle,
sqlite-adapter `setAuthorizer`, cedar-wasm `.wasm` ESM loading — confirmed
byte-identical via `git stash` on the unmodified branch before any T4a
change), `pnpm test:release` 28/28, `pnpm test:unit` 1975/1975,
`pnpm test:contract` 483/483. `pnpm test:integration` (479/556) and
`pnpm test:e2e` (142/163) have pre-existing failures also confirmed
identical via `git stash` (real git/process-runner/native-sqlite
environment dependencies, unrelated to this slice).

`npx tsc --noEmit` is clean (0 errors) after `pnpm install --frozen-lockfile`
— an earlier evidence draft misattributed 6 transient errors to the local
Node 23.11.0 vs qualified 24.14.0 gap; a fresh independent Verifier caught
this: the real cause was a stale local `node_modules` in this session's
working directory, not a Node-version issue. Corrected here so the wrong
attribution isn't re-cited in a future T4 slice. `pnpm gate:security` still
cannot complete locally: `tests/e2e/task-executor-e2e.test.mjs` fails on a
macOS `/tmp` → `/private/tmp` symlink that `git-worktree-adapter.ts` rejects
as `VES_GIT_WORKTREE_ESCAPE`, confirmed identical on an `upstream/main`
worktree baseline (same file:line, same code) — an unrelated, pre-existing
local-machine gap. No T4a source file appears in any failure. No assertion
was weakened, skipped, or deleted.

# Blockers

None for T4a. The full `pnpm gate:security` needs either a non-symlinked
scratch directory or CI to complete past `test:e2e`; this is a pre-existing
local-machine limitation (macOS `/tmp` symlink resolution), not introduced
by this slice and not a Node-version issue.

# Verifier

An independent Verifier (author ≠ verifier, fresh Agent, no prior context)
re-derived all 11 CJ4 criteria and reproduced every test count in this
handoff exactly. Verdict: PASS. One correction flagged and applied above
(the typecheck root-cause misattribution). Full report:
`.specs/features/canonical-json-t4a/validation.md`.
