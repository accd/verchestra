---
schema: verchestra-feature-handoff/v1
feature: architecture-deepening
issue: null
status: in_progress
branch: main
baseRevision: e17abb3c8970b72c837bbbd07f86b4676ca9adb3
lastCompletedTask: T2
nextTask: "T4a-T4d (branch refactor/driver-session-runner): the driver session runner, its adoption by the verifier and the self-test scenarios, and process-tree termination with driver requalification. Each needs the platform matrix on all five targets before merge. Then a five-target candidate build from main and a fresh architecture review."
lastGate: "Required checks and SonarCloud PASS on #458-#463; platform matrix PASS on the TA, T3 and T2 branches (see Completed Evidence)"
updatedAt: 2026-10-02T14:10:00Z
---

# Scope

Deepen eight areas found by the 2026-10-01 architecture review, and let the
governed task path authenticate providers through subscriptions.

# Completed Evidence

The review and its eight candidates are summarized in `spec.md`. The owner
approved the plan on 2026-10-02, including the two behaviour fixes (SHA-256
idle cancel and process-tree termination).

Merged to `main`, each with its evidence file:

| Task     | Pull request | Commit    | Evidence                                                                 |
| -------- | ------------ | --------- | ------------------------------------------------------------------------ |
| T0       | #443         | `af7d047` | `spec.md`; ledger entry for `.4`                                         |
| T5       | #444         | `6fb623a` | `validation-c5.md`                                                       |
| T8       | #445         | `b714ad8` | `validation-c8.md`                                                       |
| T7a      | #446         | `d195400` | `validation-c7.md`                                                       |
| T6a      | #447         | `0cb454b` | `validation-c6.md`                                                       |
| T6b      | #448         | `ac59fac` | `validation-c6.md`                                                       |
| T7b      | #449         | `44c1c10` | `validation-c7.md`; AD-042                                               |
| T1a      | #454         | `7197954` | `validation-c1.md`; AD-043                                               |
| T1b      | #455         | `8c305e4` | `validation-c1.md`                                                       |
| T1c      | #456         | `a6df70a` | `validation-c1.md`                                                       |
| TA1, TA2 | #458         | `0158e48` | `validation-a.md`, `.specs/features/subscription-provider-auth/`; AD-044 |
| T3a      | #459         | `d9e834c` | `validation-c3.md`; AD-045                                               |
| T3b      | #460         | `60ebd82` | `validation-c3.md`; AD-046                                               |
| T2a      | #461         | `c0bc40c` | `validation-c2.md`; AD-047                                               |
| T2b      | #462         | `b90df87` | `validation-c2.md`                                                       |
| T2c      | #463         | `e17abb3` | `validation-c2.md`                                                       |

T6 and T1 ran the platform matrix on their branches before merge and passed on
all five targets. T1b supports SHA-256 repositories end to end and makes an
idle cancel fail closed; T1c runs git with a scrubbed environment. T7b's
workflow change has not run on a real dispatch yet; the next publication
exercises it.

Platform matrix on the branches merged on 2026-10-02, five targets each:

- TA: security run 37003053742 and build run 37005485083. Build run
  37003050689 had failed one integration test on Windows x64; the test was
  corrected (it now asserts the platform refusal there) before merge.
- T3: security run 37012457420 and build run 37013165178.
- T2: build run 37013539782 and security run 37013545207.

Nothing in TA ran against a real Claude Code or Codex session. The first live
run is the pilot (#406), which needs a published release that carries TA and
the owner's two subscription logins (`docs/quick-start.md`).

# Next Exact Action

T4a-T4d are in progress on `refactor/driver-session-runner`. T4d (process-tree
termination) is its own pull request, requalifies the Claude Code and Codex
drivers, and merges only with a platform matrix run that passes on all five
targets. After T4: a five-target candidate build from `main`, and a fresh
architecture review to confirm the eight frictions are gone.

Follow-ups recorded by T2, not started: seal the five plain per-Run markers,
check links below a per-Run root, and make `review` verify the plan digest as
`approve` does.

# Blockers

None.
