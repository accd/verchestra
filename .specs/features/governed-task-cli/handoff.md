---
schema: verchestra-feature-handoff/v1
feature: governed-task-cli
issue: 405
status: in_progress
branch: feat/405-governed-task-foundations
baseRevision: 4ff9bed6e5e19ba38e11d45d9112667d81a4b254
lastCompletedTask: T4
nextTask: "T5 — add DriverExecutionAdapter (Driver to ExecutionDriverPort) with usage, checkpoint, cancel, and outside-bridge violation mapping."
lastGate: "qualify:claude 30/30, bridge and driver focused suites 74/74, agent-readiness 252/252 PASS"
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Foundations slice (E0–E5) of #405: Task Request v1 contract, durable execution
checkpoints, Node context/tool/worktree adapters, the mediated MCP tool bridge
with the Claude Code `mediated-mcp` profile, and the Driver to
ExecutionDriverPort adapter. No CLI command is added here.

# Completed Evidence

T0: spec, design, threat model, tasks, validation, and AD-034.

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

# Files Intentionally Left Unchanged

Existing qualification reports (including `docs/qualification/claude-code-driver.md`),
the existing Claude Code profile, CLI commands, release manifest, schemas other
than the new `task-request`, and dependency versions.
