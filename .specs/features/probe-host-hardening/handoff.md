---
schema: verchestra-feature-handoff/v1
feature: probe-host-hardening
issue: 570
status: complete
branch: main
baseRevision: ff557cf2a31e39625b77b9f11db65ec073742ffb
lastCompletedTask: T3
nextTask: "None in this feature; #570 is closed."
lastGate: "PR #635 merged by rebase through the maintainer bypass at 2026-10-28 (main 54fd6b8, e97cb74, 61434b4; tree equal to the head df8b1e4, which merged main at 0967a87 for the pinned site job) with Quality gate, Site quality and CodeQL passing on that head; no independent review, so the Linux runs and four mutation sensors in validation.md are the record"
updatedAt: 2026-10-28T12:30:00Z
---

# Evidence

T1 and T2 are recorded in `validation.md`. A worker that ignores the end of
its input is still killed at the time bound, the worker observes its private
directory as `0700` and its entry as `0500`, and the framed worker refuses a
frame under any payload schema version other than 1. Item 3 of #570 landed
with #632.

# Next exact action

None in this feature; #570 is closed.
