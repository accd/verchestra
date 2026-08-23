---
schema: verchestra-feature-handoff/v1
feature: canonical-json-t4-completion
issue: 58
status: verification
branch: codex/issue-58-t4j-release-identity
baseRevision: 190e06f50e5a0b014013bda4dd7618104db3182a
lastCompletedTask: T6
nextTask: T7
lastGate: gate:security
updatedAt: 2026-08-23T00:00:00Z
---

# Scope

Issue #58, the remaining T4 work: T4j (release identity), T4k (close the
unclassified census), T4i (signed evidence facade), and close-out. Requirements
CJ5-01 through CJ5-13 in `spec.md`; 23 tasks in four phases in `tasks.md`.
Prior slices T1–T2, T3 (`.specs/features/canonical-json`), and T4a
(`.specs/features/canonical-json-t4a`) are merged; T4b–T4h are merged.

Each phase is independently mergeable, satisfying the matrix's requirement that
every slice be a separately reviewable unit.

Phase 1 (T4j release identity) is implemented on this branch in six atomic
commits. T1 proved there is no installed V1 release-manifest digest; T2
migrated the hermetic bundle to `canonicalizeJsonV2`; T3 added the locale and
Unicode proof; T4 added the disposable-copy ordering sensor; T5 migrated
transactional activation equality; T6 lowered both distribution locale
ceilings to zero and reconciled the matrix.

# Completed Evidence

Commits on this branch: `cd7ac3a` (T1), `921b09e` (T2), `618ee5c` (T3),
`bf771da` (T4), `9057bbb` (T5), and `a7fdeca` (T6). Focused release,
activation, census, locale, and sensor suites pass. `test:release` passes
28/28. `gate:security` passes with 1,076 security-stage tests and 284 fault
tests, all passing with zero failures, skips, or todos. `agent:check` and
`git diff --check` pass.

# Next Exact Action

After human review and merge of the T4j PR, start T7 (the evidence-group audit
for T4k) from the new `main`, preserving the T4i versioned-facade work and the
remaining non-zero V1 compatibility ceiling. Do not close #58 until T4k,
T4i, and close-out evidence are complete.

# Blockers

Human review and merge of the T4j PR are required before T7 starts. The T4j
direct-swap route was valid because T1 proves `releaseDigest` is null and no
tracked V1 release-manifest digest is pinned; once T76 ships a candidate, any
new release identity must use a versioned facade.

# Decisions

- **AD-021** — T4j is reclassified from "versioned facade, highest risk" to a
  direct swap, gated by T1's assertion. The matrix's original rating assumed an
  installed base that does not exist.
- **AD-022** — T4-effect (`effect-contract.ts` versioned identity) is split to
  its own issue. It uses `JSON.stringify` on a fixed-order literal, was never
  locale-dependent, and its ceiling is already 0; its real risk is at-most-once
  correctness, a distinct design unit.
- T4i will likely end at a **non-zero ceiling by design**: retaining V1
  verification means retaining the V1 sort. #58's "no `localeCompare`" box
  closes as "no unintentional ordering", with residuals named (CJ5-12).
- Phase order inverts the matrix's risk order (T4j before T4i) because the
  dominant constraint is a closing window, not risk.

# Files Intentionally Left Unchanged

- `packages/evidence/src/integrity/canonical.ts` — stays the qualified V1
  implementation, exported and untouched.
- `packages/workspace/src/scanner/scanner-primitives.ts` — its two sites are
  intentional V1 compatibility for `buildInventoryFingerprint`.
- `packages/application/src/effects/effect-contract.ts` — its versioned identity
  vertical is already merged; no T4j changes were needed.
- Generated contracts — changed only through schema and generator.

# Open Follow-Up

The close-out still needs to de-duplicate `MATRIX_CEILINGS` in
`tests/security/canonical-json-locale-allowlist.test.mjs`. Later values
currently win for several historical rows, so this T4j change only tightens
the two distribution owners; T21 must remove the duplicate-key drift and add
the required uniqueness assertion.
