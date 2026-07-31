# Lighthouse Performance Budget Specification

Issue: #110 — Diagnose and restore Site quality Lighthouse performance budget.

## Problem Statement

The `Site quality` job failed on PR #108 (CI run `30489992711`) with a single
failing assertion: `categories:performance` scored 0.92 against the required
0.95 in `apps/site/lighthouserc.cjs:18`. Site unit tests, `astro check`, the
build, the built-site check, and 51 Playwright E2E tests all passed, and PR #108
changed no site code. A performance budget that fails on a change which cannot
have caused it is not a budget — it is an unattributable stop signal, and the
only two ways it can be resolved today are waiving the threshold or blaming an
unrelated change. Both destroy the gate's meaning.

The cause is currently unknown. This feature's first obligation is to find out
which of two mutually exclusive things is true, and only then to fix it.

## Goals

- Classify the 0.92 result as deterministic site cost or measurement
  instability, by evidence, using a decision rule fixed before the data is
  collected.
- Restore `Site quality` to a state where a pass means the site meets its
  performance budget and a fail means it does not.
- Keep the 0.95 threshold intact.
- Leave behind a sensor that fails when a real performance regression is
  introduced, so the restored gate is demonstrably discriminating rather than
  merely green.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| Lowering `categories:performance` below 0.95 | The issue forbids it. Only a human changing product performance policy with evidence may move it. |
| Relaxing the accessibility, best-practices, or SEO assertions (all `minScore: 1`) | They pass today. Touching them is unrelated scope. |
| Adding URLs beyond the measured homepage | Coverage expansion is a separate concern from restoring the existing budget. |
| Re-architecting the Starlight theme or replacing Mermaid | A rewrite is not a diagnosis. Only the bottleneck the evidence names may be changed. |
| Retroactively re-running or re-judging PR #108 | #108 is closed evidence; this feature fixes the gate, not the PR. |
| Fixing the CI runner's hardware variance itself | Not ours to control; the design must tolerate it, not eliminate it. |

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| "Reproduce from the exact CI command" means `pnpm site:test`'s Lighthouse stage, not the whole job | Reproduce via `pnpm --filter @verchestra/site test:lighthouse` against a fresh `pnpm site:build` | That stage is the failing unit; running 51 E2E tests first adds hours without changing the measured artifact. Runner-contention effects are captured separately in LPB-02's ordering probe. | n |
| Local hardware cannot reproduce a CI-runner-specific score | Treat a local pass as non-disproving; classification rests on the distribution shape (LPB-02), not on a single local number matching 0.92 | A developer laptop is faster than a 2-vCPU `ubuntu-latest` runner; demanding an exact 0.92 locally would be unachievable and would stall the task. | n |
| `numberOfRuns: 1` (`lighthouserc.cjs:10`) is the leading instability suspect | Named as a hypothesis to test in LPB-02, not as a foregone conclusion | Lighthouse's own guidance is that a single run is not a reliable sample, but asserting the cause before measuring is the exact error the issue warns against. | n |
| Increasing sample count consumes CI budget | Any sampling change must fit the existing `timeout-minutes: 45` (`ci.yml:82`) with the measured margin recorded | The job already documents a ~23-minute worst case; an unbounded sample count would reintroduce the cancellation failure mode that block comments describe. | n |
| The composite score dropped while `largest-contentful-paint` and `cumulative-layout-shift` assertions passed | Diagnosis must begin from the per-metric breakdown, since the failing weight is necessarily in a metric with no standalone assertion (most likely Total Blocking Time or Speed Index) | Both explicitly asserted metrics held at their thresholds, so the composite loss is located elsewhere; this narrows LPB-02 before any data is gathered. | n |

**Open questions:** none — all resolved or logged above.

## User Stories

### P1: Classify the failure ⭐ MVP

**User Story**: As the maintainer, I want the 0.92 result attributed to either
site cost or measurement noise with evidence, so that I fix the real cause
instead of guessing.

**Why P1**: Every remedy is downstream of this answer, and the two answers have
disjoint fixes. Shipping a fix without it is the waiver the issue prohibits.

**Acceptance Criteria**:

1. **LPB-01** — WHEN the Lighthouse stage is run against a production build of
   the current `main` THEN the run SHALL complete and emit a `.lighthouseci`
   artifact containing the per-category scores and the per-metric numeric
   values, and the observed `categories:performance` score SHALL be recorded in
   the feature evidence.
2. **LPB-02** — WHEN the same unchanged build is measured `N = 10` times THEN
   the median and the minimum `categories:performance` score SHALL be recorded,
   and the result SHALL be classified by this rule, fixed in advance:
   - median < 0.95 → **deterministic**: the site does not meet its budget;
   - median ≥ 0.95 AND minimum < 0.95 → **instability**: the budget is met
     typically, and single-sample measurement draws failures from the spread;
   - median ≥ 0.95 AND minimum ≥ 0.95 → **not reproduced locally**: escalate to
     CI-only measurement before any remedy is chosen.
3. **LPB-03** — WHEN the classification is recorded THEN it SHALL name the
   specific metric or metrics carrying the score loss, with their numeric
   values, and SHALL NOT attribute the loss to a metric whose assertion passed.

**Independent Test**: The recorded evidence answers "deterministic or unstable,
and in which metric" with numbers a reviewer can re-derive from the artifact.

---

### P2: Restore the gate

**User Story**: As the maintainer, I want `Site quality` to pass for a healthy
site and fail for an unhealthy one, so that the budget is trustworthy again.

**Why P2**: It is the point of the work, but it is not implementable until P1
returns an answer.

**Acceptance Criteria**:

1. **LPB-04** — WHEN the classification is **deterministic** THEN the change
   SHALL reduce the cost of the named bottleneck metric until the median score
   is ≥ 0.95, and SHALL NOT alter any assertion threshold.
2. **LPB-05** — WHEN the classification is **instability** THEN the measurement
   SHALL be made statistically sound — evaluating the budget against an
   aggregate of multiple runs rather than one sample — while
   `categories:performance` remains `minScore: 0.95`.
3. **LPB-06** — WHEN the restored configuration is run THEN the full
   `pnpm site:test` SHALL pass, and the Lighthouse stage's wall-clock cost
   SHALL be recorded and shown to fit the job's `timeout-minutes: 45` budget
   alongside the existing ~23-minute worst case.

**Independent Test**: `pnpm site:test` passes on an unmodified checkout, and the
recorded timing shows the job budget is not exceeded.

---

### P3: Prove the gate discriminates

**User Story**: As a reviewer, I want proof that the restored budget still
fails on a genuine regression, so that "green" is not just the absence of
measurement.

**Why P3**: Valuable and explicitly requested ("add a discriminating regression
sensor"), but the gate is restored without it.

**Acceptance Criteria**:

1. **LPB-07** — WHEN a deliberate performance regression is injected into the
   built site in scratch state THEN the performance assertion SHALL fail, and
   WHEN the injection is removed THEN it SHALL pass, with both outcomes
   recorded and the mutation discarded.

---

## Edge Cases

- WHEN the Lighthouse stage cannot start its preview server THEN the failure
  SHALL be reported as an environment failure distinct from a budget failure,
  consistent with the existing `ci.yml` convention of naming runner failures
  separately from qualification failures.
- WHEN the local median and the CI median disagree in classification THEN CI
  SHALL be treated as authoritative, since CI is the environment the gate
  actually runs in.
- WHEN both classifications hold — the median sits below 0.95 *and* the spread
  is wide — THEN both LPB-04 and LPB-05 SHALL apply; they are not exclusive
  remedies.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| LPB-01 | P1: Classify the failure | Tasks | Pending |
| LPB-02 | P1: Classify the failure | Tasks | Pending |
| LPB-03 | P1: Classify the failure | Tasks | Pending |
| LPB-04 | P2: Restore the gate | Tasks (conditional) | Pending |
| LPB-05 | P2: Restore the gate | Tasks (conditional) | Pending |
| LPB-06 | P2: Restore the gate | Tasks | Pending |
| LPB-07 | P3: Prove the gate discriminates | Tasks | Pending |

**Coverage:** 7 total, 7 mapped to tasks, 0 unmapped.

LPB-04 and LPB-05 are conditional on the LPB-02 classification. Exactly one is
required; both apply if both conditions hold. Neither may be implemented before
LPB-02 returns.

---

## Success Criteria

- [ ] The 0.92 result is attributed to a named cause with re-derivable numbers.
- [ ] `categories:performance` is still `minScore: 0.95` in `lighthouserc.cjs`.
- [ ] `pnpm site:test` passes, and the Lighthouse stage's cost fits the job budget.
- [ ] An injected regression is shown to fail the restored gate.
- [ ] No assertion in `lighthouserc.cjs` was weakened or removed.
