# Governed Task CLI Tasks (#405)

Task IDs `T0`–`T5` are the foundations slice (E0–E5) on
`feat/405-governed-task-foundations`. `T6`–`T9` (E6–E9) are the composition
slice built on top of this branch by a separate change.

## Execution Plan

| Task | Step | Deliverable | Requirements | Depends on | Verification |
| --- | --- | --- | --- | --- | --- |
| T0 | E0 | Spec, design, threat model, tasks, handoff, validation; AD-034 | — | None | `pnpm agent:check` |
| T1 | E1 | `schemas/task-request/1.schema.json`, generated type, `normalizeTaskRequest` | GTC-01..06 | T0 | `pnpm test:contract`, unit tests |
| T2 | E2 | Migration `012_execution_checkpoints`, `RuntimeCheckpointStore` | GTC-07..10 | T0 | integration + fault tests, build closure test |
| T3 | E3 | `NodeGitContextSource`, `NodeWorktreeToolAdapter`, task-branch anchoring | GTC-11..15 | T2 | integration + security tests |
| T4 | E4 | MCP tool bridge, `mediated-mcp` Claude Code profile, requalification report | GTC-16..21 | T3 | integration + security tests, `pnpm qualify:claude` |
| T5 | E5 | `DriverExecutionAdapter` | GTC-22..23 | T4 | integration + e2e tests |
| T6 | E6 | `TaskRunCoordinator` (approval → execute → gates → Codex verify → review) | — | T5 | later slice |
| T7 | E7 | `apps/vestra-cli/src/task/` composition and commands | — | T6 | later slice |
| T8 | E8 | Child-process CLI e2e and security suites | — | T7 | later slice |
| T9 | E9 | Quick-start, README, site, acceptance matrix | — | T8 | later slice |

## Gate Commands

| Level | Command |
| --- | --- |
| Quick | `pnpm gate:quick` |
| Build | `pnpm gate:build` |
| Security | `pnpm gate:security` |
| Journeys | `pnpm test:e2e` |
| Driver requalification | `pnpm qualify:claude` |
| Readiness | `pnpm agent:check` |

## Completion Rules

- One commit per task; no Co-Authored-By trailer.
- No new dependency; generated contracts only through the generator.
- Deterministic fake drivers and fake `claude` executables are labeled as
  fixtures in their file names and test names.

## Execution Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T0 | Done | This directory; AD-034 in `.specs/STATE.md` |
| T1 | Done | `schemas/task-request/1.schema.json`, generated `TaskRequest`, `normalizeTaskRequest`; 42 contract + 6 security tests |
| T2 | Pending | |
| T3 | Pending | |
| T4 | Pending | |
| T5 | Pending | |
