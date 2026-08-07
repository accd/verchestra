---
schema: verchestra-feature-handoff/v1
feature: sealed-holdout
issue: 15
status: verification
branch: feat/t74-sealed-holdout
baseRevision: d0ea1e57e00aa4de22b4aa0331d5ecbdb9df3c04
lastCompletedTask: T5
nextTask: independent T74 qualification report and chain advance to T75
lastGate: gate:quick PASS; gate:security and gate:build confirm the surface
updatedAt: 2026-08-07T10:13:43Z
---

# Scope

Implement T74 (#15): a sealed-holdout evaluator that makes a signed,
tamper-resistant promotion decision without leaking its oracle to the candidate.
Reuses the T73 campaign results as evidence. Spec, design, and tasks are in this
feature directory.

# Authority and external effects

The owner authorized advancing the beta chain autonomously and merging the
feature. The implementation is complete and merges to `main`. The qualification
chain is NOT advanced here: T74 is qualified by a separate verifier (author !=
verifier), who writes `docs/qualification/t74-validation.md` and migrates the
status surfaces to "T74 complete; T75 next".

# Completed evidence

- T1: pure promotion rules `packages/application/src/promotion/promotion-gate.ts`
  — `canonicalizeOracle` (seals thresholds + repetitions), `evaluatePromotion`
  (blocks on oracle tamper, candidate mutation, shared identity, contamination,
  insufficient repetition, or a campaign below its sealed lower bound), and a
  tamper-resistant report (`bodyDigest`). 21 unit cases.
- T2: `schemas/promotion-report/1.schema.json` + generated type + 10 contract
  cases.
- T3: `apps/vestra-cli/src/promotion-composition.ts` — seals the oracle before
  evaluation, constructs the distinct `holdout-evaluator` identity, and seals the
  promotion report with `ArtifactSealer`.
- T4: 12 security + 13 e2e cases — evaluator identity distinct from candidate,
  each block condition, tamper detection, no path/secret leak, and PROMOTED only
  when clean.
- `pnpm gate:quick` PASS; `pnpm gate:security` and `pnpm gate:build` confirm the
  security and contract/e2e surfaces.

# Next action

None for the implementation. The remaining step is the independent T74
qualification (author != verifier): re-derive the PROM-01..08 adequacy matrix,
run a discrimination sensor on the pure promotion rules, write
`docs/qualification/t74-validation.md`, and migrate the status surfaces to
"T74 complete; T75 next".

# Blockers

None for T74. Chain-level: T76 is blocked on the owner's DSSE/in-toto and
context-tokenizer decisions (AD-008); T77 is the 1.0 decision. The beta cannot be
reached without owner input.

# Follow-ups

Contamination reaches the gate as a boolean fact; wiring a real
contamination-detection adapter (observing whether a candidate read the oracle
store) is a worthwhile follow-up once a live evaluation harness exists.
