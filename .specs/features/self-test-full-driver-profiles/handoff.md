---
schema: verchestra-feature-handoff/v1
feature: self-test-full-driver-profiles
issue: 12
status: in_progress
branch: codex/issue-12-t71-self-test
baseRevision: 4b984c7e541863fe056a31a9e72749f9bcf46f7f
lastCompletedTask: T2
nextTask: T3
lastGate: 49 focused T71 unit/fault cases, lint, complexity, typecheck, and format PASS on Node 24.18.0
updatedAt: 2026-08-03T17:41:42Z
---

# Scope

Implement T71 `full`, hard-crash, and explicitly approved read-only `drivers`
Self-Test behavior for issue #12. Preserve the four sealed profile IDs, the
T69 trust boundary, the T70 report/CLI contract, and offline deterministic
execution.

# Authority and external effects

Antonio explicitly confirmed that work may start and `MiguelCorre` is assigned
to #12. The issue's stale `status: blocked` label is not changed here. Local
atomic commits are authorized. Push, PR creation, merge, release, and issue
metadata changes are not authorized yet.

# Completed evidence

- Read root and scoped repository instructions, architecture, repository map,
  roadmap, current state, T69 spec/design, and T70 spec/design/tasks/handoff.
- Confirmed issue #12 is open, assigned to `MiguelCorre`, and has no comments.
- Confirmed AD-010's three-region boundary and sealed four-profile registry.
- Restored existing frozen workspace links with
  `pnpm install --frozen-lockfile`; no dependency or lockfile update occurred.
- Baseline `pnpm gate:quick` passes. The repository pins Node 24.14.0; the
  local run used Node 24.18.0 and pnpm 10.34.5.
- Created local branch `codex/issue-12-t71-self-test`; nothing was pushed.
- T0 planning committed as `f568642`.
- T1 adds closed `FULL_CHECK_IDS`, `DRIVER_CHECK_IDS`, the eleven
  `FULL_DURABLE_BOUNDARY_IDS`, and the before/after crash phases. Full and
  Driver profiles now require their T71 checks rather than accepting an empty
  scenario.
- T1 application verdicts reject incomplete, duplicated, malformed,
  non-exactly-once, non-resumed, or divergent durable facts. Driver verdicts
  bind every displayed review field, require an explicit read-only Tool list,
  prove denied authority reached zero provider boundaries, and require exactly
  one provider boundary for an approved invocation.
- T1 focused evidence: 33/33 unit cases pass; lint, typecheck, formatting, and
  the complexity ratchet pass with no new baseline exemption.
- T1 contracts committed as `ba7969b`.
- T2 adds `DurableCrashRunner` under the Node-bound Self-Test adapter. It runs
  a repository-owned absolute child entrypoint first in hard-crash mode and
  then in resume mode against the same disposable root, uses no shell, passes
  only the explicit `VERCHESTRA_SELF_TEST` environment marker, bounds runtime
  and output, and returns persisted facts plus exit codes without deciding a
  verdict.
- The application rule now requires the expected hard-crash exit code 86 and a
  successful resume exit in addition to exact-once and fingerprint convergence.
- T2 focused evidence: all 22 before/after boundary cases plus complete-matrix,
  missing-facts, unavailable-executable, and relative-entrypoint cases pass.
  Combined T71 unit/fault run is 49/49; lint, typecheck, format, and complexity
  pass.

# Decisions

- Use one new feature directory because T71 is a distinct roadmap task.
- Keep crash recovery as a `full` mode.
- Use a closed durable-boundary catalog and before/after child-process matrix.
- Exercise existing production stores/coordinators; an observational journal
  may record facts but must not become a parallel workflow implementation.
- Driver denial must occur before adapter construction/resolution and prove an
  exact zero provider-boundary count.
- Approved Driver paths use the real qualified adapter code with injected local
  deterministic process/SDK substitutes.
- Do not create a T71 qualification report from the authoring worktree;
  independent verification remains external.

# Next action

Commit T2 atomically, then map the exact production constructors and implement
the T3 successful full workflow scenario test-first.

# Blockers

None for local implementation. External push and PR creation intentionally wait
for contributor review and explicit authorization.
