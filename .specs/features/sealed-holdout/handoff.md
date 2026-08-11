---
schema: verchestra-feature-handoff/v1
feature: sealed-holdout
issue: 15
status: in_progress
branch: codex/t74-qualification
baseRevision: cdd73b764b85732f797da68df84f3f01eabb9f5a
lastCompletedTask: T5
nextTask: implementation remediation for independent findings F1 and F2, then repeat T74 verification
lastGate: independent verification FAIL; gate:quick and gate:security PASS at cdd73b7; 7/7 sensor mutations killed
updatedAt: 2026-08-11T19:40:00Z
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

# Independent verification result

Independent verification at `cdd73b7` is **FAIL**. The implemented rule
surface passes 58 focused cases, `gate:quick`, externally dispatched
`gate:security`, and a seven-mutation sensor with zero survivors. Those checks
also exposed two acceptance boundaries that are absent rather than incorrectly
implemented:

- F1: no candidate/evaluator process, storage, or policy isolation boundary
  exists to prove the first issue acceptance criterion.
- F2: the report and sealed artifact do not bind campaign result evidence;
  materially different passing results produce identical signed payloads.

The complete evidence and exact remediation are in `validation.md`.

# Next action

The implementation authors remediate F1 and F2 with behavior-focused security,
fault, contract, and E2E evidence. An independent verifier then repeats the
audit. Do not add `docs/qualification/t74-validation.md` or advance the status
surfaces until that verification passes.

# Blockers

F1 and F2 in `validation.md` block T74 qualification and the serial chain. T75
must not be treated as the next qualified task until both are remediated and an
independent PASS report lands.

# Follow-ups

Contamination reaches the gate as a boolean fact; wiring a real
contamination-detection adapter (observing whether a candidate read the oracle
store) is a worthwhile follow-up once a live evaluation harness exists.
