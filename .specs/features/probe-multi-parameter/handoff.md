---
schema: verchestra-feature-handoff/v1
feature: probe-multi-parameter
issue: 235
status: in_progress
branch: fix/235-probe-multi-parameter
baseRevision: 6ce57bc73b6d14e5a5ebe4a48e7ad5ef1c9c3305
lastCompletedTask: null
nextTask: "Build C1-C7 test-first from checks.md, then dispatch an independent Verifier over 6ce57bc7..HEAD with every check."
lastGate: "checks.md validated (0 errors, 0 warnings); no code yet"
updatedAt: 2026-10-29T19:00:00Z
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

# Next exact action

Build C1-C7 test-first from `checks.md` on `fix/235-probe-multi-parameter`. Run
C4 and C6 on Linux (WSL clone `~/verchestra-569`), since the real-worker proof
of C6 refuses on Windows. Then dispatch an independent Verifier over
`6ce57bc7..HEAD` with every check.
