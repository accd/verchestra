---
schema: verchestra-feature-handoff/v1
feature: probe-multi-parameter
issue: 235
status: verification
branch: fix/235-probe-multi-parameter
baseRevision: 6ce57bc73b6d14e5a5ebe4a48e7ad5ef1c9c3305
lastCompletedTask: null
nextTask: "Dispatch an independent Verifier over 6ce57bc7..HEAD with every check (C1-C7)."
lastGate: "Built at c6b30009. Every proof passes on Windows and Linux (C6-C7 with a real worker on Linux, the platform refusal on Windows). Windows: gate:quick exit 0 (3666/464/14), test:architecture 149/149, complexity:check and agent:check PASS. Linux: gate:quick exit 0 (3666/464/14); at b5ade112 test:contract 1031/1031, test:integration 1286/1286, test:architecture 149/149."
updatedAt: 2026-10-29T20:30:00Z
---

# Evidence

Slice 2b (#690) shipped `vestra probe run` with a known refusal: a statement with
two binds of one classification is refused when it is planned. On 2026-10-29 that
was traced to data-probe's planner, which de-duplicates the parameter
classifications that every engine parser keeps one per bind. Because the command
classifies every parameter as the database is, it refuses every statement with
two or more parameters, on every engine. Reproduced on main at `6ce57bc7`
through `sqliteFixture` with two binds: the plan holds [`internal`], the parse
[`internal`, `internal`], and the supervisor refuses with
`VES_SQLITE_PARAMETERS_INVALID`.

The owner chose on 2026-10-29 to fix it before planning the credential feature,
and to fix it in the planner (keep one classification per bind, sorted) rather
than in the seven adapters. `checks.md` holds 7 checks at profile `light`, with
the `## Intent` escape: one source file changes and no door is one-way. The
digests a zero- or one-bind plan had on main are pinned in C2.

The fix is built (e7628d32..c6b30009): data-probe's planner sorts the
parameter classifications without dropping a repeated one (`sortedValues` in
`packages/data-probe/src/index.ts`), so all eight engines run a read with two
parameters of one classification and `vestra probe run` binds every
parameter. Slice 2b's unit test that pinned the old plan-time refusal now
requires one classification per bind. What the build settled is under
`## Handoff` in `checks.md`.

# Next exact action

Dispatch an independent Verifier over `6ce57bc7..HEAD` with every check
(C1-C7). C6 and C7 need a real worker, so they run on Linux or macOS; on
Windows the command refuses.
