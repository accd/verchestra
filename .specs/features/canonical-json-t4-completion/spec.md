# Canonical JSON T4 Completion Specification

Issue: #58. Prior slices: T1–T2 (inventory + matrix), T3
(`.specs/features/canonical-json`), T4a (`.specs/features/canonical-json-t4a`),
T4b–T4h (merged). This slice closes the issue.

## Problem statement

Nine of the eleven surfaces named in #58 now use `canonicalizeJsonV2` and
`codeUnitCompare`. Three owners remain, and the census that bounds the claim
was never closed:

- **T4j — release identity.** `hermetic-bundle.ts` still carries a private
  recursive `canonical()` ordering members with `localeCompare`
  (`packages/distribution/src/hermetic-bundle.ts:119-125`) plus a `componentId`
  sort at line 266; `transactional-activation.ts` carries one more site.
- **T4i — signed evidence.** `execution-package.ts` orders eleven identifier
  lists with `localeCompare` before feeding the qualified V1 canonicalizer.
  These values are validated only by the broad `SAFE` pattern, which permits
  mixed case — exactly where locale collation and code-unit ordering diverge.
- **T4k — the open census.** Twenty-two files (about forty-eight sites) sit in
  `UNCLASSIFIED_CEILINGS`, frozen at their 2026-08-09 discovery counts and
  never audited against the compatibility rules. Until they are classified,
  "every trust-relevant digest names one contract" is unproven, not true.

A fourth defect sits in the sensor that guards all of this: `MATRIX_CEILINGS`
contains seven duplicate keys. Later values win, so two owners the matrix
records as "tightened to 0" are effectively ratcheted at 1 and 2. Harmless
today because the real counts are zero, and silently loose the moment they
are not.

## Goals

- [ ] No ambient-locale ordering remains in any trust-relevant digest input,
      except where V1 byte-compatibility explicitly requires it and says so.
- [ ] Every one of the twenty-two unclassified files is classified with a
      recorded justification and a ceiling equal to its true floor.
- [ ] Existing signed and persisted bytes still verify, and a mixed V1/V2
      comparison fails closed.
- [ ] The ratchet sensor cannot silently loosen.

## Out of scope

| Item | Reason |
| ---- | ------ |
| T4-effect (`effect-contract.ts` versioned identity) | AD-022 split it to its own issue. It uses `JSON.stringify` on a fixed-order literal, was never locale-dependent, and its ceiling is already 0. Its real risk — a key mismatch silently inserting a duplicate intent instead of failing closed — is an at-most-once correctness concern needing versioned identity and V1 dual-read, a distinct design unit. |
| `scanner-primitives.ts`'s two V1 sites | The matrix requires them kept byte-identical for `buildInventoryFingerprint`. Intentional, already documented. |
| Editing generated contracts directly | Repository change rule; changes go through schema and generator. |
| `apps/site`, CLI display formatting, closed-field `Object.keys().sort()` checks | The matrix's Explicit exclusions clause: presentation or validation only. Still requires per-file proof under CJ5-04, not assumption. |

## Assumptions and open questions

| Assumption / decision | Chosen default | Rationale | Confirmed |
| --------------------- | -------------- | --------- | --------- |
| T4j risk classification (AD-021) | Direct swap, before T76, with a first task that proves the no-installed-base claim and aborts to the facade route if it fails. | `resolveReleaseIdentity()` returns `releaseDigest: null` (`apps/vestra-cli/src/release-manifest.ts:19`), T76 has not shipped a candidate, and the only consumers are `transactional-activation`, `tuf-update-client`, and two test fixtures. The matrix rated this "highest risk" assuming an installed base of signed release bytes that does not exist. After T76 the facade becomes mandatory and permanent. |
| Order within T4j | `hermetic-bundle.ts` first, then `transactional-activation.ts`. | The matrix explicitly orders it; unchanged by the reclassification. |
| T4i end state | Likely a non-zero ceiling by design. | If V1 verification is retained, the V1 sort must stay. The acceptance box must be read as "no *unintentional* locale ordering", with residuals documented. |
| T4k disposition of a presentation-only file | Record the justification in the matrix and tighten the ceiling to its true floor; do not migrate. | The matrix's Explicit exclusions clause already permits this, but requires it be proven per file rather than assumed. |
| Slice reviewability | One feature directory, one phase per slice, each phase independently mergeable. | The matrix requires each slice be an independently reviewable unit; phases with their own gates and commits satisfy that without three more directories. |

**Open questions:** none — all resolved or logged above.

## Requirements

| ID | Requirement |
| ------ | ----------- |
| CJ5-01 | The no-installed-base claim for release identity is proven by assertion before any release-identity byte changes, and the slice aborts to the versioned-facade route if it fails. |
| CJ5-02 | `hermetic-bundle.ts` uses the V2 canonical contract for the release manifest digest, with no ambient-locale ordering. |
| CJ5-03 | `transactional-activation.ts` is migrated after `hermetic-bundle.ts`, per the matrix ordering. |
| CJ5-04 | Every file in `UNCLASSIFIED_CEILINGS` is classified against the four compatibility rules, with the justification recorded in the matrix and the ceiling set to its true floor. |
| CJ5-05 | `execution-package.ts` gains a V2 facade whose verifier is selected from the DSSE envelope's recorded version, never inferred. |
| CJ5-06 | A pinned V1 signed fixture still verifies unchanged after the facade lands. |
| CJ5-07 | A V2 artifact records an explicit canonicalization version. |
| CJ5-08 | A mixed V1/V2 digest comparison fails closed and is never treated as equal. |
| CJ5-09 | Each migrated owner produces byte-identical output and digests under two different ambient locales. |
| CJ5-10 | A discrimination mutation replacing code-unit ordering with ambient `localeCompare` is killed at each new call site. |
| CJ5-11 | `MATRIX_CEILINGS` contains no duplicate key, and a test fails if one is introduced. |
| CJ5-12 | Every residual `localeCompare` site in a trust-relevant owner is documented as intentional V1 compatibility with its reason. |
| CJ5-13 | #58's acceptance checklist is ticked with file-and-assertion evidence, and `pnpm gate:security` passes with no weakened assertion. |

## Acceptance criteria

1. WHEN the release-identity census runs THEN the repository SHALL assert `releaseDigest` is null and no tracked fixture pins a V1 release manifest digest, and SHALL fail the slice if either is false.
2. WHEN a release manifest is canonicalized THEN the encoder SHALL be `canonicalizeJsonV2` and the component ordering SHALL be code-unit.
3. WHEN the same release manifest is canonicalized under two different ambient locales THEN the bytes and digest SHALL be identical.
4. WHEN a canonicalizer in the release path is mutated to ambient-locale ordering THEN a focused test SHALL fail.
5. WHEN a file in the unclassified set is audited THEN the matrix SHALL record either a migration or a justification, and its ceiling SHALL equal its post-audit count.
6. WHEN the census closes THEN `UNCLASSIFIED_CEILINGS` SHALL be empty and a test SHALL fail if a new unclassified occurrence appears.
7. WHEN an execution package carrying the V1 envelope version is verified THEN it SHALL verify unchanged, byte-for-byte.
8. WHEN an execution package is produced after the facade lands THEN it SHALL record an explicit canonicalization version.
9. WHEN a V1 digest is compared with a V2 digest for the same logical material THEN the comparison SHALL fail closed and SHALL NOT report equality.
10. WHEN a duplicate key is introduced into `MATRIX_CEILINGS` THEN a test SHALL fail.
11. WHEN a residual `localeCompare` site remains in a trust-relevant owner THEN the matrix SHALL name it and its V1-compatibility reason.

## Edge cases

- WHEN a sorted identifier list mixes upper and lower case THEN V1 and V2 orderings SHALL be proven to differ, and the pinned V1 fixture SHALL still verify — this is the precise divergence T4i exists to contain.
- WHEN a Unicode member name appears in a release manifest THEN canonical output SHALL be locale-independent.
- WHEN a persisted artifact carries no version field THEN the verifier SHALL select V1 and SHALL NOT guess V2.
- WHEN an unclassified file's audit is inconclusive THEN it SHALL remain at its current ceiling with the open question recorded, never silently tightened.
- WHEN the T4j census fails AC1 THEN the slice SHALL stop and re-plan as a versioned facade, not proceed with the swap.

## Safety and authority

No migration may silently rewrite a digest, re-sign an artifact, or reinterpret
a V1 value as V2. Byte changes to signed or persisted material require the
recorded-version verifier path (CJ5-05) and a passing pinned V1 fixture
(CJ5-06). No assertion is weakened to obtain a ceiling reduction. Human review
is mandatory before merge.

## Success criteria

- [ ] `pnpm gate:security` and `pnpm gate:full` pass with zero failed, skipped, or todo.
- [ ] `UNCLASSIFIED_CEILINGS` is empty; every remaining non-zero ceiling has a written reason.
- [ ] All eight of #58's acceptance boxes are ticked with `file:line` evidence.
- [ ] T4j lands before T76 ships a release candidate.
