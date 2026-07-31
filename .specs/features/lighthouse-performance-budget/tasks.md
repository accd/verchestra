# Lighthouse Performance Budget Tasks

Issue: #110. Spec: `./spec.md`.

## Shape of this plan

This is a **diagnosis-gated** plan, not a linear one. Phase B cannot be written
in full until Phase A returns a classification, because the two possible
classifications have disjoint remedies. Committing to a remedy now would be the
same error the issue warns against — attributing the failure instead of
diagnosing it.

Phase A is therefore fully specified. Phase B is specified as two mutually
exclusive branches with a decision gate between them.

```
Phase A (diagnose)  ──►  GATE: classification  ──┬──► B1 deterministic: optimize
                                                 ├──► B2 instability: fix sampling
                                                 └──► B3 not reproduced: measure in CI
                                                          │
                                                          ▼
                                              Phase C (sensor + evidence)
```

## Phase A — Diagnose (blocking, no remedy permitted)

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T1 | Reproduce the Lighthouse stage locally against a production build of current `main`; capture the `.lighthouseci` artifact and record the observed performance score and full per-metric breakdown (LPB-01) | None | Artifact exists; score and metric values recorded in `validation.md` |
| T2 | Run the unchanged build `N = 10` times; record median, minimum, and spread of `categories:performance`; apply the pre-fixed decision rule from LPB-02 (LPB-02) | T1 | Ten recorded scores; classification stated with the rule that produced it |
| T3 | Attribute the score loss to specific metrics with numeric values; confirm the loss is not in `largest-contentful-paint` or `cumulative-layout-shift`, whose assertions passed (LPB-03) | T1 | Named metrics with values; contradiction with the passing assertions explicitly checked |

**Phase A exit gate.** Work stops here for review. T2's classification selects
the Phase B branch. No file in `apps/site/` may be modified during Phase A —
diagnosis must observe the system it is diagnosing, unchanged.

## Phase B — Restore (exactly one branch; both if both conditions hold)

### B1 — if classification is *deterministic* (median < 0.95)

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T4a | Reduce the cost of the bottleneck metric T3 named. Scope is bounded to that metric's cause — no threshold edits, no unrelated refactors (LPB-04) | T3 | Median score over 10 runs ≥ 0.95; `lighthouserc.cjs` assertions byte-identical |

### B2 — if classification is *instability* (median ≥ 0.95, minimum < 0.95)

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T4b | Make the budget evaluate against an aggregate of multiple runs instead of a single sample, keeping `categories:performance` at `minScore: 0.95` (LPB-05) | T3 | Repeated stage invocations produce a stable verdict; threshold line unchanged |

### B3 — if *not reproduced locally* (median ≥ 0.95, minimum ≥ 0.95)

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T4c | Escalate measurement to CI before choosing a remedy; gather the same distribution on the runner. Re-enter the T2 decision rule with CI data, which is authoritative | T3 | CI-side distribution recorded; classification re-derived |

### Common to every branch

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T5 | Record the Lighthouse stage's wall-clock cost and show it fits `timeout-minutes: 45` alongside the documented ~23-minute worst case (LPB-06) | T4a/T4b/T4c | Timing recorded; margin stated |

## Phase C — Prove and record

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T6 | Discrimination sensor: inject a deliberate performance regression into the built site in scratch state, confirm the assertion fails, remove it, confirm it passes, discard the mutation (LPB-07) | T5 | Both outcomes recorded; working tree clean afterward |
| T7 | Full `pnpm site:test` and `pnpm gate:quick`; write `validation.md` and the feature `handoff.md` (LPB-06) | T6 | Both gates pass; artifacts tracked |

## Phase D — Remediate the PR #139 review

Review: <https://github.com/accd/verchestra/pull/139#pullrequestreview-4829686374>
(`CHANGES_REQUESTED`, reviewer MiguelCorre). All five points were independently
verified against the code before planning; all five are valid. Point 1's
*diagnosis* is valid but its *prescription* is not — see D1.

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| D1 | Scope aggregation per assertion in `apps/site/lighthouserc.cjs`: `median` on `categories:performance` only; `pessimistic` explicitly on the other five. Add a regression test asserting the split (LPB-08) | None | New test fails against the current global-`median` config and passes after; `pnpm site:test` |
| D2 | Collect the remaining pre-remedy single-run CI samples to reach `N = 10`, recompute median and minimum over the complete sample, and re-run LPB-02's rule (LPB-09) | Decision on how to trigger pre-remedy CI (see Open Decision below) | 10 recorded CI scores; classification restated with the full sample; remedy re-affirmed or re-selected |
| D3 | Upload the full `.lighthouseci` report set as a CI artifact on `always()`, pinned action, `retention-days: 14` to match `ci.yml:71` (LPB-10) | None | Artifact downloadable from a real CI run and contains per-run JSON + HTML |
| D4 | Create `.specs/features/lighthouse-performance-budget/handoff.md` from `.specs/templates/feature/handoff.md`; restore the `external-review-triage` handoff in `.specs/STATE.md` to its `main` content; reconcile traceability and success criteria (LPB-11) | None | `git diff main -- .specs/STATE.md` shows the triage handoff intact; `pnpm gate:quick` (covers the handoff-template contract test) |
| D5 | Re-run verification against the true PR head and record an accurate, inclusive range in `validation.md` (LPB-12) | D1-D4 | `git rev-list --count` matches the stated range; range contains the head SHA |

### D1 evidence — why the requested fix is not the fix

Measured against the installed `@lhci/utils@0.15.1` with real LHR fixtures,
varying only `categories:accessibility` (`minScore: 1`) across three runs:

| accessibility runs | `N=1` baseline (pre-change) | `optimistic` (lhci default, = the requested fallback) | `median` (current PR) | `pessimistic` (proposed) |
| --- | --- | --- | --- | --- |
| `[0.9, 1, 1]` | **FAIL** | PASS | PASS | **FAIL** |
| `[0.9, 0.9, 1]` | **FAIL** | PASS | **FAIL** | **FAIL** |
| `[0.9, 0.9, 0.9]` | **FAIL** | **FAIL** | **FAIL** | **FAIL** |

For a `minScore` assertion `optimistic` resolves to `Math.max` across runs
(`assertions.js:64-67`), so it is *more* lenient than `median`. Scoping
`median` to performance and letting the rest fall back to the default would
leave row 1 still weaker than baseline — the reviewer's own example — and
would make row 2 *weaker than the current PR*. `pessimistic` (`Math.min` for
`minScore`, `Math.max` for `maxNumericValue`) is the only setting that
reproduces the `N=1` strictness those five assertions are entitled to.

Per-assertion override is supported: `assertions.js:426` spreads the
per-assertion options after the global default, so the inner value wins.

### Resolved Decision — how to collect D2's remaining samples

`ci.yml` triggers only on `push: [main]` and `pull_request: [main]`, so the
pre-remedy config cannot be exercised by pushing a branch. Options weighed:
a throwaway draft PR on the author's own fork; reverting the remedy across
several pushes on this PR head; or adding `workflow_dispatch`.

**Decided (human, 2026-07-31): throwaway draft PR on the author's own fork.**
A scratch branch at `c49f745` (the last pre-remedy commit) is opened as a
draft PR *within* `brunomjanuario/verchestra`, sampled, then closed and the
branch deleted. Rationale: keeps PR #139's history clean, never touches
`accd/verchestra`, and avoids making `workflow_dispatch` a permanent CI
contract change on a PR already under review for touching `ci.yml`. The
scratch PR is disposable evidence-gathering, not a contribution, and is
closed as soon as the samples are recorded.

## Gate Commands

| Level | Command |
| --- | --- |
| Site build | `pnpm site:build` |
| Lighthouse stage only | `pnpm --filter @verchestra/site test:lighthouse` |
| Full site qualification | `pnpm site:test` |
| Quick | `pnpm gate:quick` |

## Completion Rules

- `categories:performance` stays at `minScore: 0.95`. No assertion in
  `apps/site/lighthouserc.cjs` may be weakened, removed, or made conditional.
- No remedy is implemented before T2 returns a classification.
- Any sampling change must be shown to fit the existing job timeout, not merely
  assumed to.
- No new runtime dependency for the site; `@lhci/cli` is already present.
- Qualification evidence is **not** recorded under `docs/qualification/` — this
  is maintenance work on the gate, not a numbered product task in the T-chain.

## Task count and delegation

Phases A-C: 11 tasks, exclusive B branches, 7-8 actually executed — complete.
Phase D adds 5 tasks (D1-D5). Phase D fits a single batch, so it executes
inline without sub-agents. The Verifier runs automatically after D5, and its
prior PASS is superseded: it verified a state the review has since shown to be
incomplete, so a fresh pass over the full range is required rather than an
amendment to the existing report.

## Execution Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | Done | Local production build (`pnpm site:build`) + `pnpm --filter @verchestra/site test:lighthouse` against `http://127.0.0.1:4323/verchestra/`. Single-run result: `performance: 1`, `accessibility: 1`, `best-practices: 1`, `seo: 1`. Per-metric: LCP 322.8ms, TBT 0ms, Speed Index 322.8ms, CLS 0.0253. |
| T2 | Done | 10 local runs of `lhci autorun`, ~15-16s each. All 10 scored `performance: 1`. Median = 1, min = 1, max = 1 — zero variance. LCP ranged 322.1-322.5ms, CLS 0.0253-0.0272ms across runs. **Classification: not reproduced locally** (median ≥ 0.95 AND minimum ≥ 0.95) — local hardware is far faster than the shared 2-vCPU `ubuntu-latest` runner and cannot surface CPU-bound throttling. Per LPB-02, this requires CI-side measurement before choosing a remedy (branch B3). **SPEC_DEVIATION:** the CI-side re-classification (see T4 row) uses `N = 5` (4 fresh runs + 1 historical), not the `N = 10` LPB-02 names. Reason: logged in `spec.md`'s Assumptions table — sampling further after the remedy commit would measure the new 3-run-median config, not the single-run config being classified, and the two data points that decide the verdict (median = 1, minimum = 0.92) cannot change with more passing draws. |
| T3 | Done | No score loss to attribute locally (T1/T2 all hit the ceiling), and the historical failing run (PR #108, 0.92) has no recoverable per-metric data — confirmed by inspecting its own job log (`gh run view --job=90705185185 --log-failed`), which prints only `found: 0.92` for the composite category; no `.lighthouseci` artifact was ever uploaded for that run. **SPEC_DEVIATION:** attribution is satisfied against the T6 discrimination-sensor's failing run instead of PR #108's own run, per the LPB-03 clause added for this case (`spec.md`) and the matching assumption row. The sensor reproduces the same shape (composite drops, LCP/CLS assertions still pass) with full metrics: `first-contentful-paint` score 0.46 (1662-1663ms), `speed-index` score 0.74-0.75 (1709-1718ms) — these carry the loss. `largest-contentful-paint` (1666-1669ms, well under the 2500ms assertion threshold, score 0.74-0.75) and `cumulative-layout-shift` (0.0, score 1) both continued to pass their explicit assertions, confirming the loss is not attributed to a metric whose assertion held. `total-blocking-time` also stayed at 0 (score 1) — the injected block runs before first paint, so it delays FCP/SI rather than registering as post-FCP blocking time. This proves the classified *phenomenon* (instability, FCP/Speed-Index-driven) with real numbers; it does not and cannot reconstruct PR #108's own lost data. |
| T4a/b/c | **Done — B2 (instability)** | PR #139 opened by the user (`accd/verchestra#139`). `lhci` prints only pass/fail and no artifact survives the job, so commit `bbe341b` added an `if: always()` CI step that reads the actual score back out of `.lighthouseci/lhr-*.json`. 4 fresh CI runs of unchanged code (`30634763678`, `30635603377`, `30636678542`, `30636988475`) all scored `performance: 1` (LCP 325-340ms, TBT 0, CLS ~0.03). Combined with the historical data point — PR #108 scored `0.92` under the identical "no site code changed" condition — the CI-side sample is `{0.92, 1, 1, 1, 1}`: median = 1 (≥ 0.95), minimum = 0.92 (< 0.95). Per LPB-02 and the CI-is-authoritative edge case, this is **classification B2: instability**, not deterministic and not "unreproducible." Remedy (commit `3829387`): `apps/site/lighthouserc.cjs` — `numberOfRuns: 1 → 3`, added `assert.aggregationMethod: "median"` (the default, `"optimistic"`, would have let any single good run mask two bad ones — the wrong direction for a budget). `categories:performance` threshold left at `minScore: 0.95`, byte-identical. |
| T5 | Done | CI run `30637457300` (remedy commit `3829387`) — `Site quality` job: 3m43s, up from the pre-remedy baseline of 2m55s-3m29s (Δ ≈ +15-45s for 2 extra Lighthouse passes). `timeout-minutes: 45` (`ci.yml:8`) leaves a >41-minute margin; the documented ~23-minute worst case (browser install + apt) is unaffected since the added cost is inside the already-running preview server, not a new browser install. All 3 samples in that run scored `performance: 1`. |
| T6 | Done | Discrimination sensor run locally in scratch state (`apps/site/dist/`, gitignored, never committed): injected a synchronous 1.5s main-thread-blocking `<script>` into the built `index.html` before `</head>`. Re-ran `lhci autorun` against the mutated build — `categories:performance` failed: `expected: >=0.95, found: 0.86, all values: 0.86, 0.86, 0.86` (median across all 3 runs, correctly *not* masked by aggregation), assert command exited 1. Rebuilt cleanly (`pnpm site:build`) to discard the mutation, re-ran — `all values: 1, 1, 1`, passed. `git status --short` confirmed a clean tree throughout (only `dist/` was touched, and it's gitignored). |
| T7 | Done | `pnpm gate:quick`: 97/97 pass. `pnpm gate:release` (selected by `scripts/select-gates.mjs` because this diff touches `.github/workflows/ci.yml`, which the repo's own gate-selection intentionally maps to the release profile so CI cannot relax itself unchecked) fails locally only in `spikes/sqlite` (`no such module: fts5`) — confirmed as a pre-existing local-environment gap unrelated to this diff: this branch never touches `spikes/sqlite`, and the failure reproduces identically with `node:sqlite`'s `DatabaseSync` on this machine's Node v23.11.0, which lacks the FTS5 extension entirely. CI's own `Quality gate` job runs the identical `select-gates.mjs` output on the qualified Node v24.14.0 runtime and passed on every run of this branch's commits (`30634763678` through `30637457300`), so the release-level verification this diff requires is independently confirmed on the qualified runtime; the local run only demonstrates a runtime gap this repository does not target. |
