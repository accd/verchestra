---
schema: verchestra-feature-handoff/v1
feature: test-hygiene
issue: 598
status: complete
branch: main
baseRevision: 51df50404035ccfc9d1eae9e369a5540adda286c
lastCompletedTask: T4
nextTask: "None in this feature."
lastGate: "PR #618 merged by rebase through the maintainer bypass at 2026-10-27T09:38:04Z (main b3a2dc6, its diff equal to the PR's over the two SonarCloud commits 81855e6 and b7abe6e, which share no file with it) with Quality gate, Site quality and CodeQL passing on the head 1301f76 in run 40478961889, the POSIX-only probe-host and SIGTERM tests included; no independent review, so the implementing agent's local pass and mutation sensors in validation.md are the record"
updatedAt: 2026-10-27T12:02:29Z
---

# Evidence

T1 to T3 are recorded in `validation.md`. The five timing tests now wait on an
event or compare a ratio, and the new budget test kills a mutant the old
wall-clock bound let survive. `survivingMutants` is named reserved and not
measured in the contract and in the evidence that writes and reads it. On-demand
coverage, which #610 added, is named in `CONTRIBUTING.md`. T4 is the merge of
#618 with every required check green on its exact head; the probe-host and
SIGTERM tests, which cannot run on Windows, passed in that run's Linux Quality
gate.

# Next exact action

None in this feature.
