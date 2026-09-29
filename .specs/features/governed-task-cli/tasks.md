# Governed Task CLI Tasks (#405)

Task IDs `T0`–`T5` are the foundations slice (E0–E5) on
`feat/405-governed-task-foundations`. `T6`–`T9` (E6–E9) are the composition
slice on `feat/405-governed-task-cli`, stacked on the foundations, PR #409, and
#379.

## Execution Plan

| Task | Step | Deliverable | Requirements | Depends on | Verification |
| --- | --- | --- | --- | --- | --- |
| T0 | E0 | Spec, design, threat model, tasks, handoff, validation; AD-039 | — | None | `pnpm agent:check` |
| T1 | E1 | `schemas/task-request/1.schema.json`, generated type, `normalizeTaskRequest` | GTC-01..06 | T0 | `pnpm test:contract`, unit tests |
| T2 | E2 | Migration `012_execution_checkpoints`, `RuntimeCheckpointStore` | GTC-07..10 | T0 | integration + fault tests, build closure test |
| T3 | E3 | `NodeGitContextSource`, `NodeWorktreeToolAdapter`, task-branch anchoring | GTC-11..15 | T2 | integration + security tests |
| T4 | E4 | MCP tool bridge, `mediated-mcp` Claude Code profile, requalification report | GTC-16..21 | T3 | integration + security tests, `pnpm qualify:claude` |
| T5 | E5 | `DriverExecutionAdapter` | GTC-22..23 | T4 | integration + e2e tests |
| T6 | E6 | `TaskRunCoordinator` (execute → gates → Codex verify → human review) | GTC-24..26 | T5 | unit tests |
| T7 | E7 | `apps/vestra-cli/src/task/` composition, commands, sealed relay | GTC-27..38 | T6 | contract, unit, build tests |
| T8 | E8 | Child-process CLI e2e and security suites | GTC-39..40 | T7 | `pnpm test:e2e`, `pnpm test:security` |
| T9 | E9 | Quick-start, README, site status line, acceptance matrix, handoff | GTC-41 | T8 | `pnpm agent:check`, `pnpm site:check` |

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
| T0 | Done | This directory; AD-039 in `.specs/STATE.md` |
| T1 | Done | `schemas/task-request/1.schema.json`, generated `TaskRequest`, `normalizeTaskRequest`; 42 contract + 6 security tests |
| T2 | Done | Migration `012_execution_checkpoints`, `RuntimeStore.appendExecutionCheckpoint`/`latestExecutionCheckpoint`, `RuntimeCheckpointStore`; 15 integration tests; migration and public-error pins extended |
| T3 | Done | `NodeGitContextSource`, `NodeWorktreeToolAdapter`, `ExecutionPayloadPort`, `NodeGitWorktreeAdapter.resolvePath` and opt-in `anchorTaskCommits`; 19 integration + 20 security tests |
| T4 | Done | `McpToolBridgeController`, relay `runMcpToolBridgeRelay` + entry, `InMemoryExecutionPayloadStore`, `ClaudeCodeDriver` `mediated-mcp` profile, `docs/qualification/claude-code-driver-mediated.md`; 5 integration + 18 security + 4 contract + 16 spike tests |
| T5 | Done | `DriverExecutionAdapter`; 9 integration tests with a labeled scripted fake driver and 3 e2e journeys with the fake `claude` executable |
| T6 | Done | `packages/application/src/execution/task-run.ts`; 13 unit tests over the real workflow machine |
| T7 | Done | `apps/vestra-cli/src/task/`, manifest entries, `createCedarEngine` (policy), `bin/mcp-tool-bridge.mjs` sealed entry; 6 composition unit tests, 1 new contract test, 1 new sealed-layout build test |
| T8 | Done | `tests/e2e/task-cli-e2e.test.mjs` (11 tests), `tests/security/task-cli-security.test.mjs` (4 tests), fake `claude`/`codex`, fake keychain preload |
| T9 | Done | `docs/quick-start.md`, README section and status line, site status line, acceptance-matrix note, this directory |
