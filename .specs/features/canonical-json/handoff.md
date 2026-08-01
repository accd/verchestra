---
schema: verchestra-feature-handoff/v1
feature: canonical-json
issue: 58
status: planned
branch: TBD — cut from main before T1
baseRevision: b94eef4bdf9841e7abba4e03d85fd401c2825258
lastCompletedTask: T2
nextTask: Execute T1 of .specs/features/canonical-json/tasks.md
lastGate: pnpm agent:check
updatedAt: 2026-08-01T00:00:00Z
---

# Scope

Issue #58: every portable digest must name one locale-independent canonical
JSON contract. T1 (inventory) and T2 (compatibility matrix,
`docs/canonical-json-compatibility.md`) are merged to `main`. This handoff
covers **T3 only**: the V2 primitive plus the Workspace identity vertical.
T4 (the remaining ~15 owners in the matrix) stays out of scope and gated on
its own per-slice persisted-byte review.

Full plan: `spec.md` (CJ-01 through CJ-12), `design.md`, `tasks.md` (T1–T13).

# Completed Evidence

- **T1**: static search found 178 occurrences of canonicalization or ambient
  collation across application, agent-runtime, policy, distribution,
  data-probe, workspace, and platform adapters.
- **T2**: `docs/canonical-json-compatibility.md` records the contract
  placement, every trust/persistent serializer group, byte consumers, V1
  preservation rules, and V2 migration boundaries. No production serializer
  changed.
- **T3 planning (this handoff)**: spec, design, and task breakdown written and
  grounded in the codebase. Two blocking facts were established that the T2
  matrix had missed — see Decisions.

# Next Exact Action

Execute T1 of `tasks.md` (declare `CANONICAL_JSON_V2` in
`packages/contracts`), then proceed sequentially. Batch 1 is T1–T8, batch 2 is
T9–T13. A fresh independent Verifier runs after T13 and writes
`validation.md`.

Cut a branch from `b94eef4` first — the plan is not implemented and no
production code has changed.

# Blockers

None. The encoder decision that previously blocked T3 was resolved by the
owner on 2026-08-01 (see Decisions).

# Decisions

- **Encoder placement (owner, 2026-08-01):** implement an internal RFC 8785
  JCS encoder in `packages/domain` with zero imports. `canonicalize@3.0.0`
  stays in `packages/evidence` for the qualified V1 path and is **not** moved
  or added to domain.
- **Why the previously recorded option was not taken:** the T2 matrix framed
  T3's blocker as only a dependency approval plus lockfile update. That is
  incomplete. `scripts/architecture.mjs:67-69` fails any non-relative import
  in `contracts`/`domain`/`application` with `VES_ARCH_THIRD_PARTY_IMPORT`
  (sole carve-out: `contracts` + `ajv`, line 65). Verified:
  `inspectSource("domain", 'import canonicalize from "canonicalize";')` →
  `[{ code: "VES_ARCH_THIRD_PARTY_IMPORT" }]`. Adding the dependency would
  have required widening an architecture control. T12 corrects the matrix.
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
  journal must keep verifying.
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

# Files Intentionally Left Unchanged

- `packages/evidence/src/integrity/canonical.ts` — the qualified V1 primitive.
  Replacing it belongs to a separately reviewed slice in T4.
- Every other owner row in `docs/canonical-json-compatibility.md` — T4.
- `docs/qualification/` — #58 is portability hardening, not a numbered product
  task in the T-chain, so no qualification report is recorded for it.
