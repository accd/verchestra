# Canonical JSON T4i — Signed Evidence (Execution Package) Specification

## Problem Statement

`packages/evidence/src/execution-package/execution-package.ts` sorts 11
arrays (`artifactRefs`, `requirements`, `tasks`, `completedTaskEvidence`,
`derivePendingTasks`, `roleRequirements`, `gates`, `completionCriteria`,
`normalizePending`, `invalidations`, and one object-entries sort for
`bindings.sourceState`) using an identity comparator. These sites have ordered
with `String.prototype.localeCompare` since the file's first commit
(`867ce74`), so ambient collation produced the historical V1 ordering; AD-018
normalizes V1 onto UTF-16 code-unit ordering rather than preserving it.
Every sorted
field (`taskId`, `requirementId`, `role`, `gateId`, `criterionId`, `field`,
`artifactId`) is validated only against the broad `SAFE` pattern
(`/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u`), which permits mixed case — and
real fixtures use it (`taskId: "T-1"`). Mixed-case ASCII is exactly where
default-locale collation and code-unit comparison can disagree (locale
collation commonly treats case as a tertiary tie-break; code-unit comparison
puts every uppercase letter before every lowercase letter). Since RFC 8785
canonical JSON preserves array element order (verified empirically:
`canonicalizeJson({list:["banana","Apple","cherry"]})` leaves the array
untouched while sorting object keys), whatever order these sorts produce is
exactly what ends up in the DSSE-signed bytes — a locale-dependent array
order is a locale-dependent digest for otherwise-identical execution
packages, which is issue #58's cross-machine identity problem, concretely
instantiated.

## Goals

- [x] New execution packages sort every array by deterministic code-unit
      order, never ambient locale collation.
- [x] Already-sealed `schemaVersion: 1` packages continue to verify
      byte-for-byte unchanged, including the internal `pendingTasks`
      re-derivation check inside `ExecutionPackageBuilder.verify()`.
- [x] The V1/V2 choice is explicit and persisted (`schemaVersion`), never
      inferred or silently defaulted from content.

## Out of Scope

| Feature                                                                                                 | Reason                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Changing `ArtifactSealer`'s own canonicalization                                                        | Traced and confirmed unnecessary: `canonicalizeJson` (V1, `ArtifactSealer`'s primitive) already sorts object keys by code unit and never reorders arrays. The whole defect is upstream of it, in this file's own pre-sort comparators. Widening `ArtifactSealer` was considered and explicitly rejected — see Assumptions. |
| T4j (release identity, `hermetic-bundle.ts`)                                                            | A separate, independently reviewable vertical per `docs/canonical-json-compatibility.md`'s ordering; not started by this feature.                                                                                                                                                                                          |
| `bindings.sourceState`'s object-entries sort (line ~502)                                                | Confirmed digest-irrelevant: the sorted array is immediately converted via `Object.fromEntries` into an object, and canonical JSON already sorts object keys by code unit regardless of insertion order. Migrated for census-classification consistency (CJ4I-08) but carries no compatibility risk of its own.            |
| Any change to `ExecutionPackagePayload`'s validated field contents (requirement IDs, task shapes, etc.) | This is an ordering-determinism fix, not a schema change beyond the `schemaVersion` widening itself.                                                                                                                                                                                                                       |

---

## Assumptions & Open Questions

| Assumption / decision            | Chosen default                                                                                                                                                        | Rationale                                                                                                                                                                                                                                                                                                                                                        | Confirmed?                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `ArtifactSealer` needs no change | Confirmed via direct trace + empirical test (`packages/evidence/src/integrity/canonical.ts`'s `canonicalize` dependency preserves array order)                        | Initially assumed the opposite; corrected after re-reading `ArtifactSealer.seal`/`.verify` and `dsse.ts`'s `buildStatement`/`statementBytes` — the outer payload digest check compares stored bytes against a stored digest and never re-sorts; only this file's own internal re-derivation (`derivePendingTasks` vs. stored `pendingTasks`) is order-sensitive. | y (user, 2026-08-23)                              |
| Identity sort comparator         | Explicit UTF-16 code-unit relational comparison (`<`/`>`) for both V1 and V2                                                                                          | AD-018: a deliberate normalization, not a preservation. V1 historically ordered with ambient `localeCompare`, so rebuilt V1 ordering changes for identifier sets differing only by case; stored-artifact verification never re-sorts, no such artifact exists outside the fixtures, and #58 requires zero ambient-locale ordering on trust surfaces.                                                                                                                                                                                                     | y (correction; flagged for review in PR)          |
| Discriminator field              | Widen existing `ExecutionPackagePayload.schemaVersion: 1` to `1 \| 2`                                                                                                 | Already the field `normalizeBuildInput`/`normalizePayload` read and validate (`row["schemaVersion"] !== 1`); matches `safe-init.ts`'s exact T3 precedent (`value.schemaVersion === 2 ? V2 : V1`) rather than inventing a second, parallel version field like T4g's `canonicalizationVersion`.                                                                    | y (design-time default; flagged for review in PR) |
| New-package default              | `ExecutionPackageBuilder.build()` defaults to `schemaVersion: 2` when the caller doesn't specify one; `schemaVersion: 1` remains constructible for legacy/test parity | Matches T4g's "defaults new effects to explicit V2... preserves V1 bytes and reads" pattern; avoids silently changing every existing caller's build output shape without an explicit code review of the call site.                                                                                                                                               | y (design-time default; flagged for review in PR) |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Deterministic array ordering for new execution packages ⭐ MVP

**User Story**: As a Verchestra operator running the same execution plan on
two machines with different locale settings, I want the sealed execution
package's bytes and digest to be identical, so that portability and
tamper-evidence claims hold regardless of where the package was built.

**Why P1**: This is the entire point of #58 for this vertical — without it,
the signed-evidence surface can silently diverge across machines.

**Acceptance Criteria**:

1. WHEN a `schemaVersion: 2` execution package is built from inputs
   containing mixed-case sortable values (e.g. `taskId: "T-1"`,
   `taskId: "t-2"`) THEN the sealed payload's array order SHALL be
   determined by code-unit comparison, not `localeCompare`.
2. WHEN the same `schemaVersion: 2` build input is canonicalized under two
   different `Intl`/locale configurations THEN the resulting sealed payload
   bytes and `payloadDigest` SHALL be byte-identical.
3. WHEN `ExecutionPackageBuilder.build()` is called without an explicit
   `schemaVersion` THEN the system SHALL default to `schemaVersion: 2`.

**Independent Test**: Build the same mixed-case input with a hostile
`localeCompare` implementation and assert identical output bytes for both
recorded versions, with `schemaVersion: 1` retaining the pinned UTF-16
code-unit collection order. The mixed-case assertions kill a mutation that
reintroduces `localeCompare` into either version.

---

### P1: Backward-compatible verification of existing packages ⭐ MVP

**User Story**: As a Verchestra operator holding an already-sealed
`schemaVersion: 1` execution package, I want it to keep verifying
successfully after this migration ships, so that in-flight work is never
invalidated by an internal ordering-convention change.

**Why P1**: #58's own acceptance criterion: "Existing persisted/signed
formats either remain byte-compatible or receive an explicit
schema/version migration with backward verification coverage." A
verification regression here would break real in-flight execution plans.

**Acceptance Criteria**:

1. WHEN a `schemaVersion: 1` package sealed before this change is passed to
   `ExecutionPackageBuilder.verify()` THEN it SHALL verify successfully
   exactly as before, including the `derivePendingTasks` re-derivation
   check.
2. WHEN a `schemaVersion: 1` package's stored `pendingTasks` array reflects
   code-unit order for a mixed-case `taskId` set THEN `verify()` SHALL report
   `ok: true` (never a spurious `VES_EXECUTION_PACKAGE_DERIVATION_INVALID`).
   A V1 package whose stored order reflects the superseded ambient-collation
   ordering for such a set is a known, accepted casualty of AD-018: none
   exists outside the fixtures, and re-derivation is the only path that
   re-sorts.
3. WHEN a `schemaVersion: 2` package's stored `pendingTasks` array is
   re-derived at verify time THEN the re-derivation SHALL use code-unit
   order, matching what `build()` produced.

**Independent Test**: Hand-construct (or build under a simulated V1 path) a
`schemaVersion: 1` artifact whose `pendingTasks` order is the historical
code-unit order for a mixed-case fixture; verify it after the migration lands
and assert `ok: true`.

---

### P2: Cross-locale discrimination sensor

**User Story**: As a reviewer, I want a sensor that fails if the V2 path
regresses to ambient-locale ordering, so that this fix cannot silently
erode.

**Why P2**: Required by #58's acceptance criteria ("A discrimination sensor
replaces one canonicalizer with ambient-locale ordering and is killed") but
is a verification mechanism, not core behavior — P1 stories must land first.

**Acceptance Criteria**:

1. WHEN a mutation replaces the V2 code-unit comparator with
   `.localeCompare(` in any of the 11 sites THEN the mutation SHALL be
   killed by the discrimination sensor.

---

## Edge Cases

- WHEN an execution package build input mixes `schemaVersion: 1` and
  `schemaVersion: 2` semantics is impossible by construction (single
  top-level field) — no dual-version-in-one-object case exists.
- WHEN `pendingTasks` is empty (no tasks at all) THEN sort order is
  vacuously identical under either comparator — not a discriminating case,
  excluded from the sensor's fixture.
- WHEN two `taskId`/`requirementId`/etc. values are ASCII-only and
  same-case THEN `localeCompare` and code-unit order agree for common
  locales — the fixture data for every test in this feature MUST include at
  least one genuinely case-mixed pair (e.g. `"T-1"` vs `"t-2"`) to actually
  discriminate, matching the compatibility matrix's own stated concern.
- WHEN `bindings.sourceState`'s entries are sorted (line ~502) THEN the
  comparator change is applied for census-classification consistency, but
  no test needs to prove digest sensitivity for it (see Out of Scope) —
  only that it doesn't throw and produces the same object regardless of
  comparator (order-irrelevant once converted to an object).

---

## Requirement Traceability

| Requirement ID | Story                                      | Phase    | Status   |
| -------------- | ------------------------------------------ | -------- | -------- |
| CJ4I-01        | P1: Deterministic ordering                 | Verified | Verified |
| CJ4I-02        | P1: Deterministic ordering                 | Verified | Verified |
| CJ4I-03        | P1: Deterministic ordering                 | Verified | Verified |
| CJ4I-04        | P1: Backward-compatible verification       | Verified | Verified |
| CJ4I-05        | P1: Backward-compatible verification       | Verified | Verified |
| CJ4I-06        | P1: Backward-compatible verification       | Verified | Verified |
| CJ4I-07        | P2: Discrimination sensor                  | Verified | Verified |
| CJ4I-08        | Out of scope note: sourceState consistency | Verified | Verified |

**Coverage:** 8 requirements (CJ4I-01–07 mapped to acceptance criteria
above 1:1 in story order; CJ4I-08 covers the sourceState consistency edge
case), 8 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [x] `pnpm gate:security` passes; no assertion weakened.
- [x] `tests/security/canonical-json-census.test.mjs` reclassifies
      `packages/evidence/src/execution-package/execution-package.ts` from
      `pending-versioned-migration` to `migrated-v2` (or an equivalent
      accurate classification) with matching signal counts.
- [x] A pinned `schemaVersion: 1` fixture built before this change verifies
      unchanged.
- [x] A discrimination sensor proves code-unit ordering is genuinely
      exercised, not merely present.
