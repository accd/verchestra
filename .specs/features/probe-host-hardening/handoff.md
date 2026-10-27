---
schema: verchestra-feature-handoff/v1
feature: probe-host-hardening
issue: 570
status: verification
branch: test/570-probe-host-mutants
baseRevision: ff557cf2a31e39625b77b9f11db65ec073742ffb
lastCompletedTask: T2
nextTask: "T3: open the pull request from test/570-probe-host-mutants and merge on review with every required check green on its exact head."
lastGate: "The 153 probe-host tests pass on Linux (WSL Ubuntu, Node 24.14.0); all four mutation sensors in validation.md are killed; pnpm gate:quick passes on Windows."
updatedAt: 2026-10-28T09:45:00Z
---

# Evidence

T1 and T2 are recorded in `validation.md`. A worker that ignores the end of
its input is still killed at the time bound, the worker observes its private
directory as `0700` and its entry as `0500`, and the framed worker refuses a
frame under any payload schema version other than 1. Item 3 of #570 landed
with #632.

# Next exact action

When #632 is on `main`, rebase this branch onto it (it is unpushed, so no
force-push is needed), set `baseRevision`, rerun the probe-host suites, and
open the pull request.
