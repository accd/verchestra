---
schema: verchestra-feature-handoff/v1
feature: governed-task-cli
issue: 405
status: verification
branch: feat/405-governed-task-cli
baseRevision: d21340801c2b9de73c0f0b82c49d525fb8ff4344
lastCompletedTask: T9
nextTask: "Independent verification and human review of the E0-E9 stack (the foundations and composition PRs; #409 and #379 are on main); then the supervised live pilot (#406) with real Claude Code and Codex."
lastGate: "Restacked on main, Node 24.14.0 macOS arm64: gate:quick PASS; gate:build PASS; gate:security PASS; gate:release PASS; test:e2e 229/229; agent:check PASS; 0 skipped"
updatedAt: 2026-09-30T00:00:00Z
---

# Scope

#405 in two slices on one stack. Foundations (E0–E5, T0–T5): Task Request v1
contract, durable execution checkpoints, Node context/tool/worktree adapters,
the mediated MCP tool bridge with the Claude Code `mediated-mcp` profile, and
the Driver to ExecutionDriverPort adapter. Composition (E6–E9, T6–T9): the
application `TaskRunCoordinator`, the `vestra task` commands and composition
root, the sealed bridge relay, the child-process journeys and security suite,
and the quick-start. #405 stays open until the live pilot (#406).

# Completed Evidence

T0: spec, design, threat model, tasks, validation, and AD-039 in `.specs/STATE.md`.

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

T6: `TaskRunCoordinator` (`packages/application/src/execution/task-run.ts`).

T7: `apps/vestra-cli/src/task/` (see design.md), seven manifest entries,
`createCedarEngine` in `packages/policy`, and `bin/mcp-tool-bridge.mjs` in the
sealed release.

T8: `tests/e2e/task-cli-e2e.test.mjs`, `tests/security/task-cli-security.test.mjs`,
the labeled fakes in `tests/helpers/task-cli-fakes/` (run through per-fixture
wrappers that name the log directory and fake keychain store explicitly), and
the fake keychain preload.

T9: `docs/quick-start.md`, README, the site status line, the acceptance-matrix
note, AD-040 in `.specs/STATE.md`, and this directory. Every requirement is
mapped in validation.md, including #409's TDC-01..04.

# Stack for the coordinator

- Base: `main` at `d213408`, which already carries #409 (Codex process
  context), #379 (os-secret-backend), and every other change this stack once
  cherry-picked.
- Foundations: the eight commits of `feat/405-governed-task-foundations` (E0–E5,
  the AD-039 numbering, and its SonarCloud-class refactor).
- Composition: every later commit on `feat/405-governed-task-cli` (E6–E9 and
  the AD-040 numbering).

# Historical: what the foundations handed to the composition slice (E6/E7)

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
the existing Claude Code profile, existing CLI commands, schemas other than the
new `task-request`, dependency versions, and #409's own
`.specs/features/task-delivery-cli/` artifacts.

# Known limits (also in docs/quick-start.md)

macOS only; one implementer and one verifier; token and cost ceilings are
checked when usage is reported (the duration timer is the hard guard); local
human authority is not cryptographic identity; a failed verification leaves
the run in `REPAIRING` (no automated repair); the live pilot (#406) is
pending.
