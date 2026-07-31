# Validation — Lighthouse Performance Budget (issue #110)

Verifier: independent, did not author this change or either prior fix. This is
**iteration 3 of 3 — the final allowed iteration** in the bounded fix→re-verify
loop. Commit range covered, standalone: `4c0ce07..b91eea4` (11 commits).
Re-derived from files, `git diff`, and (where iteration 2 already did the live
`gh` legwork) that prior evidence is re-checked for consistency rather than
re-fetched wholesale, since the underlying facts (a historical CI run's log
content) cannot change between iterations.

## Verdict: PASS

Both gaps iteration 2 left open are closed. All 7 ACs (LPB-01–LPB-07) have
current file/run evidence matching spec.md's present wording. No scope creep.
Working tree clean. `lighthouserc.cjs` matches the verified remedy exactly.

---

## What changed in `b91eea4` (the delta since iteration 2's FAIL)

`git diff 1298fcc..b91eea4` touches exactly two files: `spec.md` and
`tasks.md`. No file under `apps/site/` or `.github/workflows/` touched —
consistent with a wording-reconciliation commit, not a re-litigation of the
mechanism already verified sound in iterations 1 and 2.

### Gap A (LPB-03 normative text never amended) — closed

Iteration 2 found the author had substituted the T6 discrimination-sensor's
data for PR #108's unrecoverable per-metric data, logged only as an assumption
row, while LPB-03's actual AC text still read as an absolute ("SHALL NOT
attribute the loss to a metric whose assertion passed" with no substitution
clause) and the Independent Test only described re-deriving numbers from "the
artifact" (singular, implicitly the classified case's own artifact).

`spec.md` LPB-03 now reads, in full (lines 82–89):

> **LPB-03** — WHEN the classification is recorded THEN it SHALL name the
> specific metric or metrics carrying the score loss, with their numeric
> values, and SHALL NOT attribute the loss to a metric whose assertion
> passed. WHEN the failing case being classified has no recoverable
> per-metric data (e.g., a historical CI run that predates this feature's
> own instrumentation), this MAY instead be satisfied by a controlled
> reproduction exhibiting the same score-loss shape, explicitly logged as
> substituted evidence rather than presented as the original run's data.

And the Independent Test (lines 91–94):

> The recorded evidence answers "deterministic or unstable, and in which
> metric" with numbers a reviewer can re-derive from the artifact — from the
> classified case itself where its data survives, or from a logged substitute
> reproduction where it does not.

**Judgment: this closes the gap without opening a loophole.** Three textual
constraints keep the escape hatch narrow rather than general-purpose:

1. **Trigger condition is specific, not "any missing evidence"** — it fires
   only when "the failing case being classified has no recoverable per-metric
   data," with the example narrowing it further to a historical run that
   *predates this feature's own instrumentation*. It does not say "when data
   is inconvenient" or "when data is hard to obtain." A future author citing
   this clause for a live, current-CI run that simply forgot to upload an
   artifact would be misapplying it — the "predates instrumentation"
   qualifier ties the exception to a structural, verifiable fact (the
   instrumentation didn't exist yet), not a judgment call.
2. **Same-shape constraint** — the reproduction must exhibit "the same
   score-loss shape" as the case being classified, not just any regression.
   This forces the substitute to actually corroborate the specific failure
   mode (composite drop with LCP/CLS assertions still passing), not merely
   supply plausible-looking numbers for an unrelated symptom.
3. **Disclosure requirement, not silent substitution** — "explicitly logged
   as substituted evidence rather than presented as the original run's data"
   means a reviewer reading the record can never mistake reproduction data
   for the classified case's own data. This preserves the evidence-or-zero
   standard's spirit: it does not let fabricated-looking numbers pass as
   real ones, it requires the fabrication (reproduction) to be labeled as
   such.

This is not "let a future author substitute ANY convenient data for ANY
missing evidence" — the clause is scoped to the unrecoverable-historical-data
case specifically, requires shape-fidelity, and requires disclosure. I could
not construct a plausible future misuse that this wording would license but
the pre-amendment wording would have blocked; the amendment targets exactly
the situation iteration 2 identified and no broader.

One residual, non-blocking wording note: "e.g." introduces the historical-run
case as an example rather than the sole trigger, leaving room for an
as-yet-unspecified second scenario to also qualify as "no recoverable
per-metric data." This is ordinary spec language (illustrative example, not
exhaustive enumeration) and is not a defect — but a future author invoking
this clause for a *different* scenario than the one illustrated should expect
extra Verifier scrutiny on whether that scenario truly has no recoverable
data. Flagging for awareness, not blocking.

### Gap B (tasks.md T3 undertagged vs. T2) — closed

Side-by-side, `tasks.md`'s Execution Evidence table:

- **T2** (the LPB-02 N=5-vs-N=10 deviation, tagged in iteration 1's fix):
  `"**SPEC_DEVIATION:** the CI-side re-classification (see T4 row) uses `N = 5`
  ... not the `N = 10` LPB-02 names. Reason: logged in `spec.md`'s Assumptions
  table..."`
- **T3** (this iteration's fix, previously plain "Done" with no tag):
  `"**SPEC_DEVIATION:** attribution is satisfied against the T6
  discrimination-sensor's failing run instead of PR #108's own run, per the
  LPB-03 clause added for this case (`spec.md`) and the matching assumption
  row..."`

Both rows now: (a) carry the bold `SPEC_DEVIATION` tag in the same position
(prefixing the explanatory sentence), (b) name the specific deviation, (c)
point to the `spec.md` location that authorizes it, (d) explain why the
deviation was necessary rather than avoidable. Structurally comparable —
gap closed.

---

## Full pass over all 7 Acceptance Criteria (standalone, current repo state)

| AC | Requirement (current spec.md wording) | Evidence | Verdict |
| --- | --- | --- | --- |
| **LPB-01** | Lighthouse stage run against production build of `main` completes, emits `.lighthouseci` artifact with per-category + per-metric numbers, score recorded in feature evidence. | `tasks.md` T1 row: local `pnpm site:build` + `pnpm --filter @verchestra/site test:lighthouse` against `http://127.0.0.1:4323/verchestra/`; `performance: 1, accessibility: 1, best-practices: 1, seo: 1`; per-metric LCP 322.8ms, TBT 0ms, Speed Index 322.8ms, CLS 0.0253. `lighthouserc.cjs:35-38` confirms `upload.target: "filesystem"`, `outputDir: ".lighthouseci"` — the artifact-emitting config is live, not just claimed. | **Met** |
| **LPB-02** | Same unchanged build measured `N=10`; median + minimum recorded; classified by the fixed 3-way rule. | `tasks.md` T2 row: 10 local runs, all scored `performance: 1`, median = min = max = 1 → **not reproduced locally**, correctly escalated per the rule's third branch. CI-side re-classification (T4a/b/c row) used `N=5` `{0.92,1,1,1,1}` → median=1, min=0.92 → **instability**, per the edge case in spec.md ("WHEN the local median and CI median disagree... CI SHALL be treated as authoritative"). The `N=5` vs `N=10` deviation is logged (assumption row, `spec.md` lines ~51-52) and tagged `SPEC_DEVIATION` in `tasks.md` T2 — this is a disclosed, reasoned deviation, not a silent gap, and iteration 2 already independently validated the reasoning holds (additional passing draws cannot move median off 1 or minimum off 0.92). | **Met** (with disclosed, justified N deviation) |
| **LPB-03** | Classification names specific metric(s) with numeric values; never attributes loss to a passing-assertion metric; MAY substitute a controlled reproduction, explicitly logged, when the classified case's own data is unrecoverable. | `tasks.md` T3 row, tagged `SPEC_DEVIATION`: PR #108's own data confirmed unrecoverable (`gh run view --job=90705185185 --log-failed` — only prints `found: 0.92`, no per-metric breakdown, no artifact uploaded). Substitute: T6 sensor's failing run — `first-contentful-paint` 0.46 (1662-1663ms), `speed-index` 0.74-0.75 (1709-1718ms) carry the loss; `largest-contentful-paint` (0.74-0.75, well under 2500ms threshold) and `cumulative-layout-shift` (0.0, score 1) continued to pass their assertions — the "not attributed to a passing-assertion metric" clause explicitly checked and satisfied. Substitution explicitly disclosed as substitution ("This proves the classified *phenomenon*... it does not and cannot reconstruct PR #108's own lost data"). Matches the amended AC and Independent Test verbatim in structure. | **Met** |
| **LPB-04** | (Conditional — deterministic branch) Reduce bottleneck metric's cost until median ≥0.95, no threshold edits. | Not applicable — classification was **instability** (B2), not deterministic. `tasks.md` Phase B section correctly shows only the B2 branch (T4b) executed; B1/B3 rows are the conditional-branch table entries, not claimed as done. | **N/A, correctly not invoked** |
| **LPB-05** | (Conditional — instability branch) Measurement made statistically sound via multi-run aggregate; `categories:performance` stays `minScore: 0.95`. | `apps/site/lighthouserc.cjs:14` `numberOfRuns: 3` (was 1); `:25` `aggregationMethod: "median"` (was implicit `"optimistic"` default); `:27` `"categories:performance": ["error", { minScore: 0.95 }]` — threshold byte-identical to pre-remedy. Commit `3829387`. | **Met** |
| **LPB-06** | Restored config: full `pnpm site:test` passes; Lighthouse stage wall-clock cost recorded, fits `timeout-minutes: 45` alongside documented ~23-min worst case. | `tasks.md` T5 row: CI run `30637457300`, `Site quality` job 3m43s (up from 2m55s-3m29s baseline, Δ≈+15-45s for 2 extra passes). `.github/workflows/ci.yml:8` `timeout-minutes: 45` leaves >41min margin. T7 row: `pnpm gate:quick` 97/97 pass; `pnpm gate:release` local `spikes/sqlite` fts5 failure independently reconfirmed as pre-existing/environment-only (not this diff's concern, not re-litigated per task instructions) and CI's `Quality gate` job passed on the qualified runtime for every commit on this branch. | **Met** |
| **LPB-07** | Deliberate regression injected into built site (scratch state) fails the assertion; removal passes; both outcomes recorded; mutation discarded. | `tasks.md` T6 row: 1.5s blocking script injected into gitignored `apps/site/dist/index.html` (never committed); `categories:performance` failed, `found: 0.86, all values: 0.86, 0.86, 0.86` (median correctly not masked); clean rebuild restored `all values: 1, 1, 1`, passed; `git status --short` confirmed clean tree throughout (only gitignored `dist/` touched). | **Met** |

**Coverage: 7/7 ACs addressed — 6 directly met, 1 (LPB-04) correctly not
invoked because its precondition (deterministic classification) did not
hold.** No AC is unaddressed or contradicted by current file state.

---

## Working tree and scope

- `git status --short`: **clean.** No uncommitted changes.
- `git diff --stat main...fix/lighthouse-performance-budget` (full branch
  diff vs. `main`): exactly 6 files —
  `.github/workflows/ci.yml` (+20, score-reporting step only),
  `.specs/STATE.md` (+/-, handoff bookkeeping),
  `.specs/features/lighthouse-performance-budget/spec.md` (+184),
  `.specs/features/lighthouse-performance-budget/tasks.md` (+106),
  `.specs/features/lighthouse-performance-budget/validation.md` (+220, this
  file's predecessor versions),
  `apps/site/lighthouserc.cjs` (+12/-... net small diff).
  No file outside this feature's direct concern is touched.
- `spikes/` (including `spikes/sqlite`): **untouched** across the full range
  (`git diff --stat 4c0ce07..b91eea4 -- spikes/` is empty) — the local
  `gate:release` fts5 failure noted in T7 is confirmed environmental, not a
  regression this branch introduced.
- Accessibility/best-practices/SEO assertions: `lighthouserc.cjs:28-30`, all
  three still `["error", { minScore: 1 }]`, byte-identical to pre-feature.
- `categories:performance`: `lighthouserc.cjs:27`, still exactly
  `["error", { minScore: 0.95 }]` — never lowered, consistent with the issue's
  explicit prohibition and the Out of Scope table.

## `apps/site/lighthouserc.cjs` — direct re-read, final check

Full file re-read line-by-line at HEAD of `fix/lighthouse-performance-budget`:
`numberOfRuns: 3` (:14), `aggregationMethod: "median"` (:25),
`categories:performance` `minScore: 0.95` (:27), `accessibility`/
`best-practices`/`seo` all `minScore: 1` (:28-30), `largest-contentful-paint`
`maxNumericValue: 2500` (:31) and `cumulative-layout-shift`
`maxNumericValue: 0.1` (:32) unchanged, `upload.target: "filesystem"`,
`outputDir: ".lighthouseci"` (:36-37) unchanged. Nothing drifted across the
three fix commits (`3829387`, `1298fcc`, `b91eea4`) — the only commit that
ever touched this file was `3829387`, and neither of the two subsequent
docs-only fix commits touched it again.

---

## Iteration history (for record)

- **Iteration 1**: FAIL — LPB-03 unattributed (no per-metric data for the
  historical failure), undocumented N=5-vs-N=10 deviation, stale STATE.md.
- **Iteration 2**: FAIL, downgraded — historical data confirmed genuinely
  unrecoverable (independently verified via live `gh` queries) and the
  substitute evidence confirmed physically coherent, but the substitution was
  only logged as an assumption, never promoted into LPB-03's own AC text or
  Independent Test, and tasks.md's T3 lacked the `SPEC_DEVIATION` tag its T2
  sibling carried.
- **Iteration 3 (this pass)**: **PASS** — `b91eea4` amended LPB-03's AC text
  and Independent Test to explicitly permit and bound the substitution, and
  tagged T3 with `SPEC_DEVIATION` matching T2's pattern. Full fresh 7-AC pass
  confirms no other gaps. One non-blocking wording observation (the "e.g."
  in LPB-03 leaves room for future scenarios beyond the illustrated one) is
  noted above for awareness — it does not need action to ship this feature.

## Blocking vs. non-blocking (final iteration disposition)

- **Blocking issues found: none.** All 7 ACs have current, re-derivable
  evidence; both prior gaps are closed with matching, comparable fixes; no
  scope creep; tree is clean.
- **Non-blocking notes for future awareness** (loop is exhausted at 3
  iterations; these do not gate this PASS):
  1. LPB-03's "e.g." example is illustrative, not an exhaustive enumeration of
     when substitution is permitted — a future invocation of this clause for
     a scenario other than "historical run predating instrumentation" should
     get extra scrutiny on whether the "no recoverable data" premise truly
     holds.
  2. The local `pnpm gate:release` `spikes/sqlite` fts5 gap (Node v23.11.0
     missing FTS5) is a pre-existing local-environment limitation, unrelated
     to this diff, and independently confirmed passing on the qualified CI
     runtime (Node v24.14.0) — not re-litigated per this task's scope, per
     the standing instruction not to re-run `gate:release` in this pass.

**Recommendation**: Ready for human review and merge of PR #139. This Verifier
does not merge — that boundary is human-only per `AGENTS.md`.
