---
schema: verchestra-feature-handoff/v1
feature: canonical-json-t4-completion
issue: 58
status: in_progress
branch: fix/gate-census-and-handoff-drift
baseRevision: 20071a78eb5b96b9de63e5e9c863b6997643c767
lastCompletedTask: T20
nextTask: "T21 — de-duplicate MATRIX_CEILINGS (9 duplicate keys) and UNCLASSIFIED_CEILINGS (5) in tests/security/canonical-json-locale-allowlist.test.mjs and add a duplicate-key assertion; no open issue tracks it (#58 is closed), so the maintainer first files one or takes it as a focused security change."
lastGate: "T4j b738b04 and T4k 44c7a85 merged; census has no pending-versioned-migration entry; T21 not started"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Issue #58, the remaining T4 work: T4j (release identity), T4k (close the
unclassified census), T4i (signed evidence facade), and close-out. Requirements
CJ5-01 through CJ5-13 in `spec.md`; 23 tasks in four phases in `tasks.md`.
Prior slices T1–T2, T3 (`.specs/features/canonical-json`), and T4a
(`.specs/features/canonical-json-t4a`) are merged; T4b–T4h are merged.

Each phase is independently mergeable, satisfying the matrix's requirement that
every slice be a separately reviewable unit.

T4i's signed-evidence Execution Package implementation is merged in PR #307
at `190e06f`. T4j (release identity) and T4k (remaining census closure) are
the next implementation slices; neither has started on this branch.

# Completed Evidence

T4i's independent correction and human-reviewed merge are now recorded in
`.specs/features/canonical-json-t4i-signed-evidence/validation.md` and PR #307.
The source-derived census remains tracked and security-tested; its pending
versioned entries are not a qualification pass.

# Reconciliation (2026-09-29, #407)

Phases 1 to 3 are merged. #58 was closed on 2026-08-25. The "Next Exact
Action" and "Blockers" below are historical: they predate T4j. The same drift
is acceptance-matrix L18.

- **T4j (T1 to T6), release identity, merged in `b738b04` (PR #311).**
  `hermetic-bundle.ts` and `transactional-activation.ts` use
  `canonicalizeJsonV2` and code-unit ordering.
  `.specs/features/canonical-json-t4j-release-identity/validation.md` reads
  "Verdict: PASS", and AD-026 records the direct swap. T1's planned
  `tests/build/release-identity-census.test.mjs` was never created. The
  no-installed-base claim was checked in the T4j slice instead, as its commit
  and validation record.
- **T4k (T7 to T12), census closure, merged in `44c7a85`.** Follow-ups landed
  in `5a530c4`, `95b2b80`, and `6f77378`. `docs/canonical-json-census.json` has
  no `pending-versioned-migration` entry.
- **T4i (T13 to T20), signed evidence, merged.** `190e06f` (PR #307) covers the
  Execution Package. `e469dbd` covers Run Capsule, Recovery Bundle, and Support
  Bundle. AD-029 and AD-031 record the decisions.
- **Still open: T21, the ratchet repair.**
  `tests/security/canonical-json-locale-allowlist.test.mjs` still declares
  duplicate object keys, and the later value wins:
  - 9 in `MATRIX_CEILINGS`, including `gate-commit.ts` 0 then 1 and
    `cedar-policy.ts` 0 then 2.
  - 5 in `UNCLASSIFIED_CEILINGS`.

  Nothing fails today, because the real counts are at or below the intended
  ceilings. A regression up to the looser duplicate would still pass. This is
  the defect "Open Follow-Up" names. No open issue tracks it.
- **Superseded by #58's closure: T22 and T23.** T22 would record acceptance
  evidence on #58, and T23 would run the close-out gates. Neither was recorded
  for this feature. Once T21 lands, T23's gates rerun on that change.

# Next Exact Action (historical, 2026-08-23 — superseded, see Reconciliation)

T1: add `tests/build/release-identity-census.test.mjs` asserting
`resolveReleaseIdentity().releaseDigest === null` and that no tracked fixture
pins a V1 release-manifest digest. If either assertion fails, stop and re-plan
Phase 1 as a versioned facade. Then `pnpm gate:quick`.

# Blockers (historical, 2026-08-23)

None for implementation. One scheduling window applies: Phase 1 (T4j) must land **before T76**
ships a release candidate. The direct-swap route depends on there being no
installed base of signed release bytes — `releaseDigest` is null
(`apps/vestra-cli/src/release-manifest.ts:19`), T76 has not shipped, and the
only consumers are `transactional-activation.ts`, `tuf-update-client.ts`, and
two fixtures under `tests/helpers/`. Once T76 ships, the versioned facade
becomes mandatory and permanent.

# Decisions

- **AD-021** — T4j is reclassified from "versioned facade, highest risk" to a
  direct swap, gated by T1's assertion. The matrix's original rating assumed an
  installed base that does not exist.
- **AD-022** — T4-effect (`effect-contract.ts` versioned identity) is split to
  its own issue. It uses `JSON.stringify` on a fixed-order literal, was never
  locale-dependent, and its ceiling is already 0; its real risk is at-most-once
  correctness, a distinct design unit.
- T4i's V1 compatibility does not require a non-zero ambient-locale ceiling:
  the historical default sort is preserved explicitly with UTF-16 code-unit
  comparison. The Execution Package owner therefore has a zero
  `localeCompare` ceiling; the correction and mixed-case regression are
  recorded in `.specs/features/canonical-json-t4i-signed-evidence/validation.md`.
- Phase order inverts the matrix's risk order (T4j before T4i) because the
  dominant constraint is a closing window, not risk.

# Files Intentionally Left Unchanged

- `packages/evidence/src/integrity/canonical.ts` — stays the qualified V1
  implementation, exported and untouched.
- `packages/workspace/src/scanner/scanner-primitives.ts` — its two sites are
  intentional V1 compatibility for `buildInventoryFingerprint`.
- `packages/application/src/effects/effect-contract.ts` — split out per AD-022.
- Generated contracts — changed only through schema and generator.

# Open Follow-Up

A defect found while planning, fixed by T21: `MATRIX_CEILINGS` in
`tests/security/canonical-json-locale-allowlist.test.mjs` contains seven
duplicate keys. Later values win, so `gate-commit.ts` is effectively ratcheted
at 1 and `cedar-policy.ts` at 2, though the matrix records both as "tightened
to 0". Both pass today only because the real counts are zero.
