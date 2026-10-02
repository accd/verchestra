---
schema: verchestra-feature-handoff/v1
feature: architecture-deepening
issue: null
status: verification
branch: main
baseRevision: 9eb2881ea0c24c2bea9028036093e9cd8cbad3f9
lastCompletedTask: T4
nextTask: "Every task of the programme is merged. Closing checks: the five-target candidate build from main (run 37046348715, in progress when this was written) and a fresh architecture review of main. Follow-ups in progress on their own branches: Run record hardening (fix/run-record-hardening) and the driver event order after a cancel (fix/driver-cancel-terminal-event)."
lastGate: "Required checks and SonarCloud PASS on #466-#470; platform matrix PASS on the T4 branch at 2627e5d (build run 37040215226, security run 37040219530)"
updatedAt: 2026-10-02T18:20:00Z
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
| T4a      | #466         | `28b4e74` | `validation-c4.md`; AD-048                                               |
| T4b      | #467         | `91a906e` | `validation-c4.md`                                                       |
| T4c      | #468         | `0961c9f` | `validation-c4.md`                                                       |
| T4d      | #470         | `9eb2881` | `validation-c4.md`; AD-049; two driver requalification reports           |

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

T4 on the platform matrix, five targets: the first build run (37035210650)
failed one case on Windows x64, a real defect (a stop asked the Claude Code
driver's terminator twice, and the terminal event lost its reason). It was fixed
in T4d, and build run 37040215226 and security run 37040219530 passed at
`2627e5d`. The review before merge also found that a closed terminal orphaned a
provider once it led its own process group; T4d stops the provider tree on a
hang-up or a termination request and leaves the run resumable.

CodeQL reported a polynomial regular expression in the version probe (T3b)
while T4c was in review. #469 (`832aa5e`) bounds the text and starts each
pattern at a digit run; no alert is open.

# Next Exact Action

All tasks are merged. Two closing checks remain: the five-target candidate
build from `main` at `9eb2881` (run 37046348715), and a fresh architecture
review of that revision to confirm the eight frictions are gone.

Follow-ups, each on its own branch and with its own evidence: Run record
hardening (`review` verifies the plan digest, containment below a per-Run
root, sealing the five plain markers) and the driver event order after a
cancel (nothing follows the terminal event).

`0.0.0-qualification.5` was published from `e17abb3`, before T4. A release
that carries T4 is the next publication.

# Blockers

None.
