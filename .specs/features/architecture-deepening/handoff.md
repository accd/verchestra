---
schema: verchestra-feature-handoff/v1
feature: architecture-deepening
issue: null
status: in_progress
branch: main
baseRevision: 44c1c100ffdaf6764f34d6f00262d695ef126921
lastCompletedTask: T7
nextTask: "Integrate TA1/TA2 (branch feat/subscription-provider-auth) and T1a-T1c (branch refactor/task-worktree-module): review, platform matrix on the branch, then merge in that order. Then T3a (after TA2), T2a (after T1b), and T4a (after T3b)."
lastGate: "Quality gate, Site quality, CodeQL and SonarCloud PASS on #444-#449; platform matrix PASS on the T6 branch (build run 36994423941, security run 36994427778)"
updatedAt: 2026-10-02T11:00:00Z
---

# Scope

Deepen eight areas found by the 2026-10-01 architecture review, and let the
governed task path authenticate providers through subscriptions.

# Completed Evidence

The review and its eight candidates are summarized in `spec.md`. The owner
approved the plan on 2026-10-02, including the two behaviour fixes (SHA-256
idle cancel and process-tree termination).

Merged to `main`, each with its evidence file:

| Task | Pull request | Commit    | Evidence                         |
| ---- | ------------ | --------- | -------------------------------- |
| T0   | #443         | `af7d047` | `spec.md`; ledger entry for `.4` |
| T5   | #444         | `6fb623a` | `validation-c5.md`               |
| T8   | #445         | `b714ad8` | `validation-c8.md`               |
| T7a  | #446         | `d195400` | `validation-c7.md`               |
| T6a  | #447         | `0cb454b` | `validation-c6.md`               |
| T6b  | #448         | `ac59fac` | `validation-c6.md`               |
| T7b  | #449         | `44c1c10` | `validation-c7.md`; AD-042       |

T6 ran the platform matrix on its branch before merge and passed on all five
targets. T7b's workflow change has not run on a real dispatch yet; the next
publication exercises it.

# Next Exact Action

TA1/TA2 and T1a-T1c are in progress on their branches. For each: review the
evidence, dispatch `platform-matrix.yml` on the branch, and merge only when it
passes on all five targets. T3a starts after TA2 because both change the Claude
Code driver. T2a starts after T1b. T4a starts after T3b.

# Blockers

None.
