---
schema: verchestra-feature-handoff/v1
feature: governed-task-cli
issue: 405
status: verification
branch: feat/405-governed-task-foundations
baseRevision: 4ff9bed6e5e19ba38e11d45d9112667d81a4b254
lastCompletedTask: T5
nextTask: "Independent verification and human review of the E0-E5 foundations; then T6 (E6 TaskRunCoordinator) and T7 (E7 CLI composition) on top of this branch."
lastGate: "gate:quick PASS; gate:build PASS; gate:security PASS; test:e2e 195/195; test:qualification 270/270; agent:check PASS"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Foundations slice (E0–E5) of #405: Task Request v1 contract, durable execution
checkpoints, Node context/tool/worktree adapters, the mediated MCP tool bridge
with the Claude Code `mediated-mcp` profile, and the Driver to
ExecutionDriverPort adapter. No CLI command is added here, and #405 stays open.

# Completed Evidence

T0: spec, design, threat model, tasks, validation, and AD-0XX (to be numbered
at merge) in `.specs/STATE.md`.

T1: Task Request v1 schema, generated type, and `normalizeTaskRequest`
(`packages/application/src/execution/task-request.ts`) with schema/normalizer
parity tests and untrusted-input security tests.

T2: migration `012_execution_checkpoints` and `RuntimeCheckpointStore`
(`packages/platform-node/src/checkpoint-store-adapter.ts`) serving the executor,
gate/commit, and repair-loop checkpoint ports; runtime public errors
`VES_RUNTIME_CHECKPOINT_CONFLICT` and `VES_RUNTIME_CHECKPOINT_CORRUPT`.

T3: `NodeGitContextSource` (committed blobs only, bounded, fail closed),
`NodeWorktreeToolAdapter` (realpath confinement, link refusal, idempotency by
`requestId` in operation receipts, command denied), the application
`ExecutionPayloadPort`, and opt-in task-branch anchoring in
`NodeGitWorktreeAdapter` cleanup.

T4: the mediated MCP tool bridge (`packages/agent-runtime/src/execution/`),
the `mediated-mcp` Claude Code profile, and the requalification report
`docs/qualification/claude-code-driver-mediated.md`.

T5: `DriverExecutionAdapter`
(`packages/agent-runtime/src/execution/driver-execution-adapter.ts`) and the
foundations journey `tests/e2e/mediated-task-execution-e2e.test.mjs`. Every
requirement is mapped in `validation.md`.

# Next Action for the Composition Slice (E6/E7)

Wire, in `apps/vestra-cli/src/task/`: `RuntimeCheckpointStore` (executor, gate,
repair views), `NodeGitWorktreeAdapter({ anchorTaskCommits: true })`,
`NodeWorktreeToolAdapter` (effect repository, shared
`InMemoryExecutionPayloadStore`, workspace ID), `DriverExecutionAdapter`
(bridge command = bundled relay entry, `createSession` building
`ClaudeCodeDriver({ profile: { kind: "mediated-mcp" } })` with the brokered
`ANTHROPIC_API_KEY`), `NodeGitContextSource`, and `normalizeTaskRequest`.
Still to build there: the authority port (`RuntimeAuthorityStore` + Cedar), the
coordination port, the context compiler binding, the gate allowlist, the Codex
verifier with `CodexProcessContext` (#409), cross-process cancel, and a sealed
bundle entry for `mcp-tool-bridge-main.ts`.

# Files Intentionally Left Unchanged

Existing qualification reports (including `docs/qualification/claude-code-driver.md`),
the existing Claude Code profile, CLI commands, release manifest, schemas other
than the new `task-request`, and dependency versions.
