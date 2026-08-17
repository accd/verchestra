---
schema: verchestra-feature-handoff/v1
feature: sealed-holdout
issue: 15
status: in_progress
branch: codex/t74-reverification
baseRevision: 36fb77fbc20c9d5cd2810196bf2007968eb7e087
lastCompletedTask: T5
nextTask: "Implementation author remediates repeat-verification F3: move results out of CandidateFacts, establish evaluator-owned provenance, validate the exact result set, and recompute aggregates; then MiguelCorre re-verifies."
lastGate: "Repeat verification FAIL at 36fb77f: 94/94 focused and 8/8 sensors pass; gate:quick PASS; gate:security incomplete on unrelated Windows EBUSY cleanup; F3 promotes five invalid candidate-controlled evidence sets."
updatedAt: 2026-08-17T16:44:53Z
---

# Repeat verification failed on F3 (2026-08-17)

F1 and F2 pass independent re-verification: 94 focused cases pass and eight of
eight mutations are killed with no source residue. T74 still fails because
`CandidateFacts.results` lets the candidate supply the evidence used to promote
itself, while the gate performs no runtime result validation or evaluator-side
recomputation. Forged metrics, a string lower bound, duplicate ids with a
passing last entry, an extra failed campaign, and live replacement through the
candidate callback all produce `PROMOTED`.

The full experiment, gate evidence, sensor, and exact remediation are recorded
in `validation.md`. Do not create `docs/qualification/t74-validation.md` or
advance the chain until F3 is remediated and independently re-verified.

# F2 remediated (2026-08-11, PR #260)

The signed promotion decision now binds the admitted campaign evidence.
`canonicalizeCampaignEvidence` feeds an `evidenceDigest` into the report body,
so it reaches `bodyDigest` and the sealed payload, and the composition root's
`sourceStateDigest` binds the oracle **and** the evidence. The verifier's own
experiment now separates: two materially different passing evidence sets
produce different digests.

Two things worth carrying forward:

- **Deliberate deviation, owner-confirmed.** Results are normalized as a
  declared set keyed by campaign id (CJ4-03), so reordering the same evidence
  is identity-preserving. F2's text asked for the opposite; a digest that moved
  with iteration order would make the same evidence sign differently on
  different machines. Marked `SPEC_DEVIATION` in the source.
- **The contract IS generated.** An assumption that `PromotionReportPayload`
  was hand-written was wrong and the contract-drift test caught it. The type
  comes from the schema via `scripts/generate-contract-types.mjs`.

# F1 remediated (2026-08-11, PR #264) under AD-018

The owner narrowed the scope first (AD-018, PR #263), then the boundary was
built: the candidate holds a real surface where every protected asset is
reachable by name, and the evaluator's grant admits none of them. The gate
consults the grant rather than refusing unconditionally, so the zero-authority
claim is something a test can see rather than trust.

Read and write are separate capabilities — the sensor forced that. Fused, a
mutation that wrote before authorizing survived every test, because the
verifying read went through a second grant with its own copy and could not see
the write.

**Still not claimed:** the evaluator and candidate share a process and a store
(#235, post-1.0), and PROM-05's contamination fact remains a supplied input —
the honest PARTIAL the T74 verification recorded, deliberately not promoted.

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

# First independent verification result

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

The implementation author remediates F3 with behavior-focused unit, security,
and E2E evidence. An independent verifier then repeats the audit. Do not add
`docs/qualification/t74-validation.md` or advance the status surfaces until
that verification passes.

# Blockers

F3 in `validation.md` blocks T74 qualification and the serial chain. T75 must
not be treated as the next qualified task until it is remediated and an
independent PASS report lands.

# Follow-ups

Contamination reaches the gate as a boolean fact; wiring a real
contamination-detection adapter (observing whether a candidate read the oracle
store) is a worthwhile follow-up once a live evaluation harness exists.
