---
schema: verchestra-feature-handoff/v1
feature: canonical-json-t4-completion
issue: 58
status: verification
branch: test/558-locale-allowlist-dedupe
baseRevision: 8056d41b5ab615ce7dc536db400e09f136565c61
lastCompletedTask: T21
nextTask: "Owner review and merge of the T21 change (issue #558); its pull-request CI run is the close-out gate, since T22 and T23 stay superseded by #58's closure."
lastGate: "T21 branch on Windows 11, Node 24.18.0: gate:quick static stages pass, test:unit 2991/2993 and test:security 1346/1359, every failure an environment case already recorded (#555 named-pipe helper and elevated ACL proof, symbolic-link privilege, tmpdir under the home directory); the pull request's CI run is the clean gate"
updatedAt: 2026-10-14T07:41:00Z
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
- **T21, the ratchet repair, done on 2026-10-14 (issue #558).**
  `tests/security/canonical-json-locale-allowlist.test.mjs` declared
  duplicate object keys, and the later value won:
  - 9 in `MATRIX_CEILINGS`, including `gate-commit.ts` 0 then 1 and
    `cedar-policy.ts` 0 then 2.
  - 5 in `UNCLASSIFIED_CEILINGS`.

  Nothing failed, because the real counts were at or below the intended
  ceilings, but a regression up to the looser duplicate would have passed.
  Each duplicate is now resolved to the value its migration commit and the
  compatibility matrix give. For 12 the surviving line was already the
  tightened 0. For `gate-commit.ts` (tightened in `ddd0282`, re-added at 1 by
  `4038dbb`) and `cedar-policy.ts` (tightened in `f63471c`, re-added at 2 by
  `a7f6122`) the stale re-added line is removed and 0 holds. The test now
  reads its own source: a repeated key in either group, or an owner present in
  both groups, fails it, and two mutation cases prove the sensor.
- **Superseded by #58's closure: T22 and T23.** T22 would record acceptance
  evidence on #58, and T23 would run the close-out gates. Neither was recorded
  for this feature. The T21 change's CI run stands in for T23's gates.

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

None. The defect found while planning (duplicate keys in `MATRIX_CEILINGS`,
later values winning, `gate-commit.ts` effectively ratcheted at 1 and
`cedar-policy.ts` at 2 while the matrix records both as "tightened to 0") is
fixed by T21 under issue #558; see the Reconciliation section.
