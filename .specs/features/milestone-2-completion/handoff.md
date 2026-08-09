---
schema: verchestra-feature-handoff/v1
feature: milestone-2-completion
issue: null
status: in_progress
branch: main
baseRevision: aa3aab12e09de6d1d5af24d992c6e4014f8855c8
lastCompletedTask: null
nextTask: B1
lastGate: null
updatedAt: 2026-08-09T15:00:00Z
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

# Next Exact Action

**B1 (MiguelCorre): author `docs/qualification/t72-validation.md`.** The T72
implementation and remediation are merged (PRs #188, #208, #211, #212;
evidence comment on #13). Bind the report to a main-reachable revision, run a
discrimination sensor over the doctor verdict surface, satisfy
`docs/qualification/REPORT-CONTRACT.md`, and migrate every derived status
surface plus pinned contract tests to "T72 complete; T73 next" in the same
change. `pnpm gate:security` must pass.

Parallel starts that block nobody: C1 (review PR #209), C3 (#110 closure
evidence), A1/A2 (owner ADs for #217/#218), A3 (T75 remaining matrices), B4
(#36 install path).

# Blockers

None for Phase 1. The serial chain blocks C4 on B1, B2 on C4, B3 on
B2+A3+A4+C5, A5 on B3+A1+A2+C2, A6 on A5.

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

- `docs/qualification/*` — reports are authored only by their assigned
  independent verifiers (B1, C4, B2, B3).
- Derived status surfaces (root `AGENTS.md` counter, `llms.txt`, site
  `product.ts`, current-qualification content) — migrate only inside chain
  advances.
- Stale feature handoffs listed in `analysis.md`'s appendix — separate
  cleanup, owner-scheduled.
- `_images_/` (untracked brand masters) — owner's working files, preserved.
