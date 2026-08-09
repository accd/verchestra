---
schema: verchestra-feature-handoff/v1
feature: lighthouse-performance-budget
issue: 110
status: complete
branch: fix/lighthouse-performance-budget-closure
baseRevision: c0b53a498087c466f9a6c89ff345b389b5946de9
lastCompletedTask: null
nextTask: None. Issue #110 closed with current-main evidence.
lastGate: pnpm site:check
updatedAt: 2026-08-09T21:35:00Z
---

# Scope

Issue #110: `Site quality`'s Lighthouse stage scored 0.92 against a required
0.95 on PR #108, which changed no site code. Diagnose deterministic
regression vs. measurement instability by a pre-registered rule before
choosing a remedy, then fix it. Full requirements: `spec.md` (LPB-01
through LPB-12).

Phase D (5 review points from `#pullrequestreview-4829686374`) is complete.
PR **accd/verchestra#139** (the remedy) **merged into `main` at `751c458`
on 2026-07-31T22:40:29Z**. Full task breakdown: `tasks.md`.

This handoff's closing update (2026-08-09) replaces the "awaiting merge"
state below, which had gone stale after the merge actually happened.

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
  no difference).
- **D4 complete** (LPB-11): this handoff file created; `spec.md`'s
  Requirement Traceability (all 12 rows) and Success Criteria (all 8
  checkboxes) reconciled with actual state. CI caught two real defects this
  handoff's own changes introduced, both fixed same-session: (a) D3's new
  pinned action tripped `apps/site/tests/unit/pages-workflow.test.mjs`'s
  deliberate action-count tripwire (11 → 12, now documented in that test's
  comment); (b) `actions/upload-artifact`'s default `include-hidden-files:
  false` silently excluded `.lighthouseci` itself (a dot-prefixed directory)
  from the artifact — fixed by setting `include-hidden-files: true`.
- **D5 complete** (LPB-12): a fresh, independent Verifier ran a full
  standalone pass over `4c0ce07..bde0e6b` (19 commits, confirmed to include
  the actual PR head via `gh pr view 139 --json headRefOid`) and returned
  **PASS** on all 12 acceptance criteria, with re-derived evidence for each
  — not carried forward from any prior claim. Two prior attempts at this
  same verification crashed on infrastructure errors (API connection drop,
  agent stall) before finding anything; the third completed cleanly. Full
  report: `validation.md`. This supersedes and voids the original `PASS` at
  `b91eea4`, which the PR #139 review had since shown incomplete.

- **Closure (2026-08-09):** PR #139 confirmed **MERGED** into `accd/verchestra`
  `main` at `751c458` (2026-07-31T22:40:29Z; `gh pr view 139 --json state,
  mergedAt,mergeCommit` on 2026-08-09). Closure evidence gathered at the
  current main tip `c0b53a4` (2026-08-09T20:45:32Z, includes the 2026-08-09
  brand-mark work `d2b34ab`, which is an ancestor):
  - CI run `31332489417` (https://github.com/accd/verchestra/actions/runs/31332489417),
    `Site quality` job **success**, bound to `c0b53a4`. Three Lighthouse runs,
    all `performance=1` (median 1.0, well above the 0.95 floor); accessibility,
    best-practices, and seo all `1`.
  - Local `pnpm site:check` (build + `check-built-site.mjs`) at the same
    revision: 128 pages built, internal links and metadata both `valid`.
  - The 0.95 `categories:performance` threshold in
    `apps/site/lighthouserc.cjs` is unchanged from D1 — never lowered.
  - `.specs/features/lighthouse-performance-budget/handoff.md` had stayed at
    `status: verification` / `nextTask: … merge of PR #139` since
    2026-07-31T20:20, nine days after the merge actually landed — this update
    corrects that drift.

# Next Exact Action

None. Issue #110 is closed. See `docs(lighthouse-performance-budget): record
closure evidence (#110)` for the closing commit and the GitHub issue comment
citing the run above.

# Blockers

None. All Phase D work is complete, independently verified (`validation.md`),
merged, and now closed with current-main evidence.

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
