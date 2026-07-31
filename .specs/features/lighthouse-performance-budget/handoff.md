---
schema: verchestra-feature-handoff/v1
feature: lighthouse-performance-budget
issue: 110
status: in_progress
branch: fix/lighthouse-performance-budget
baseRevision: 07ead185bf7bbf95fcba2fdeb95635b4c470e13a
lastCompletedTask: D3
nextTask: D4
lastGate: pnpm site:test
updatedAt: 2026-07-31T19:20:00Z
---

# Scope

Issue #110: `Site quality`'s Lighthouse stage scored 0.92 against a required
0.95 on PR #108, which changed no site code. Diagnose deterministic
regression vs. measurement instability by a pre-registered rule before
choosing a remedy, then fix it. Full requirements: `spec.md` (LPB-01
through LPB-12). PR **accd/verchestra#139** is open against `accd:main`,
under review (`#pullrequestreview-4829686374`, `CHANGES_REQUESTED`).

Phase D (this handoff's active phase) remediates that review's 5 points.
Full task breakdown: `tasks.md`.

# Completed Evidence

- **T1-T7** (original diagnosis + remedy + sensor): classified as
  **instability** (median ≥ 0.95, minimum < 0.95). Remedy: sampling 3 runs
  with median aggregation instead of 1. Discrimination sensor confirmed both
  directions. First Verifier PASS obtained (later superseded — see below).
- **D1** (LPB-08, commit `a2990e0`): scoped `aggregationMethod` per
  assertion in `apps/site/lighthouserc.cjs` — `"median"` on
  `categories:performance` only, `"pessimistic"` explicitly on the other
  five. New regression test
  (`apps/site/tests/unit/lighthouse-budget-aggregation.test.mjs`, 8 cases)
  confirmed to fail against the prior global-`median` config before being
  confirmed to pass against the fix. Deviates from the review's literal
  suggestion (scope to `median`, leave the rest on lhci's default) with
  measured evidence: `optimistic` resolves to `Math.max` for a `minScore`
  assertion, which is *more* lenient than `median` and would not have fixed
  the reviewer's own accessibility example. Logged in `spec.md`'s
  Assumptions table.
- **D2** (LPB-09, commit `b565470`): completed the pre-registered sample to
  `N = 11` (exceeds `N = 10`) via a throwaway draft PR at the last
  pre-remedy commit (`c49f745`) on the author's own fork
  (`brunomjanuario/verchestra#1`, closed and branch deleted after sampling;
  `accd/verchestra` was never touched). Complete sample:
  `{0.92, 1,1,1,1,1,1,1,1,1,1}` — median = 1, minimum = 0.92. Instability
  classification reaffirmed on the full sample.
- **D3** (LPB-10, commit `38024c8`): added an `always()` CI step uploading
  `apps/site/.lighthouseci` wholesale as a retained artifact
  (`lighthouse-reports-${{ github.sha }}`, 14-day retention, same pinned
  `upload-artifact` version already used for gate-selection evidence).
- **STATE.md restored**: the `external-review-triage` Handoff section this
  branch had overwritten is now byte-identical to `main`'s (`diff` confirms
  no difference) — see this task's own commit.

# Next Exact Action

Finish **D4** (LPB-11): this handoff file is D4's primary deliverable and is
now in place. Remaining for D4: reconcile `spec.md`'s Requirement
Traceability statuses and Success Criteria checkboxes with the actual
current state (some were already updated during D1/D2; confirm all 12
requirement rows and all 8 success-criteria checkboxes are accurate before
committing). Then **D5** (LPB-12): dispatch a fresh Verifier over the
complete range `4c0ce07..<D4 commit>` — the first Verifier's PASS is void,
since it verified a state the PR #139 review has since shown incomplete.
Record an accurate, inclusive commit range in the resulting `validation.md`
(the prior range `4c0ce07..b91eea4` undercounted commits and excluded the
actual head — do not repeat that mistake; use `git rev-list --count` to
confirm before writing the range).

# Blockers

None. All Phase D decisions needed are resolved (D2's sampling method was
decided by the human on 2026-07-31; see `tasks.md`'s Resolved Decision).

# Decisions

- D2's sampling method: throwaway draft PR on the author's own fork, not a
  `workflow_dispatch` addition or churning PR #139's own head. Human
  decision, 2026-07-31 (`tasks.md`).
- D1's aggregation choice deviates from the review's literal suggestion
  (`pessimistic` instead of leaving 5 assertions on lhci's default
  `optimistic`), with measured justification logged in `spec.md`'s
  Assumptions table rather than silently complying with a prescription that
  would not have achieved the review's own stated goal.
- `pnpm gate:release` fails locally only in `spikes/sqlite` (missing `fts5`
  in this machine's Node v23.11.0) — confirmed unrelated to this diff
  (`spikes/sqlite` never appears in `git diff --stat`); CI's `Quality gate`
  job runs the identical gate-selection output on the qualified Node
  v24.14.0 and has passed on every run of this branch. Treated as
  independently satisfied via CI, not re-litigated locally.

# Files Intentionally Left Unchanged

- `docs/qualification/` — this is maintenance work on the CI gate itself,
  not a numbered product task in the T-chain; no qualification report is
  recorded for it (see `tasks.md` Completion Rules).
- The other five `lighthouserc.cjs` assertions' numeric thresholds
  (`minScore: 1`, `maxNumericValue: 2500`/`0.1`) — only their
  `aggregationMethod` changed in D1; the spec's Out of Scope table forbids
  touching their thresholds.
