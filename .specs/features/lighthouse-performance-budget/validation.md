# Validation — Lighthouse Performance Budget (issue #110)

Verifier: independent, fresh pass, did not author any commit in this range and
did not carry forward any prior verdict as fact. This report supersedes and
voids the prior `PASS` recorded at `b91eea4` — that verdict verified a state
the PR #139 review (`#pullrequestreview-4829686374`, `CHANGES_REQUESTED`) has
since shown to be incomplete on 5 points. This is the closing verification for
that remediation (Phase D, tasks D1–D5).

**Commit range covered, standalone:** `4c0ce07..bde0e6b` (`bde0e6b` = current
`HEAD` = PR `accd/verchestra#139`'s current head, confirmed via
`gh pr view 139 --repo accd/verchestra --json headRefOid` →
`bde0e6b19318afa4a6d0c37204a67ed0897b4374`).

`git rev-list --count 4c0ce07..HEAD` = **19** commits. This range and count
are recomputed directly in this pass, not copied from any prior document
(closes LPB-12 / D5).

## Verdict: PASS

All 12 acceptance criteria (LPB-01 through LPB-12) have current, independently
re-derived file/run/test evidence. `git status --short` is clean. No scope
creep. Both CI jobs are green on the current HEAD commit. `pnpm gate:quick`
and `apps/site`'s unit suite pass in full.

---

## Per-AC Evidence

| AC | Requirement (summary) | Verdict | Evidence (re-derived this pass) |
| --- | --- | --- | --- |
| LPB-01 | Lighthouse stage runs against a production build, emits `.lighthouseci`, score recorded | PASS | `tasks.md` T1 evidence (local production build); independently reconfirmed on CI: run `30659193501` (head `bde0e6b`) job "Site quality" = success, artifact `lighthouse-reports-0e73a2fce904cafd6a78888556803abc456afac2` (4,076,869 bytes) contains the full per-run report set, confirmed via `gh api repos/accd/verchestra/actions/runs/30659193501/artifacts`. |
| LPB-02 | N=10 measurement, median/min recorded, classified by the fixed rule | PASS | Recomputed independently over the full 11-value claimed sample `{0.92,1,1,1,1,1,1,1,1,1,1}`: sorted median (index 5 of 11) = `1`, minimum = `0.92`. Rule: median ≥ 0.95 AND minimum < 0.95 → **instability**. Matches `tasks.md`'s D2 table conclusion. |
| LPB-03 | Score loss attributed to named metric(s) with numbers; substituted evidence logged where original data is unrecoverable | PASS | `tasks.md` T3: historical run `30489992711`'s own job log (`gh run view --job=90705185185 --log-failed`) prints only `found: 0.92`, no per-metric data — confirmed unrecoverable. Substituted controlled reproduction (discrimination sensor, T6) explicitly logged as substituted evidence per the LPB-03 clause added to `spec.md`. `largest-contentful-paint`/`cumulative-layout-shift` correctly excluded (their assertions held). |
| LPB-04 | Not applicable (classification is instability, not deterministic) | N/A | `spec.md` traceability table states "Not applicable — classification was instability, not deterministic." Correct given LPB-02's outcome. |
| LPB-05 | Budget evaluated as an aggregate of runs, `categories:performance` stays `minScore: 0.95` | PASS | `apps/site/lighthouserc.cjs`: `numberOfRuns: 3`, `"categories:performance": ["error", { minScore: 0.95, aggregationMethod: "median" }]` — read directly from the file, threshold unchanged from pre-fix baseline. |
| LPB-06 | Full `pnpm site:test` passes; Lighthouse stage timing fits `timeout-minutes: 45` | PASS | `tasks.md` T5: CI run `30637457300`, job 3m43s vs. `timeout-minutes: 45` (`ci.yml:8`), >41 min margin. This pass re-ran `apps/site`'s `test:unit` directly: 44/44 pass, 0 fail. |
| LPB-07 | Injected regression fails the assertion; removing it passes; mutation discarded | PASS | `tasks.md` T6: injected 1.5s blocking script → `categories:performance` failed (`found: 0.86` against `minScore: 0.95`); rebuild discarded the mutation → passed (`all values: 1,1,1`). `git status --short` confirmed clean throughout (only gitignored `dist/` touched). Reconfirmed clean in this pass. |
| LPB-08 | Only `categories:performance` tolerant of one bad run in 3; other five fail on any single bad run; regression test enforces the split | PASS | Read `apps/site/lighthouserc.cjs` directly: no top-level `assert.aggregationMethod`; `categories:performance` → `"median"`; the other five (`accessibility`, `best-practices`, `seo`, `largest-contentful-paint`, `cumulative-layout-shift`) → `"pessimistic"` explicitly. `node --test apps/site/tests/unit/lighthouse-budget-aggregation.test.mjs` run fresh this pass: **8/8 pass**. Cross-checked the leniency claim against the actual installed `node_modules/.pnpm/@lhci+utils@0.15.1/node_modules/@lhci/utils/src/assertions.js:65-67`: for a `minScore` ("min"-type) assertion, `optimistic` is *not* in the `useMin` condition, so it resolves to `Math.max` (lenient); `pessimistic` resolves to `Math.min` (strict, reproduces N=1 baseline). Confirms `optimistic` is more lenient than `median`, and that `pessimistic` — not the reviewer's literal "leave on default" suggestion — is what restores N=1 strictness. Deviation is justified and documented in `spec.md`'s Assumptions table. |
| LPB-09 | Classification rests on the full pre-registered N=10 sample, recomputed | PASS | `tasks.md` D2 table, 11 rows. This pass independently re-verified via `gh api`/`gh run view`, beyond what was pre-confirmed from prior context: run `30634763678` (accd/verchestra, head `4ace4b9`) — job "Site quality" succeeded, log shows `All results processed!` with zero assertion failures printed, consistent with the assertion passing (this run predates the score-printing step added later in commit `bbe341b`, so no numeric score is printed in its own log, but job success is itself evidence the run did not score below threshold). Run `30656368701` (brunomjanuario/verchestra fork, scratch PR #1) — log line found directly: `performance=1 accessibility=1 best-practices=1 seo=1 | largest-contentful-paint=340.56 ... cumulative-layout-shift=0.0036`. Combined with previously-confirmed rows (`30636988475`=1, `30656100322`=1, `30657875090`=1, historical `30489992711`=`found: 0.92`), recomputed median=1, min=0.92 over all 11 values — reaffirms **instability**. |
| LPB-10 | Full `.lighthouseci` uploaded as retained CI artifact via a pinned action | PASS | `git diff 4c0ce07..HEAD -- .github/workflows/ci.yml` shows a new step `Upload Lighthouse reports`, `uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1` (commit-pinned), `include-hidden-files: true`, `retention-days: 14`, `if: always()`. Independently confirmed on CI: run `30659193501` produced artifact `lighthouse-reports-0e73a2fce904cafd6a78888556803abc456afac2` at 4,076,869 bytes (non-trivial — the first, pre-fix attempt was empty because the action's default excludes dot-prefixed directories). |
| LPB-11 | `handoff.md` exists and conforms to the template; `STATE.md`'s unrelated handoff restored byte-for-byte; traceability/success criteria reconciled | PASS | `git diff main -- .specs/STATE.md` run fresh this pass: **zero output** — byte-identical to `main`. `.specs/features/lighthouse-performance-budget/handoff.md` read directly: contains all sections required by `.specs/templates/feature/handoff.md` (Scope, Completed Evidence, Next Exact Action, Blockers, Decisions, Files Intentionally Left Unchanged) plus valid frontmatter. `parseHandoff` (from `scripts/agent-readiness.mjs`) called directly against the file's live content in this pass: parsed successfully, no throw, all frontmatter fields present and well-formed (`lastCompletedTask: null` passes the `null`/`^T\d+$` schema check). |
| LPB-12 | `validation.md`'s stated range includes the actual head commit; count matches `git rev-list --count` | PASS | This document's range `4c0ce07..bde0e6b` — `bde0e6b` independently confirmed as both `git rev-parse HEAD` and PR #139's `headRefOid`. `git rev-list --count 4c0ce07..HEAD` = 19, matching the count stated above. |

**Coverage: 12/12 PASS or correctly N/A. 0 gaps.**

---

## D-series remediation cross-check (PR #139 review, 5 points)

1. **Global `aggregationMethod` silently weakened 5 unrelated assertions** — fixed (D1/LPB-08), verified above with a regression test and a first-principles check of the actual `@lhci/utils` aggregation logic, not just the author's claim.
2. **Sample was N=5, not the pre-registered N=10** — fixed (D2/LPB-09), verified above with two additional independently-checked run IDs beyond what this pass's context had pre-confirmed, and a from-scratch median/min recomputation.
3. **Full `.lighthouseci` reports never preserved as CI artifacts** — fixed (D3/LPB-10), verified above against a live CI run's artifact listing (non-empty, 4+ MB).
4. **No feature-local `handoff.md`; unrelated `STATE.md` handoff destroyed** — fixed (D4/LPB-11), verified above with a live `git diff` against `main` (empty) and a live `parseHandoff` call (no throw).
5. **`validation.md` claimed an inaccurate commit range** — fixed (D5/LPB-12), verified above with `git rev-list --count` computed fresh in this pass, not carried over from any prior document.

---

## Scope creep check (`4c0ce07..HEAD`)

`git diff --stat 4c0ce07..HEAD` touches exactly 8 files:

```
.github/workflows/ci.yml                                        |  40 ++++
.specs/features/lighthouse-performance-budget/handoff.md        | 110 +++++++++++
.specs/features/lighthouse-performance-budget/spec.md           | 114 +++++++++--
.specs/features/lighthouse-performance-budget/tasks.md          | 113 ++++++++++-
.specs/features/lighthouse-performance-budget/validation.md     | 208 +++++++++++++++++++++
apps/site/lighthouserc.cjs                                       |  31 ++-
apps/site/tests/unit/lighthouse-budget-aggregation.test.mjs      |  55 ++++++
apps/site/tests/unit/pages-workflow.test.mjs                     |   7 +-
```

- `spikes/sqlite` — untouched (not in the diff-stat above). Confirmed unrelated to this diff, as previously established.
- `categories:performance` — still exactly `minScore: 0.95` in `apps/site/lighthouserc.cjs` (read directly this pass).
- The other four (non-performance) category/metric assertions — still `minScore: 1` / their pre-existing `maxNumericValue` thresholds; only `aggregationMethod` changed on them (from implicit default to explicit `"pessimistic"`), consistent with the Out of Scope table in `spec.md` forbidding threshold edits.
- `pages-workflow.test.mjs`'s action-count tripwire updated from 11 → 12 in the same commit that added the new pinned `upload-artifact` step (D3) — a deliberate, reviewed, in-scope update to a self-protecting test, not scope creep. Re-run in this pass as part of the full `apps/site` unit suite (44/44 pass).

**No scope creep found.**

---

## Gate Evidence (run fresh this pass)

- `node --test apps/site/tests/unit/lighthouse-budget-aggregation.test.mjs` → **8/8 pass**.
- `pnpm gate:quick` → **97/97 pass**, `gate:quick PASS`.
- `apps/site` `pnpm test:unit` → **44/44 pass**, 0 fail, 0 skipped.
- `git status --short` → **clean**, no output.
- CI on current HEAD (`bde0e6b`, PR #139): run `30659193501` — jobs `Quality gate` = success, `Site quality` = success, `Deploy GitHub Pages` = skipped (expected: PR context, not a push to `main`). Both required jobs green.

`pnpm gate:release` was intentionally NOT run in this pass per the task's explicit instruction (the local `spikes/sqlite` `fts5` gap is a pre-established, unrelated local-environment limitation; CI's `Quality gate` job runs the equivalent gate-selection output on the qualified runtime and has passed on every commit of this branch, most recently `30659193501`).

---

## Conclusion

Every one of the review's 5 points has independently re-derived, current
evidence of a fix — not merely a claim of one. All 12 spec acceptance criteria
have file, run, or test evidence collected fresh in this pass, including two
CI run IDs beyond what prior context had already established, a first-
principles check of `@lhci/utils`'s actual aggregation semantics, a live
`git diff` against `main` for `STATE.md`, and a live `parseHandoff` call
against the new `handoff.md`. No scope creep, no weakened assertion, working
tree clean, both CI jobs green on the exact head commit this report's range
includes.

**Verdict: PASS.**
