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
| PR #108's 0.92 CI run predates the score-printing instrumentation this feature adds (`ci.yml` "Report Lighthouse scores"); its job log shows only `found: 0.92` for the composite category, no per-metric breakdown, and no `.lighthouseci` artifact was ever uploaded for that run — confirmed unrecoverable by inspecting the historical run's own log (`gh run view --job=90705185185 --log-failed`) | LPB-03's per-metric attribution is satisfied against a controlled reproduction instead: the discrimination sensor (LPB-07) injects a comparable regression and the resulting failing run is fully instrumented, giving a real named-metric breakdown for a failing case with the same "composite drops while LCP/CLS pass" shape the historical failure exhibited | The historical run's raw data is gone; refusing to satisfy LPB-03 at all would leave the requirement permanently unmet, while attributing loss on a fabricated number would violate the evidence-or-zero standard. A controlled case with the same shape is honest evidence; a guess about the historical case would not be. | y |
| ~~LPB-02 calls for `N = 10`; the initial CI-side classification used `N = 5`~~ **Superseded — resolved, not merely re-justified** | A throwaway draft PR on a scratch branch at the last pre-remedy commit (`c49f745`) collected 6 further single-run CI samples (one discarded as an unrelated runner-environment failure, per the Edge Cases section), completing an `N = 11` pre-remedy sample: `{0.92, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1}` | The PR #139 review correctly rejected "more samples can't change the answer" as a substitute for collecting them — a pre-registered rule exists precisely to prevent that reasoning. Median (index 5 of 11) = 1, minimum = 0.92: the instability classification is reaffirmed on the complete sample, not merely re-argued from an incomplete one. See `tasks.md`'s D2 evidence table for the full run-ID ledger. | y |

| The PR #139 review (point 1) asks for `aggregationMethod: "median"` to be applied *only* to `categories:performance`, leaving the other five assertions on lhci's default | **Deviate from the requested fix**: scope `median` to `categories:performance` as asked, but set the other five assertions explicitly to `pessimistic` rather than letting them fall back to the default `optimistic` | The reviewer's diagnosis is right — the global setting did change semantics for out-of-scope assertions — but the prescribed fix does not achieve the reviewer's own stated goal. Empirically confirmed against the installed `@lhci/utils@0.15.1` using real LHR fixtures: for a `minScore` assertion, `optimistic` resolves to `Math.max` across runs, which is *more* lenient than `median`. With accessibility scores `[0.9, 1, 1]`, the pre-change `N=1` baseline FAILS, while both `median` and the requested `optimistic` fallback PASS — so scoping alone does not restore the baseline and does not fix the reviewer's own example. Worse, with `[0.9, 0.9, 1]` the requested fallback PASSES where the current global `median` correctly FAILS, making the requested fix weaker than the state it is meant to repair. Only `pessimistic` (`Math.min` for `minScore`, `Math.max` for `maxNumericValue`) fails on any single bad run and so reproduces the `N=1` strictness the other assertions are entitled to. Evidence table in `tasks.md` Phase D. | y |

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
   values, and SHALL NOT attribute the loss to a metric whose assertion
   passed. WHEN the failing case being classified has no recoverable
   per-metric data (e.g., a historical CI run that predates this feature's
   own instrumentation), this MAY instead be satisfied by a controlled
   reproduction exhibiting the same score-loss shape, explicitly logged as
   substituted evidence rather than presented as the original run's data.

**Independent Test**: The recorded evidence answers "deterministic or unstable,
and in which metric" with numbers a reviewer can re-derive from the artifact
— from the classified case itself where its data survives, or from a logged
substitute reproduction where it does not.

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

### P1: Remediate the PR #139 review ⭐ MVP

**User Story**: As the reviewer of PR #139, I want the implemented assertion
semantics and the recorded evidence to actually match the stated scope, so
that the claimed PASS is trustworthy rather than a claim about a narrower
thing than it appears to cover.

**Why P1**: Review point 1 is a live weakening of gates that the spec declared
out of scope, and points 2 and 4 are integrity failures (a pre-registered rule
abandoned mid-way, and another feature's tracked state destroyed). None of
these can ship.

**Acceptance Criteria**:

1. **LPB-08** — WHEN any assertion other than `categories:performance` is
   evaluated over the 3-run sample THEN it SHALL fail if *any single run*
   fails it, matching the strictness of the pre-change `numberOfRuns: 1`
   baseline. `categories:performance` alone SHALL remain deliberately
   tolerant of one bad draw in three. A regression test SHALL assert this
   per-assertion split directly, so a future edit that widens the tolerant
   aggregation back across all assertions fails.
2. **LPB-09** — WHEN the classification recorded in `tasks.md` is stated as
   authoritative THEN it SHALL rest on the full pre-registered sample of
   `N = 10` pre-remedy single-run CI measurements, collected before the
   remedy is affirmed, and the median and minimum SHALL be recomputed over
   the complete sample. IF the completed sample changes the classification
   THEN the remedy SHALL be re-selected per LPB-02's rule rather than
   retro-fitted to the existing one.
3. **LPB-10** — WHEN the `Site quality` job finishes, pass or fail, THEN the
   complete `.lighthouseci` report set (per-run JSON and HTML) SHALL be
   uploaded as a retained CI artifact using a commit-pinned action
   consistent with this workflow, so a future failure is diagnosable from
   the reports rather than from a hand-picked subset of printed numbers.
4. **LPB-11** — WHEN this feature's tracked state is recorded THEN
   `.specs/features/lighthouse-performance-budget/handoff.md` SHALL exist and
   conform to `.specs/templates/feature/handoff.md`, the `external-review-triage`
   handoff in `.specs/STATE.md` SHALL be restored byte-for-byte to its
   pre-branch content, and `spec.md`'s Requirement Traceability statuses and
   Success Criteria checkboxes SHALL agree with the recorded verdict.
5. **LPB-12** — WHEN `validation.md` states the range it covers THEN that
   range SHALL include the actual reviewed head commit and its commit count
   SHALL match `git rev-list --count` for the stated range.

**Independent Test**: A reviewer can run the LPB-08 regression test, recount
the LPB-09 sample, download the LPB-10 artifact from a CI run, diff
`.specs/STATE.md` against `main` to see only additive change, and verify
LPB-12's range arithmetic — each without taking any prose claim on trust.

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
| LPB-01 | P1: Classify the failure | Execute | Verified (T1) |
| LPB-02 | P1: Classify the failure | Execute | Verified — reaffirmed on the complete `N = 11` sample (LPB-09) |
| LPB-03 | P1: Classify the failure | Execute | Verified (T3, substituted evidence per the LPB-03 clause) |
| LPB-04 | P2: Restore the gate | Execute | Not applicable — classification was instability, not deterministic |
| LPB-05 | P2: Restore the gate | Execute | Verified (T4), pending LPB-08 rescope |
| LPB-06 | P2: Restore the gate | Execute | Verified (T5) |
| LPB-07 | P3: Prove the gate discriminates | Execute | Verified (T6) |
| LPB-08 | P1: Remediate the PR #139 review | Tasks (D1) | Pending |
| LPB-09 | P1: Remediate the PR #139 review | Tasks (D2) | Verified (D2) |
| LPB-10 | P1: Remediate the PR #139 review | Tasks (D3) | Pending |
| LPB-11 | P1: Remediate the PR #139 review | Tasks (D4) | Pending |
| LPB-12 | P1: Remediate the PR #139 review | Tasks (D5) | Pending |

**Coverage:** 12 total, 12 mapped to tasks, 0 unmapped.

LPB-04 and LPB-05 are conditional on the LPB-02 classification. Exactly one is
required; both apply if both conditions hold. Neither may be implemented before
LPB-02 returns. LPB-02 is reopened by review point 2: its classification does
not stand as authoritative until LPB-09 completes the pre-registered sample,
and LPB-05's remedy is provisional until then.

---

## Success Criteria

- [x] The 0.92 result is attributed to a named cause with re-derivable numbers
      (via the substituted controlled reproduction permitted by LPB-03).
- [x] `categories:performance` is still `minScore: 0.95` in `lighthouserc.cjs`.
- [x] `pnpm site:test` passes, and the Lighthouse stage's cost fits the job budget.
- [x] An injected regression is shown to fail the restored gate.
- [ ] No assertion in `lighthouserc.cjs` is weaker than its pre-change
      `numberOfRuns: 1` behavior, except `categories:performance` where the
      tolerance is the deliberate point of the feature (LPB-08).
- [x] The classification rests on the complete pre-registered `N = 10` sample
      (LPB-09) — `N = 11` collected, median = 1, minimum = 0.92.
- [ ] A failing `Site quality` run leaves behind the full Lighthouse reports
      (LPB-10).
- [ ] Feature handoff exists and no unrelated tracked state was destroyed
      (LPB-11).
