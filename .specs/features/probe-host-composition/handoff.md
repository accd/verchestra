---
schema: verchestra-feature-handoff/v1
feature: probe-host-composition
issue: 235
status: complete
branch: feat/235-extension-commands
baseRevision: d069bf9291efaeeafbdc9dcea189fb56b8eafb0f
lastCompletedTask: T1
nextTask: "Confirm the next SonarCloud analysis of main passes the gate after the follow-up PR lands; then T3 continues as slice 2a (.specs/features/database-registration/), and slice 2b (`vestra probe run`) is planned after 2a lands."
lastGate: "Slice 1 landed as #681 (73f3ae24, tree-equal to the verified head f60417de); Verifier rounds 3 and 4 PASS on the two rebases (validate_verification exit 0); SonarCloud follow-up: gate:quick, test:contract and agent:check PASS on Windows, coverage suites and the extension, launcher, sealed closure, architecture and task suites PASS on Linux"
updatedAt: 2026-10-28T22:25:00Z
---

# Evidence

Slice 1 (T1) is complete, verified, and on main as #681 (`73f3ae24`). These commands
now take a workspace probe worker to "would be admitted" with nothing
started:

- `vestra extension add`
- `vestra extension approve`
- `vestra extension list`
- `vestra extension revoke`
- `vestra extension check`

Owner decisions taken mid-build are recorded in `plan.md`:

- Landing door 6: TLC is required by `resolve`, not by lock validation.
- The registration record is the update's evidence.
- Two Out of scope follow-ups: re-approving a revoked reference, and
  re-registering a worker.

The proof results per platform are in `validation.md`, with the dispositions
of the Verifier's round 1 findings. The independent report is
`verification.md`: round 1 failed on two pinned command lists outside the
checks (fixed in `ec219824`), and round 2 passed every check on Linux and
Windows. Main moved twice while the PR was in CI (the SonarCloud session's
S3776 refactors), so the feature was rebased twice (#679, then #680, landed as
#681); rounds 3 and 4 are scoped checks of those rebases and passed. macOS was
not run locally; CI covers it.

A SonarCloud follow-up, rebased onto main as branch
`sonar/681-extension-follow-up`, addresses the two quality gate conditions the
slice failed (new-code coverage and duplication). It changes no behaviour: it adds
in-process tests and removes the duplicated blocks SonarCloud named. Its
evidence is the "SonarCloud follow-up" section of `validation.md`; only the
next SonarCloud analysis can confirm the gate.

# Next exact action

Review and land the SonarCloud follow-up PR, then confirm the next SonarCloud
analysis of main passes the gate. T3 continues as slice 2a, database
registration (`.specs/features/database-registration/plan.md`, awaiting the
owner's review); slice 2b, `vestra probe run` with a per-run confirmed grant
(owner decisions, 2026-10-28), is planned after 2a lands.
