---
schema: verchestra-feature-handoff/v1
feature: linear-growth-batches
issue: 598
status: complete
branch: main
baseRevision: ff557cf2a31e39625b77b9f11db65ec073742ffb
lastCompletedTask: T2
nextTask: "None in this feature."
lastGate: "PR #637 merged by rebase through the maintainer bypass at 2026-10-28 (main 65a5c10, 6a84234, ecc9d62; the diff main gained equal to the PR's over 0967a87, with #635 between sharing no file) with Quality gate, Site quality and CodeQL passing on the head 056e0a8; fleet runs 40672534713 and 40672546465 (gate=quick) green on all five legs; no independent review, so the contention runs and five mutation sensors in validation.md are the record"
updatedAt: 2026-10-28T12:30:00Z
---

# Evidence

T1 is recorded in `validation.md`. The large input now runs a quarter as many
times as the small one, so for a linear cost both batches last about as long,
and the verdict is the median of the rounds. On 16 cores loaded two and three
times over, `main`'s helper failed linear functions that this one passes,
while both still fail quadratic work.

# Next exact action

None in this feature.
