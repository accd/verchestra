---
schema: verchestra-feature-handoff/v1
feature: canonical-json
issue: 58
status: verification
branch: feat/canonical-json-t3-workspace
baseRevision: b94eef4bdf9841e7abba4e03d85fd401c2825258
lastCompletedTask: T13
nextTask: Independently verify T1-T13 against spec.md's 12 success criteria and design.md, then obtain human review before merge.
lastGate: pnpm gate:security
updatedAt: 2026-08-01T00:00:00Z
---

# Scope

Issue #58: every portable digest must name one locale-independent canonical
JSON contract. T1 (inventory) and T2 (compatibility matrix,
`docs/canonical-json-compatibility.md`) are merged to `main`. This handoff
covers **T3 only**: the V2 primitive plus the Workspace identity vertical.
T3 (T1–T13) is now implemented and gated on this branch, pending independent
Verifier review. T4 (the remaining ~15 owners in the matrix) stays out of
scope and gated on its own per-slice persisted-byte review.

Full plan: `spec.md` (CJ-01 through CJ-12, all 12 ticked with evidence),
`design.md`, `tasks.md` (T1–T13, all complete).

# Completed Evidence

- **T1**: static search found 178 occurrences of canonicalization or ambient
  collation across application, agent-runtime, policy, distribution,
  data-probe, workspace, and platform adapters.
- **T2**: `docs/canonical-json-compatibility.md` records the contract
  placement, every trust/persistent serializer group, byte consumers, V1
  preservation rules, and V2 migration boundaries.
- **T3 (T1–T4, Phase 1 — V2 primitive)**: `CANONICAL_JSON_V2` contract token
  in `packages/contracts`; a zero-import RFC 8785 JCS encoder and input guard
  in `packages/domain`; an architecture-boundary test pinning both as
  third-party- and `node:`-import-free.
- **T3 (T5–T8, Phase 2 — Workspace V2 identities)**: `buildInventoryFingerprintV2`
  alongside the untouched V1; `normalizeDeclaredSet` for explicit set
  ordering; the scanner's `repositoryId`/`discoveryKey`/`remoteFingerprint`/
  inventory `fingerprint` and the placement `planId` all migrated to V2 with
  their locale sorts replaced by code-unit ordering. Commits `3031d66`
  through `2ff7eca`.
- **T3 (T9–T11, Phase 3 — Journal versioning)**: the init recovery journal
  writes `schemaVersion: 2` with a `v2:sha256:` `planId`; `parseRecoveryJournal`
  dispatches its verifier on the recorded `schemaVersion`, failing closed on
  any version/prefix disagreement; a pinned `schemaVersion: 1` fixture still
  verifies unmodified; a discrimination sensor for both the locale-ordering
  and array-ordering mutations lives in `tests/security/` so `gate:security`
  actually runs it. Commits `762a760`, `ab485bb`, `abe31ad`.
- **T3 (T12–T13, Phase 4 — Evidence and docs)**: `docs/canonical-json-compatibility.md`
  corrected (the real architecture-rule blocker named, the encoder decision
  and date recorded, the Workspace row marked migrated, all five
  required-proof items marked satisfied with test paths). `AD-009` recorded
  in `.specs/STATE.md`. All 12 `spec.md` success criteria ticked with
  evidence. Commits `35ceee2`, and this handoff's own commit for T13.

# Next Exact Action

Independently verify T1–T13 against `spec.md`'s 12 success criteria (CJ-01
through CJ-12) and `design.md`, on a clean checkout of this branch:

1. Confirm every success-criterion evidence path in `spec.md` exists and
   actually demonstrates the claim (not just that the file exists).
2. Re-run `pnpm gate:security`; where it halts on pre-existing, unrelated
   native-`sqlite` (`fts5`) failures in `test:qualification`, confirm via
   `git stash` that the failing test set is identical with and without this
   branch's changes, then run `pnpm test:security` and `pnpm test:fault`
   directly to completion.
3. Confirm no existing assertion was weakened, skipped, or deleted — the only
   two test changes to pre-existing files are the owner-approved
   `sha256:` → `v2:sha256:` regex updates in `tests/integration/safe-init.test.mjs`
   (line 31, `preview.planId`; already-updated line 125 predates this batch
   from T7) recorded under Decisions below.
4. Write `validation.md` with the verification result, then hand off for
   human review before merge.

Human review and merge into `main` is the last remaining step after
independent verification passes.

# Blockers

None. The encoder decision that previously blocked T3 was resolved by the
owner on 2026-08-01 (see Decisions).

# Decisions

- **Encoder placement (owner, 2026-08-01):** implement an internal RFC 8785
  JCS encoder in `packages/domain` with zero imports. `canonicalize@3.0.0`
  stays in `packages/evidence` for the qualified V1 path and is **not** moved
  or added to domain. Recorded as `.specs/STATE.md` AD-009.
- **Why the previously recorded option was not taken:** the T2 matrix framed
  T3's blocker as only a dependency approval plus lockfile update. That is
  incomplete. `scripts/architecture.mjs:67-69` fails any non-relative import
  in `contracts`/`domain`/`application` with `VES_ARCH_THIRD_PARTY_IMPORT`
  (sole carve-out: `contracts` + `ajv`, line 65). Verified:
  `inspectSource("domain", 'import canonicalize from "canonicalize";')` →
  `[{ code: "VES_ARCH_THIRD_PARTY_IMPORT" }]`. Adding the dependency would
  have required widening an architecture control. T12 corrected the matrix.
- **Hashing stays out of domain:** `node:crypto` is barred from domain by the
  same rule (`VES_ARCH_DOMAIN_NODE_IMPORT`). The domain primitive is
  encode-only; SHA-256 stays in `packages/workspace`, which already declares
  `@verchestra/domain` as a dependency, so no new package edge is needed.
- **Versioning:** the recovery journal's existing `schemaVersion` is bumped
  1 → 2 (compatibility-matrix row 1), and identities become self-describing
  (`sha256:` for V1, `v2:sha256:` for V2) so a mixed-version comparison is a
  visible inequality rather than a silent false negative.
- **V1 is preserved, not replaced:** `buildInventoryFingerprint` stays
  byte-identical and still exported, because an existing `schemaVersion: 1`
  journal must keep verifying — proven with a pinned pre-slice fixture in
  both `tests/unit/workspace-fingerprint-v2.test.mjs` and
  `tests/integration/safe-init.test.mjs`.
- **Transient identities need no historical byte compatibility (owner,
  applied twice — T7 and T9):** `InitPreview.planId` and every scanner/
  placement identity migrated in this slice are recomputed in memory on each
  `preview()`/`scan()`/`createWritePlan()` call and are never themselves
  persisted independently of the journal or manifest they are copied into —
  they fall under compatibility-matrix row 3 ("a transient, recomputable
  in-memory value"). Under that classification, two pre-existing tests were
  updated from a bare `sha256:` regex to `v2:sha256:`:
  `tests/security/workspace-scanner-security.test.mjs:35` and
  `tests/integration/safe-init.test.mjs:124` (both T7), and
  `tests/integration/safe-init.test.mjs:31` (T9, `preview.planId`). No other
  pre-existing assertion was changed anywhere in T1–T13.
- Carried forward from the T1/T2 handoff: no mass replacement before
  persisted-byte compatibility is explicit; V1 persisted and signed bytes stay
  authoritative until their owning schema migrates.

# Findings Recorded For Later

- `tests/mutation/` is executed by no declared test script — it appears only
  in `scripts/gate-selection.mjs:36`. The existing
  `tests/mutation/verification-sensor.test.mjs` therefore never runs in any
  gate. This slice sidesteps it by placing its sensor in `tests/security/`
  (T11). The dormant directory deserves its own issue and is **not** fixed
  here.
- V1 sorts arrays (`scanner-primitives.ts:106`), so it silently treats every
  array as a set; RFC 8785 preserves array order. This is a semantic
  difference, not just a byte difference, and is why T6 adds explicit
  declared-set normalization instead of a drop-in swap.
- The write path (`safe-init.ts` `apply()`) now only ever produces
  `schemaVersion: 2` journals, so a genuine hard process crash can no longer
  leave a `schemaVersion: 1` record behind. T10's V1 recovery coverage
  (`tests/integration/safe-init.test.mjs`,
  `tests/fault-injection/safe-init-faults.test.mjs`) therefore reconstructs a
  pinned V1 journal directly rather than driving it through the hard-crash
  runner. This is expected and intentional, not a coverage gap: V1 support
  exists only for records genuinely persisted before this slice.

# Files Intentionally Left Unchanged

- `packages/evidence/src/integrity/canonical.ts` — the qualified V1 primitive.
  Replacing it belongs to a separately reviewed slice in T4.
- Every other owner row in `docs/canonical-json-compatibility.md` — T4.
- `docs/qualification/` — #58 is portability hardening, not a numbered product
  task in the T-chain, so no qualification report is recorded for it.
