---
schema: verchestra-feature-handoff/v1
feature: test-hygiene
issue: 598
status: verification
branch: test/598-test-hygiene
baseRevision: 3daf665d8aa34037a2bbc6610030e1d32198513d
lastCompletedTask: T3
nextTask: "Read the required checks on the pull request head, including the POSIX-only probe-host and SIGTERM tests in the Quality gate; on green, maintainer merge, then move this handoff to complete."
lastGate: "gate:quick PASS; touched suites 232 pass, 18 skipped, 0 fail; see validation.md"
updatedAt: 2026-10-27T10:00:00Z
---

# Evidence

T1 to T3 are recorded in `validation.md`. The five timing tests now wait on an
event or compare a ratio, and the new budget test kills a mutant the old
wall-clock bound let survive. `survivingMutants` is named reserved and not
measured in the contract and in the evidence that writes and reads it. On-demand
coverage, which #610 added, is named in `CONTRIBUTING.md`.

# Next exact action

Read the Quality gate on the pull request head: the probe-host and SIGTERM
tests run only there. Mark T4 and move this handoff to `complete` after review
and merge.
