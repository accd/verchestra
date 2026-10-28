---
schema: verchestra-feature-handoff/v1
feature: linear-growth-batches
issue: 598
status: verification
branch: test/linear-growth-equal-batches
baseRevision: ff557cf2a31e39625b77b9f11db65ec073742ffb
lastCompletedTask: T1
nextTask: "T2: merge #637 on review with every required check green on its exact head (Site quality waits for #638), then verify by content."
lastGate: "platform-matrix gate=quick runs 40672534713 and 40672546465 green on all five legs at 08caf92, macOS x64 included; tests/unit/linear-growth.test.mjs 7 of 7, five helper mutants killed, the callers 146 of 146, pnpm gate:quick and agent:check PASS"
updatedAt: 2026-10-28T11:30:00Z
---

# Evidence

T1 is recorded in `validation.md`. The large input now runs a quarter as many
times as the small one, so for a linear cost both batches last about as long,
and the verdict is the median of the rounds. On 16 cores loaded two and three
times over, `main`'s helper failed linear functions that this one passes,
while both still fail quadratic work.

# Next exact action

Merge #637 once `Site quality` passes on its head, which needs #638 on `main`
first, and verify the merge by content.
