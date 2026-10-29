---
schema: verchestra-feature-handoff/v1
feature: probe-multi-parameter
issue: 235
status: complete
branch: fix/235-probe-multi-parameter
baseRevision: 6ce57bc73b6d14e5a5ebe4a48e7ad5ef1c9c3305
lastCompletedTask: null
nextTask: "Owner review of the probe-multi-parameter PR; after it lands, the owner decides the next T3 step (the database credential is its own feature)."
lastGate: "Independent Verifier round 1 PASS at ba4aa226 (7/7; Windows proofs 7/7, gate:quick, test:architecture 149; Linux proofs 7/7, gate:quick, test:contract 1031, test:architecture 149, test:integration 1286, test:e2e 363); validate_verification exit 0"
updatedAt: 2026-10-29T21:10:00Z
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

The independent Verifier proved C1-C7 at `ba4aa226` (`verification.md`, round
1, PASS, profile `light`), on Windows and on Linux, where C6 and C7 ran a real
worker. It confirmed C2's digests and the defect itself on `6ce57bc7`, and
judged the changed slice 2b assertion equal in input and layer with the
expectation inverted, not weakened. Its non-failing notes: C3 proves each
engine's worker bind-count check over a fake connection, while a real database
binds only in C4 and C6 (SQLite); C2 pins SQLite's plans only; macOS is not
run.

# Next exact action

The owner reviews the PR. After it lands, the owner decides the next T3 step;
delivering a database credential to the worker is its own feature (owner,
2026-10-29).
