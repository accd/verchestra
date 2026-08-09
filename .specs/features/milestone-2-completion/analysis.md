# Milestone 2 Reanalysis — 2026-08-09

Full-backlog reanalysis of milestone `1.0.0 — Verified release`
(<https://github.com/accd/verchestra/milestone/2>) and every open issue,
ordered by the repository owner. Method: derived status
(`corepack pnpm agent:context`), reports on disk (`docs/qualification/`),
open pull requests, feature handoffs, and the GitHub issue/milestone state —
never chat memory alone. Main at `aa3aab12e09de6d1d5af24d992c6e4014f8855c8`.

## Verdict

The milestone issue set is correct but its description was stale
(2026-08-01, claimed "T68d complete; T69 next"), four release-gating issues
lived outside the milestone, and one issue (#110) was already effectively
resolved without closure. The real distance to 100% is: **four independent
qualification reports (T72–T75), the remaining T75 matrices, two owner
decisions, one candidate release (T76), one final acceptance (T77), and four
out-of-chain hardening items (#58, #35, #207, #36, #110 closure).** All of it
is now distributed across three workstreams (see `tasks.md`).

## Derived position

- `docs/qualification/` ends at `t71-validation.md`; `agent:context` derives
  **T71 complete; T72 next**. This is the authoritative counter.
- GitHub milestone arithmetic (13 closed / 13 open after recomposition) is
  ticket progress, not qualification progress.

## Chain state, task by task

| Task | Issue | Implementation | What actually remains |
| ---- | ----- | -------------- | --------------------- |
| T72 | #13 | Merged: PRs #188 + remediation #208 (architecture guard), #211 (redaction evidence), #212 (signing/sentinel evidence); evidence comment posted on #13 | Independent `t72-validation.md` bound to current main + atomic advance of the ~13 derived status surfaces ("T72 complete; T73 next") |
| T73 | #14 | Merged (feature `regression-campaigns`, T5 complete, status `verification`) | Independent `t73-validation.md` + atomic advance |
| T74 | #15 | Merged (feature `sealed-holdout`, T5 complete, status `verification`) | Independent `t74-validation.md` + atomic advance |
| T75 | #16 | Platform fleet GREEN: `gate:security` simultaneously on win-x64 / linux-x64 / linux-arm64 / darwin-arm64 at `5c86436` (run 31315589420; on-main confirmation 31315939879 at `bb11932`). Findings F1a (#200), F1b (#221), F2 (#225), F3 (#216), F4 (#222) all fixed and merged | Remaining matrices (topology, Driver, database incl. SAP ASE, sandbox, installer, recovery), the signed evidence index, live doctor probes (#207), the composed verifier session (#35), then independent `t75-validation.md` |
| T76 | #17 | Not started (correctly blocked) | Blocked by T75 report + owner decisions #217/#218 + #58 completion |
| T77 | #18 | Not started (correctly blocked) | Blocked by T76; needs an independent final verifier and a signed human decision |

macOS x64 note: the leg never dequeues on GitHub's retiring Intel fleet — an
environmental limitation recorded in the platform-matrix handoff, not a
product gap.

## Out-of-chain open issues

- **#58 (canonical JSON, mandatory before T76).** PR #209 (T4a: the four
  unqualified T72–T74 digest owners migrate to V2) is the only open PR and
  awaits human review. Remaining: the other owner rows of
  `docs/canonical-json-compatibility.md`, cross-locale byte-identity tests,
  and the discrimination sensor from the issue's acceptance list.
- **#110 (Lighthouse budget) — effectively resolved, not closed.** The
  diagnosis-gated fix merged in PR #139 on 2026-07-31 with the 0.95 threshold
  preserved; the 2026-08-09 site brand work re-confirmed a 3-run-median PASS
  at 0.95. The feature handoff still instructs "await review and merge of
  PR #139" — stale. Remaining: closure evidence at current main, handoff
  correction, issue close.
- **#35 (structural verifier independence).** Rules and resolution merged in
  PR #185 (2026-08-04, AD-011): distinct-driver enforcement,
  `resolveVerifierDriver`, zero-tool read-only grant, report
  `schemaVersion: 2`. The issue stays open by design: the live composed
  verifier session in the T74/T75 composition roots is the remaining
  acceptance bar.
- **#207 (deep-doctor live probes).** Seven of twelve doctor checks are
  presence-only (`fileProbe`/`existsSync`); the live upgrades need read-only
  observation APIs that only become observable on provisioned machines —
  lands with or before T75. Must preserve the T72 architecture guard
  (`tests/architecture/doctor-readonly-graph.test.mjs`).
- **#217 / #218 (owner decisions, pre-T76).** Complete option briefs exist at
  `.specs/features/dsse-attestation/spec.md` and
  `.specs/features/context-tokenizers/spec.md`; each needs an AD in
  `.specs/STATE.md` before T76 starts.
- **#36 (install friction).** `npx vestra` or a single binary; aligns with the
  qualified hermetic distribution work; lands near T76. Moved into the
  milestone by owner decision 2026-08-09.

## Corrections applied on 2026-08-09 (this programme)

1. Milestone description rewritten to the derived truth (T71 complete;
   per-task real state; #35 correctly listed inside the milestone).
2. #217, #218, #207, #36 added to the milestone — its 100% now equals
   backlog-zero (13 open issues).
3. All 13 open issues reassigned to the three workstreams (owner authorized
   ignoring previous assignees): accd → #16 #17 #18 #35 #217 #218;
   MiguelCorre → #13 #15 #36; brunomjanuario → #14 #58 #110 #207.

## Structural constraints the distribution honors

- **Author ≠ verifier.** accd authored the T72–T74 implementations
  (PRs #188/#189/#190 and the C-1..C-3 remediation) and therefore cannot
  author `t72/t73/t74-validation.md`. brunomjanuario authored F1a (PR #200)
  inside T75 scope and therefore does not author `t75-validation.md`.
  Verifier assignment (owner decision, AD-013): MiguelCorre authors the T72,
  T74, and T75 reports; brunomjanuario authors the T73 report.
- **Serial chain, atomic advance.** Reports land strictly in order
  T72→T73→T74→T75; each advance is one atomic change: the report plus every
  derived status surface and pinned contract test migrate together. No
  downstream task is claimed early; a closed issue is not evidence of
  qualification.
- **Coordination.** Rebase-forward only, never force-push or rewrite main
  history; verify every merge by content on `origin/main`, never by the PR
  MERGED state alone; chain-advance surfaces are touched only by
  qualification-report PRs, serially. Human review before every merge.

## Appendix — stale feature handoffs (documented, not fixed here)

`agent:context` lists these features as active although their issues are
closed or their next actions already happened. They do not gate the
milestone; reconciling them is a separate doc-only cleanup for the owner to
schedule: `agent-ready-repository`, `ci-gate-selection` (#59),
`cli-init-preview` (#64), `key-lifecycle` (#51),
`lighthouse-performance-budget` (#110 — corrected by task C3),
`opencode-cancellation-race` (#109), `parallel-task-scheduler` (#33),
`probe-evidence-wiring` (#34), `probe-value-declassification` (#107),
`public-proof-artifact` (#155), `isolation-process-tree` (#88),
`structural-verifier-isolation` (#35 — superseded by A4). The
2026-08-09 anomaly on #16 (closed without a report by an external action,
then reopened under the report-before-close rule) is recorded in the
session-coordination protocol and resolved by tasks A3/B3.
