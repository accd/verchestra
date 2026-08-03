---
schema: verchestra-feature-handoff/v1
feature: self-test-full-driver-profiles
issue: 12
status: in_progress
branch: codex/issue-12-t71-self-test
baseRevision: 4b984c7e541863fe056a31a9e72749f9bcf46f7f
lastCompletedTask: T0
nextTask: T1
lastGate: pnpm gate:quick PASS on Node 24.18.0
updatedAt: 2026-08-03T18:00:00Z
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

Review and commit T0 atomically, then implement T1 tests before application
code.

# Blockers

None for local implementation. External push and PR creation intentionally wait
for contributor review and explicit authorization.
