---
schema: verchestra-feature-handoff/v1
feature: governed-task-cli
issue: 405
status: in_progress
branch: feat/405-governed-task-foundations
baseRevision: 4ff9bed6e5e19ba38e11d45d9112667d81a4b254
lastCompletedTask: T0
nextTask: "T1 — add the Task Request v1 schema, generated type, and normalizeTaskRequest with contract tests."
lastGate: null
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Foundations slice (E0–E5) of #405: Task Request v1 contract, durable execution
checkpoints, Node context/tool/worktree adapters, the mediated MCP tool bridge
with the Claude Code `mediated-mcp` profile, and the Driver to
ExecutionDriverPort adapter. No CLI command is added here.

# Completed Evidence

T0: spec, design, threat model, tasks, validation, and AD-034.

# Files Intentionally Left Unchanged

Existing qualification reports (including `docs/qualification/claude-code-driver.md`),
the existing Claude Code profile, CLI commands, release manifest, schemas other
than the new `task-request`, and dependency versions.
