---
schema: verchestra-feature-handoff/v1
feature: architecture-deepening
issue: null
status: in_progress
branch: main
baseRevision: a6df70a2347d34d0ddec00b99bb5bccef73284dc
lastCompletedTask: T1
nextTask: "Merge TA1/TA2 (branch feat/subscription-provider-auth) once the platform matrix passes on all five targets; one integration test fails on Windows x64 in build run 37003050689 and is being corrected. T2a-T2c and T3a-T3b are in progress on branches based on that one. T4a starts after T3b."
lastGate: "Required checks and SonarCloud PASS on #454-#456; platform matrix PASS on the T1 branch tip (build run 36997741260, security run 36997744391)"
updatedAt: 2026-10-02T12:10:00Z
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
| T1a  | #454         | `7197954` | `validation-c1.md`; AD-043       |
| T1b  | #455         | `8c305e4` | `validation-c1.md`               |
| T1c  | #456         | `a6df70a` | `validation-c1.md`               |

T6 and T1 ran the platform matrix on their branches before merge and passed on
all five targets. T1b supports SHA-256 repositories end to end and makes an
idle cancel fail closed; T1c runs git with a scrubbed environment. T7b's
workflow change has not run on a real dispatch yet; the next publication
exercises it.

# Next Exact Action

TA1/TA2 are in review on `feat/subscription-provider-auth`. Its platform matrix
passed the security gate on all five targets (run 37003053742) and failed one
integration test on Windows x64 in the build gate (run 37003050689,
`tests/integration/codex-identity.test.mjs`: the fake provider cannot write its
log without `TEMP`). Merge it only after a build run passes on all five.
T2a-T2c (`refactor/task-run-record`) and T3a-T3b
(`refactor/driver-session-ledger`) are in progress on branches based on that
one, and rebase onto `main` after it merges. T4a starts after T3b.

# Blockers

None.
