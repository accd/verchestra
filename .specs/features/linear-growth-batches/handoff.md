---
schema: verchestra-feature-handoff/v1
feature: linear-growth-batches
issue: 598
status: verification
branch: test/linear-growth-equal-batches
baseRevision: ff557cf2a31e39625b77b9f11db65ec073742ffb
lastCompletedTask: T1
nextTask: "T2: dispatch platform-matrix.yml with gate=quick twice on the pull request head and record macOS x64; merge on review with every required check green."
lastGate: "tests/unit/linear-growth.test.mjs 7 of 7, five helper mutants killed, the helper's callers 146 of 146, pnpm gate:quick and agent:check PASS on Windows; the contention runs in validation.md"
updatedAt: 2026-10-28T10:20:00Z
---

# Evidence

T1 is recorded in `validation.md`. The large input now runs a quarter as many
times as the small one, so for a linear cost both batches last about as long,
and the verdict is the median of the rounds. On 16 cores loaded two and three
times over, `main`'s helper failed linear functions that this one passes,
while both still fail quadratic work.

# Next exact action

Open the pull request, dispatch `platform-matrix.yml` with `gate=quick` twice
on its head, and record each macOS x64 result in `validation.md`.
