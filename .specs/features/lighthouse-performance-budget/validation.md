# Validation — Lighthouse Performance Budget (issue #110)

Verifier: independent, did not author this change or the prior fix. This is
iteration 2 of a fix→re-verify loop. Commit range covered: `4c0ce07..1298fcc`
(10 commits total; this pass focuses on the delta `4e3d722..1298fcc`, the
author's response to the first Verifier's FAIL). Re-derived from files and
live `gh` queries, not from tasks.md's adjectives or the author's claims.

## Verdict: FAIL (two of three gaps closed; the highest-severity gap is only
## partially closed — the substitution is honestly logged as a deviation but
## the normative AC text it deviates from was never amended, and tasks.md
## understates the deviation relative to how gap 2 was handled)

## What changed in `1298fcc`

`git diff 4e3d722..1298fcc --stat`: `.specs/STATE.md` (+/-), `spec.md` (+2
assumption rows), `tasks.md` (T2 and T3 rows edited), `validation.md` (prior
Verifier's file, untouched by the author — correctly left for me to
overwrite). No file under `apps/site/` or `.github/workflows/` touched by this
commit — consistent with a docs-only evidence fix, no re-litigation of the
mechanism already verified sound in iteration 1.

## Gap 1 (LPB-03) — independently re-investigated

**Claim under test**: the historical PR #108 run (job `90705185185`, run
`30489992711`) has no recoverable per-metric data, so the author substituted
the discrimination sensor's (LPB-07) failing run as attribution evidence.

**Independent check of the historical run** — I ran
`gh run view --job=90705185185 --repo accd/verchestra --log-failed` myself.
Confirmed: the only Lighthouse-related output is:

```
Checking assertions against 1 URL(s), 1 total run(s)
  ✘  categories.performance failure for minScore assertion
        expected: >=0.95
           found: 0.92
Assertion failed. Exiting with status code 1.
```

No per-metric breakdown anywhere in the log. I also queried
`gh api repos/accd/verchestra/actions/runs/30489992711/artifacts` directly:
the run has exactly one artifact, `gate-selection-49c6ba5a...`
(556 bytes, unrelated to Lighthouse) — no `.lighthouseci` artifact was ever
uploaded for this run. **The author's factual claim is independently
confirmed true, not just asserted.** This part of the fix is solid.

**Is the substitution legitimate evidence, or evidence-laundering?**
Reading LPB-03's exact text (`spec.md:82-84`):

> WHEN the classification is recorded THEN it SHALL name the specific metric
> or metrics carrying the score loss, with their numeric values, and SHALL NOT
> attribute the loss to a metric whose assertion passed.

Read in isolation this is generic ("the classification," "the loss") and
could be argued to just mean "whichever failure is being classified." But
LPB-03 does not stand alone — it is P1's AC 3, and P1's own User Story
(`spec.md:60-62`) is unambiguous: *"I want the 0.92 result attributed to
either site cost or measurement noise with evidence."* The Independent Test
for the whole P1 group (`spec.md:87`) says the evidence must answer
"deterministic or unstable, and in which metric, **with numbers a reviewer
can re-derive from the artifact**." Both anchor LPB-03 to the actual 0.92
event, not to "some failing case with the same shape."

Given that anchor, substituting the discrimination sensor's numbers is **not
literal satisfaction of LPB-03** — it attributes a different, synthetic
event's loss, not the original 0.92 run's loss (which no longer has
recoverable data, full stop). The author's spec.md assumption row is honest
about this ("a controlled case with the same shape is honest evidence; a
guess about the historical case would not be") — that framing is correct
science and I agree it's better than fabricating historical numbers or
leaving the requirement silently unmet. But the *label* applied downstream is
where the gap remains:

- tasks.md's T3 row is marked plain **"Done"** — the same status word used for
  literal completion elsewhere in the table — with no `SPEC_DEVIATION` tag,
  even though this is a strictly larger deviation from AC wording than T2's
  N=5/N=10 gap, which *does* carry an explicit `SPEC_DEVIATION` tag in its own
  row. Treating the two gaps inconsistently (one flagged, one not) is a
  documentation defect on its own.
- More importantly, **the normative LPB-03 text itself (`spec.md:82-84`) and
  the P1 Independent Test (`spec.md:87`) were never touched by this commit.**
  The only trace of the narrowing is an assumptions-table row, which is the
  right place to log *why* a deviation happened but is not a substitute for
  updating the requirement text a future reader would check the evidence
  against. A clean-clone successor reading AC LPB-03 in isolation, without
  finding or fully absorbing the assumptions table, would still expect
  attribution of the *actual* 0.92 event and reasonably conclude the AC is
  unmet.

**Recommended exact fix** (not yet made): amend `spec.md:82-84` to read
(new clause underlined in spirit, not literally inserted here — the author
should choose exact phrasing):

> 3. **LPB-03** — WHEN the classification is recorded THEN it SHALL name the
>    specific metric or metrics carrying the score loss, with their numeric
>    values, and SHALL NOT attribute the loss to a metric whose assertion
>    passed. **When the failing case being classified has no recoverable
>    per-metric data (e.g., a historical CI run that predates this feature's
>    instrumentation), this MAY be satisfied by a controlled reproduction
>    exhibiting the same score-loss shape, explicitly logged as substituted
>    evidence rather than the original run's data.**

And correspondingly soften `spec.md:87`'s Independent Test to acknowledge the
substitution path. Until that text changes, LPB-03 is **not fully closed** —
it is closed for the *phenomenon* (instability, FCP/Speed-Index-driven) but
not for the *AC as literally written*, and the tasks.md status line
overclaims by saying "Done" with no qualifier.

**Physical plausibility of the T3 numbers** — independently sanity-checked
against Lighthouse's own metric definitions, not just re-stated:
- A synchronous 1.5s main-thread-blocking script placed before `</head>`
  delays parsing/first-paint itself, so First Contentful Paint and Speed
  Index (which both measure time-to-visual-progress) are directly and
  heavily damaged — FCP score 0.46 at ~1662ms and Speed Index 0.74-0.75 are
  consistent with a ~1.5s paint delay stacked on a ~150-300ms baseline.
- Total Blocking Time is defined as the sum of (task duration − 50ms) for
  long tasks strictly *between* FCP and Time-to-Interactive. A block that
  finishes *before* FCP occurs is by definition excluded from that window —
  it delays FCP rather than accumulating post-FCP blocking time. The claimed
  `total-blocking-time: 0` is the mechanically correct outcome of the
  injection point chosen (before `</head>`, i.e., before first paint), not a
  hand-wave. The T3 row's own reasoning states this correctly.
- LCP and CLS assertions are threshold-on-raw-value (`maxNumericValue`), not
  threshold-on-score, so a lowered LCP *score* (0.74-0.75, since the scoring
  curve penalizes ~1666ms) coexisting with a *passing* assertion (threshold
  2500ms) is internally consistent — this resolves what could otherwise look
  like a contradiction in the T3 row.

The reasoning holds together; my only issue with T3 is the status/labeling
overclaim above, not the physics or the underlying numbers.

## Gap 2 (LPB-02 N=5 vs N=10) — re-examined

The `SPEC_DEVIATION` tag and assumption row are now present and specific
(`spec.md`'s new second assumption row; `tasks.md` T2 row). The stated
rationale — median=1 and minimum=0.92 are already fixed by the 5-point sample
and cannot move with more *passing* draws, while post-remedy runs would
sample a structurally different (3-run-median) config — is arithmetically
sound for the two summary statistics already observed, and correctly
distinguishes "more confidence" from "verdict could change."

Countervailing consideration (noted, not dispositive): the author did not
attempt the technically available alternative of collecting more single-run
CI samples via a scratch branch or an `lhci` CLI override
(e.g., `--collect.numberOfRuns=1` on a one-off dispatch) without touching the
committed config — this was feasible and would have gotten closer to N=10
without "measuring the new config." Skipping it is a defensible efficiency
call given the classification is not close to either boundary (4 of 5 points
are a clean ceiling, one is a single historical outlier), but it is also
fair to call it "stopping once the answer is known" rather than "impossible
to do more." I record this as **closed with a legitimate, if convenience-
favoring, documented deviation** — consistent with how the first Verifier
scored the underlying math, now with the deviation properly flagged this
time. This gap is resolved.

## Gap 3 (STATE.md staleness) — re-examined

New Handoff section (`STATE.md` diff) states: T1-T7 complete, first Verifier
FAIL and its three gaps, PR **#139** open against `accd:main` (not merged),
current classification and remedy summary, gates status, and an explicit
next step ("re-dispatch the Verifier against `4c0ce07..HEAD`"). Cross-checked
against `tasks.md`'s Execution Evidence table (T1-T7 all "Done") and
`git log` (`1298fcc` is HEAD, matches). No discrepancy found. **This gap is
resolved.**

## Spot-check of iteration-1's already-sound findings (not re-derived, just
## confirmed undisturbed by `1298fcc`)

- `apps/site/lighthouserc.cjs`: `numberOfRuns: 3`, `aggregationMethod:
  "median"`, `categories:performance": ["error", { minScore: 0.95 }]` —
  confirmed present and unchanged by re-reading the file directly; `1298fcc`
  touches no file under `apps/site/`.
- `git status --short`: clean, no output — tree matches HEAD, no stray files.
- No new scope creep: `1298fcc`'s stat touches only the 3 spec-tooling files
  plus this validation file; no `.github/` or `apps/site/` drift.

## Per-AC evidence table (delta from iteration 1)

| AC | Iteration-1 verdict | Iteration-2 verdict | Why |
| --- | --- | --- | --- |
| LPB-01 | Yes | Yes (unchanged) | Not touched by this fix; already sound. |
| LPB-02 | Partially | **Yes, with documented deviation** | `SPEC_DEVIATION` tag + assumption row now present and the reasoning is sound; countervailing point noted above but non-blocking. |
| LPB-03 | No | **Partially — phenomenon attributed, AC text not reconciled** | Factual claim (historical data unrecoverable) independently verified true via live `gh` query. Substitution is honest, logged, and physically coherent, but it satisfies a *narrowed* version of LPB-03 that the spec's normative text and Independent Test were never updated to state. tasks.md's "Done" label also does not carry the same deviation flag T2 got, understating how large a departure this is. |
| LPB-04 | N/A | N/A (unchanged) | Correctly not applicable. |
| LPB-05 | Yes | Yes (unchanged) | Not touched by this fix. |
| LPB-06 | Yes | Yes (unchanged) | Not touched by this fix. |
| LPB-07 | Yes | Yes (unchanged) | Not touched by this fix; its output is now also reused as T3's substitute evidence, which is consistent. |
| STATE.md staleness | Stale (Low gap) | **Fixed** | Handoff rewritten, cross-checked accurate. |

## Gaps found (ranked)

1. **(Medium, downgraded from High) LPB-03's normative text was not amended
   to match the narrower thing it now actually proves.** The factual
   groundwork is solid (independently re-verified the historical run is
   truly unrecoverable) and the substitute evidence is honest and physically
   coherent, so this is no longer a "nothing was ever attributed" gap. But
   claiming the AC is simply "Done" — without either (a) editing
   `spec.md:82-84`/`:87` to state explicitly that a controlled reproduction
   may stand in when the classified case's own data is gone, or (b) tagging
   `tasks.md`'s T3 row with the same `SPEC_DEVIATION` marker T2 got — leaves
   a reader of the requirement text alone with an expectation the evidence
   does not literally meet. Fix: amend the AC/Independent Test wording per
   the suggested language above, and add a `SPEC_DEVIATION` tag to T3
   mirroring T2's.
2. **(Low, informational) LPB-02's N=5 could have been closer to N=10** via
   a scratch-branch or CLI-flag diagnostic run without touching the
   committed config; not done. Non-blocking given the classification isn't
   near a boundary, but worth a one-line acknowledgment that this path was
   considered and skipped for cost, not impossibility.

## What must happen before PASS

Either amend `spec.md`'s LPB-03 AC and Independent Test text to explicitly
allow controlled-reproduction substitution when the original event's data is
gone, and add the missing `SPEC_DEVIATION` tag to tasks.md's T3 row — or, if
the author disagrees with my reading that the AC is event-specific, argue
that explicitly in spec.md rather than leaving the mismatch implicit. This is
a small textual fix, not new engineering work; the underlying evidence and
mechanism are otherwise sound and gaps 2 and 3 are fully resolved.
