---
schema: verchestra-feature-handoff/v1
feature: milestone-2-completion
issue: null
status: in_progress
branch: main
baseRevision: aa3aab12e09de6d1d5af24d992c6e4014f8855c8
lastCompletedTask: null
nextTask: C4
lastGate: gate:quick and externally dispatched gate:security PASS at 2b628af; run 31330393346
updatedAt: 2026-08-09T19:05:00Z
---

# Scope

Programme feature: drive milestone 2 (`1.0.0 — Verified release`) to 100%
with truthful evidence. Requirements M2C-01..M2C-08 (`spec.md`); the 13 open
issues distributed across workstreams WS-A (accd), WS-B (MiguelCorre), WS-C
(brunomjanuario) per `tasks.md`. Reanalysis grounding: `analysis.md`.

# Completed Evidence

- 2026-08-09 — Milestone recomposition applied (M2C-01, M2C-02): description
  rewritten to the derived position; #217/#218/#207/#36 added; all 13 open
  issues assigned per the workstream table. Verified via
  `gh issue list --json number,assignees,milestone`.
- 2026-08-09 — AD-013 recorded in `.specs/STATE.md` (M2C-08).
- Work packages for MiguelCorre and brunomjanuario generated and delivered
  off-repository by the owner (M2C-06, M2C-07).
- 2026-08-09 — **A1 and A2 done**: AD-014 (DSSE + in-toto, #217) and AD-015
  (pinned estimator, #218) recorded and both issues closed (PR #228,
  `3f97047`); the DSSE migration spec satisfies DSSE-02.
- 2026-08-09 — **A3 in progress**: T75 matrix specification (PR #229), M-2
  evidence index (PR #230), F5 path-alias fix fleet-proven on the previously
  red legs (PR #231, run 31321090545).
- 2026-08-09 — **Product-shape decisions AD-016/AD-017** (structured design
  review with the owner): npx entry point (#36 scoped for B4); database
  probes qualify at the edge — D1/D2 of the platform matrix resolved; new
  1.0 task **C6 (#233, WS-C)** publishes the probe contract + conformance
  kit before the t75 report; scaffold, out-of-process host, and single
  binary filed as post-1.0 issues.
- 2026-08-09 — **B1 done:** T72 independently qualified in
  `docs/qualification/t72-validation.md`, bound to main-reachable `2b628af`.
  Sixty-nine focused cases pass; five verdict mutations are killed with no
  survivor; `gate:quick` and externally dispatched `gate:security` run
  31330393346 pass with zero skipped/todo. The report and every derived status
  surface advance atomically to "T72 complete; T73 next".

# Tracking gap closed (2026-08-09)

AD-014 and AD-015 both require their **implementation** before T76 starts, but
the decision issues (#217, #218) closed with the decisions and nothing carried
the work forward. Untracked mandatory work breaks this milestone's own "100%
equals backlog-zero" claim, so **#242** (DSSE envelope migration, task A8) and
**#243** (pinned context estimator, task A9) were filed against the milestone.
Not new scope — restored visibility of scope the ADs already committed to.

# Next Exact Action

**C4 (brunomjanuario): author `docs/qualification/t73-validation.md`.** B1 has
landed the independent T72 report and unblocked the serial chain. Re-derive the
T73 adequacy matrix, verify that campaign distributions cannot collapse into a
single aggregate score, run the required `pnpm gate:build`, satisfy
`docs/qualification/REPORT-CONTRACT.md`, and advance every derived status
surface atomically to "T73 complete; T74 next".

Parallel starts that block nobody: C1 (review PR #209), C3 (#110 closure
evidence), A1/A2 (owner ADs for #217/#218), A3 (T75 remaining matrices), B4
(#36 install path).

# Blockers

None for C4; B1 is complete. The serial chain blocks B2 on C4, B3 on
B2+A3+A4+C5+C6, A5 on B3+A8+A9+C2, and A6 on A5.

# Decisions

- Verifier assignment (owner, 2026-08-09, AD-013): MiguelCorre authors the
  T72/T74/T75 reports; brunomjanuario authors the T73 report. Grounds:
  accd authored the T72–T74 implementations; brunomjanuario authored F1a
  (PR #200) inside T75 scope.
- Milestone recomposition (owner, 2026-08-09, AD-013): #217, #218, #207, #36
  join milestone 2; previous assignees superseded.
- Coordination: rebase-forward only; never force-push; verify merges by
  content on `origin/main`; chain-advance surfaces only via
  qualification-report PRs, serially; human review before every merge.
- The #16 close of 2026-08-09T11:33Z without a report was reverted
  (report-before-close rule); #16 closes only with B3.

# Files Intentionally Left Unchanged

- Future `docs/qualification/*` reports remain reserved for their assigned
  independent verifiers (C4, B2, B3).
- Derived status surfaces after the completed B1 advance migrate only inside
  the next serial qualification-report PR.
- Stale feature handoffs listed in `analysis.md`'s appendix — separate
  cleanup, owner-scheduled.
- `_images_/` (untracked brand masters) — owner's working files, preserved.
