---
schema: verchestra-qualification-report/v1
task: T74
revision: 24e3a02faefdada5838786487f3fe842e909f225
gates: pnpm gate:quick, pnpm gate:security
gateResults: pass, pass
gateRevision: 24e3a02faefdada5838786487f3fe842e909f225
criteriaEvidence: 9 of 9 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 14 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/290
---

# T74 Sealed-Holdout Evaluator and Promotion Gate Validation

## Scope and revision binding

This report independently validates the merged T74 implementation at exact
revision `24e3a02faefdada5838786487f3fe842e909f225`, which is reachable from
`origin/main`. The implementation slice was authored by `accd` in the merged
T74 F3 change; this report and its final sensor were authored by `MiguelCorre`.
The implementation surface is unchanged from `f1dca25`: the later bound
revision contains only the independent verification and handoff evidence.

The evaluator seals the canonical oracle, keeps evaluator identity distinct from
the candidate, snapshots raw evaluator-owned boolean observations before the
candidate callback receives a surface, recomputes campaign statistics through
`evaluateCampaign`, binds observations into the evidence and source-state
digests, and gives the candidate a real zero-authority grant over every named
protected asset. The owner decision AD-018 deliberately scopes 1.0 to an
authority boundary rather than a process or storage boundary; the supplied
`contaminated` fact remains an explicit partial follow-up, not a claim of an
observed out-of-process detector.

## Focused evidence

The T74-focused set contains 80 passing cases with zero failed, skipped, or todo
cases: 32 unit cases in `tests/unit/promotion-gate.test.mjs` and
`tests/unit/promotion-evidence-binding.test.mjs`, 33 security cases in
`tests/security/promotion-gate.test.mjs` and
`tests/security/promotion-candidate-authority.test.mjs`, and 15 E2E cases in
`tests/e2e/promotion-gate-e2e.test.mjs`. The security plus E2E subset is 48
cases, exceeding the issue's minimum of 25.

The F3 adversarial cases cover forged candidate metrics, malformed bounds,
duplicate campaign ids, extra failed campaigns, live candidate replacement,
short and missing observations, non-boolean observations, and materially
different evaluator outcomes. None can replace or alter the evaluator-owned
observations used by the decision.

## Deterministic gates

Both gates ran against the exact bound revision above, not against this report
commit.

| Command | Result | Evidence |
| ------- | ------ | -------- |
| `pnpm gate:quick` | PASS | Linux manual qualification run [32576041915](https://github.com/accd/verchestra/actions/runs/32576041915), job 97038441542, exact candidate SHA verified; 2,059 unit and 150 agent-readiness cases passed, with zero failed, skipped, or todo. |
| `pnpm gate:security` | PASS | Linux manual qualification run [32575867942](https://github.com/accd/verchestra/actions/runs/32575867942), job 97038024666, exact candidate SHA verified; 2,059 unit, 497 contract, 165 E2E, 25 architecture, 251 qualification, 1,044 security, and 283 fault cases passed, with zero failed, skipped, or todo. |

The same focused tests also passed in this independent Windows worktree:
80/80 focused cases, followed by `corepack pnpm gate:quick` with 2,059 unit and
150 readiness cases. The Linux runs are the durable gate evidence because they
exercise the repository's qualified CI environment.

## Adequacy matrix

| Criterion | Requirement | Independent assertion evidence |
| --------- | ----------- | ------------------------------ |
| PROM-01 | The canonical oracle, campaign ids, thresholds, and repetition counts are sealed and drift fails closed. | `promotion-gate.test.mjs`: deterministic canonical oracle, tampered seal, threshold drift, declaration-order invariance; M1 and M4 below. |
| PROM-02 | A changed candidate digest blocks promotion. | `promotion-gate.test.mjs` and E2E mutation cases assert `VES_PROMOTION_CANDIDATE_MUTATED`; M2. |
| PROM-03 | Missing or short evaluator observations block for insufficient repetition. | Unit, security, and E2E cases cover short and missing observations; M5 removes both admission checks. |
| PROM-04 | A threshold change cannot silently alter the sealed evaluation. | Oracle canonicalization includes thresholds and the drift case changes the seal; M4 kills threshold omission. |
| PROM-05 | Contamination blocks promotion regardless of outcomes under the AD-018 in-scope supplied fact contract. | Unit, security, and E2E cases assert `VES_PROMOTION_CONTAMINATED` with all-pass observations; M3 removes the block. AD-018 explicitly does not claim observed process/storage contamination detection. |
| PROM-06 | The signed report binds candidate, holdout, policy, evaluator identity, and exact observed evidence, with tamper detection. | Evidence-binding unit/E2E cases distinguish observations and oracle changes; report schema/allowlist/tamper cases; M7 and M8. |
| PROM-07 | Promotion occurs only when every sealed campaign clears its lower confidence bound. | Unit, security, and E2E clean/failing/accumulated-block cases; M6 removes the lower-bound check. |
| PROM-08 | At least 25 security/E2E cases pass, required gates pass, and independent review remains explicit. | 48 focused security/E2E cases, Linux gate evidence above, 14 killed mutations, and this verifier-authored report with a review PR. |
| PROM-09 | The candidate receives a real surface, while reads and mutations of every protected asset are denied by authority. | Candidate-authority security cases cover oracle, criteria, evaluator state, and pre-seal report; M9, M10, and M13. |

## Issue acceptance and completion checklist

| Issue #15 outcome | Evidence |
| ---------------- | -------- |
| Candidate cannot read or modify protected evaluator assets before sealing | The real grant exposes all four named assets, grants no read or mutate capability, and each attempt is denied; the deep snapshot test proves a granted read cannot mutate evaluator-owned values. |
| Leakage, threshold drift, insufficient repetition, candidate mutation, or report tamper blocks | Exact public block codes and report tamper assertions cover each path; M1, M2, M4, M5, M8, and M12 discriminate their enforcement. |
| Decision binds exact candidate, campaign, policy, threshold, evidence, and evaluator identity | Report fields include candidate/holdout/policy/evaluator/evidence digests; raw observations are canonicalized and source-state-bound; M7 proves material evidence changes the sealed artifact. |
| At least 25 security and E2E cases pass | 48 focused security/E2E cases pass; the exact Linux security gate passes 165 E2E and 1,044 security cases. |
| Authority isolation, contamination/tamper evidence, independent verification, and atomic evidence | PROM-09 tests and sensor above; contamination/tamper paths are exercised; this report is the separate verifier evidence and is committed atomically on its own branch. |

## Discrimination sensor

Fourteen mutations were applied one at a time in a disposable detached
worktree at the exact bound revision. Each mutation was exercised by the
smallest relevant T74 focused suite, then restored with `git restore`; every
restoration was checked with `git diff --exit-code`, and the disposable
worktree was removed afterward.

| # | Property | Mutation | Result |
| - | -------- | -------- | ------ |
| M1 | PROM-01 oracle integrity | Disable the recomputed oracle-seal comparison. | KILLED by tampered-seal and threshold-drift tests. |
| M2 | PROM-02 candidate immutability | Disable the candidate digest comparison. | KILLED by candidate-mutation tests. |
| M3 | PROM-05 contamination block | Remove the contamination block. | KILLED by unit/security/E2E contamination cases. |
| M4 | PROM-01/PROM-04 threshold binding | Remove the sealed threshold from oracle-derived data. | KILLED by seal and drift cases. |
| M5 | PROM-03 repetition | Remove short-observation admission and result sample checks. | KILLED by short/missing repetition cases. |
| M6 | PROM-07 lower-bound policy | Remove the campaign lower-confidence-bound comparison. | KILLED by failing-campaign cases. |
| M7 | PROM-06 evidence binding | Bind sealed source state to the oracle only, omitting observations. | KILLED because materially different observations then collide. |
| M8 | PROM-06 report integrity | Replace the report body digest input with a constant. | KILLED by report tamper and verification cases. |
| M9 | PROM-09 zero authority | Grant the evaluator's protected assets to the candidate. | KILLED by read/mutate denial cases. |
| M10 | PROM-09 deep isolation | Replace the structural snapshot with a shallow copy. | KILLED by deep-write isolation case. |
| M11 | F3 exact observation set | Accept duplicate and unknown observation ids. | KILLED by duplicate/extra fail-closed cases. |
| M12 | F3 runtime observation types | Remove boolean validation. | KILLED by malformed observation cases. |
| M13 | PROM-09 production wiring | Do not invoke the candidate surface during `runPromotion`. | KILLED by real-asset wiring case. |
| M14 | F3 evaluator-owned capture | Replace the collected observations with an empty constant. | KILLED by missing-observation and promotion cases. |

All 14 mutations were killed; none survived. No source or test mutation
remains in the verification worktrees.

## Non-shallow checks and explicit scope

- Candidate facts contain no campaign aggregates or result list. The only
  campaign evidence accepted by the gate is collected through the evaluator's
  observation port before the candidate callback.
- `evaluateCampaign` derives samples, passes, pass rate, Wilson lower bound, and
  verdict from raw booleans. Runtime duplicate, extra, malformed, and
  non-boolean observations fail closed.
- The signer identity is the fixed evaluator identity `holdout-evaluator` and
  differs from the candidate identity. The sealed artifact binds both oracle
  and observed evidence in `sourceStateDigest`.
- AD-018 deliberately defers process/storage isolation and an observed
  contamination detector to the post-1.0 extension-host work (#235). This
  report does not claim either property; it records the owner-approved
  authority-boundary contract that T74 implements.
- No public installer, production readiness, or 1.0 release is claimed.

## Verdict

T74 is independently verified at the exact merged revision named above: all
nine owner-approved specification criteria have file-and-assertion evidence,
the 48-case security/E2E minimum is exceeded, both exact-head Linux gates pass
with zero failed/skipped/todo cases, and all 14 discrimination mutations are
killed. This report is evidence for human review in the pull request named by
`reviewedIn`; the qualification chain must not advance and issue #15 must not
be closed until that review and merge occur.
