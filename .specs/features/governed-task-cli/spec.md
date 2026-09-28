# Governed Task CLI Foundations Specification (#405)

## Problem Statement

The installed CLI exposes `init`, `self-test`, and `doctor` only. The
`TaskExecutionCoordinator` and `TaskGateCommitCoordinator` are exercised with
supplied deterministic ports, so no user can submit a bounded delivery task.
Before a `vestra task` command can be composed, the product is missing:

- a portable, untrusted-input contract for what a user asks for;
- durable storage for the executor and gate/commit checkpoints the
  coordinators already emit;
- Node adapters that read repository context at a revision, write inside an
  isolated worktree only through the executor's tool port, and keep the task
  commit reachable after the worktree is removed;
- a way for a real implementer, Claude Code, to change files without its
  built-in tools, so every write passes through the executor's scope,
  protected-path, capability, and tool-effect authority checks;
- an adapter from the `Driver` protocol to the executor's `ExecutionDriverPort`.

This slice delivers those foundations (E0–E5). The CLI commands and the
end-to-end composition (E6–E9) are a separate slice built on this branch.

## Owner Decisions (binding)

- The implementer is Claude Code, reached through a mediated MCP tool bridge.
  This requalifies the T03 Claude Code driver profile.
- The independent verifier is Codex (composed in E6 with the
  `CodexProcessContext` introduced by PR #409).
- Credentials come from the OS Keychain through the Secret Broker (#379). This
  slice depends only on an injected credential provider: the driver receives
  the credential from `resolveExecution` and never reads ambient state.

## Out of Scope

| Exclusion | Reason |
| --- | --- |
| `vestra task` commands, release-manifest entries, composition root | E6–E9 on top of this branch. |
| Live provider calls | Requires separately authorized #406 pilot; fixtures are labeled deterministic fakes. |
| OS keychain backend | #379. |
| Platforms other than macOS for the mediated profile qualification | One supported platform first; others report not configured. |
| Shell or command execution by the implementer | Denied by design: `command` tool requests fail closed. |

## Requirements (EARS)

### E1 — Task Request v1 contract

- **GTC-01** — WHEN a Task Request is normalized THEN the system SHALL accept
  only `schemaVersion: 1` with exactly the fields `schemaVersion`,
  `sourceRevision`, `task`, `gates`, `budgets`, `driver`, `verifier`,
  `instructions` and optional `onGateFailure`, and SHALL return a deep-frozen
  copy; any unknown, missing, or mistyped field SHALL be rejected with a
  stable `VES_TASK_REQUEST_*` code.
- **GTC-02** — WHEN the request carries a `task` THEN the system SHALL validate
  it with the existing `normalizeTask` rules (requirement-ID pattern, logical
  paths, bounded text) and SHALL require `sourceRevision` to be a complete Git
  object ID.
- **GTC-03** — WHEN the request declares `gates` THEN each gate SHALL name a
  `commandRef` token and `args` only (never an executable path), SHALL reject
  absolute or parent-traversing arguments, and the gate set SHALL exactly
  cover `task.verificationCommands` and every task requirement, reusing the
  gate plan normalizer.
- **GTC-04** — WHEN budgets or models are declared THEN each ceiling SHALL be a
  positive finite value within a published upper bound, `driver.driverId`
  SHALL be `claude-code`, `verifier.driverId` SHALL be `codex`, and each model
  SHALL have a priced entry for its provider in `modelPriceTable`.
- **GTC-05** — WHEN `instructions` are supplied THEN they SHALL be non-empty,
  at most 8192 characters and 16384 UTF-8 bytes, and free of control
  characters (other than tab and newline) and bidirectional overrides.
- **GTC-06** — The contract SHALL be canonical in
  `schemas/task-request/1.schema.json`, its TypeScript type SHALL be produced
  only by `scripts/generate-contract-types.mjs`, and the schema and
  `normalizeTaskRequest` SHALL agree on every valid and rejected example.

### E2 — Durable execution checkpoints

- **GTC-07** — WHEN the runtime store opens THEN migration
  `012_execution_checkpoints` SHALL create the `execution_checkpoints` table,
  and the registered migration count SHALL be exactly 12.
- **GTC-08** — WHEN the executor saves a checkpoint THEN the store SHALL accept
  only the next contiguous sequence for that workspace/run/task, SHALL return
  the same `checkpointRef` for an identical replay, and SHALL reject a
  conflicting record at an existing sequence or a sequence gap with
  `VES_RUNTIME_CHECKPOINT_CONFLICT`.
- **GTC-09** — WHEN a checkpoint is loaded THEN the store SHALL return the
  latest record only after verifying its digest, exact shape, and identity;
  a tampered, malformed, or foreign record SHALL fail closed with
  `VES_RUNTIME_CHECKPOINT_CORRUPT`.
- **GTC-10** — WHEN the gate/commit coordinator saves or loads THEN the store
  SHALL accept only the declared gate stages, SHALL be idempotent for an
  identical latest record, SHALL return no resumable checkpoint after a
  `gate-failed` stage, and SHALL persist gate-repair loop state through a
  bound `loadState`/`saveState` view with the same validation.

### E3 — Node platform adapters

- **GTC-11** — WHEN repository context is read THEN `NodeGitContextSource`
  SHALL read only committed blobs at an exact revision through
  `git ls-tree`/`git cat-file`, SHALL skip symlinks and submodules, SHALL
  enforce file, file-count, entry, and total-byte bounds, and SHALL fail closed
  when a bound is exceeded or the scope escapes.
- **GTC-12** — WHEN a write or delete reaches `NodeWorktreeToolAdapter` THEN it
  SHALL act only on a path whose every existing component is a real directory
  or regular file strictly inside the registered worktree, SHALL refuse
  symlinks, `.git`, and escapes before any effect, and SHALL deny `command`.
- **GTC-13** — WHEN the same `requestId` is delivered twice THEN the adapter
  SHALL return the original receipt without a second effect; a different
  request under the same `requestId` SHALL fail with
  `VES_TOOL_REQUEST_CONFLICT` and no effect. Receipts SHALL live in the runtime
  store's operation receipts.
- **GTC-14** — WHEN a write carries content THEN the content SHALL be resolved
  from a `payload:sha256:<hex>` reference and rejected unless its digest and
  size bound match.
- **GTC-15** — WHERE task-branch anchoring is enabled, WHEN a worktree is
  cleaned up after its verified task commit THEN the adapter SHALL create
  `refs/heads/vestra/<runId>/<taskId>` at that commit before
  `git worktree remove`, SHALL keep the worktree when the branch already points
  elsewhere or the commit is not a verified task commit, and SHALL leave the
  default (non-anchoring) behavior unchanged.

### E4 — Mediated MCP tool bridge and Claude Code profile

- **GTC-16** — The bridge SHALL speak MCP over stdio as JSON-RPC 2.0 with
  `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`,
  SHALL reject unknown methods and oversized or malformed frames, and SHALL add
  no dependency.
- **GTC-17** — WHEN the bridge connects to the controller THEN it SHALL do so
  over a Unix socket in a per-run `0700` directory and present a per-run
  random token; the controller SHALL serve no tool before a constant-time token
  match and SHALL accept exactly one authenticated connection.
- **GTC-18** — WHEN `read_file`, `list_dir`, or `search` is called THEN the
  controller SHALL serve only paths inside the worktree and inside the
  approved read scope, SHALL refuse symlinks, `.git`, and protected paths, and
  SHALL bound bytes, entries, and results.
- **GTC-19** — WHEN `write_file` or `delete_file` is called THEN the controller
  SHALL store content by digest and issue `control.invokeTool` with a
  `payloadRef`; it SHALL never write the worktree itself, and an executor
  denial SHALL be returned to the model as a tool error with its stable code.
- **GTC-20** — WHEN the `mediated-mcp` profile starts Claude Code THEN the
  driver SHALL pass `--mcp-config` naming only the bridge, `--strict-mcp-config`,
  `--tools ""`, `--allowedTools` limited to the five `mcp__verchestra__*`
  tools, `--permission-mode dontAsk`, and no bypass flag; SHALL run in the
  worktree with per-run isolated `HOME` and `CLAUDE_CONFIG_DIR`; SHALL pass
  only explicitly declared environment plus `ANTHROPIC_API_KEY` from
  `resolveExecution`, which SHALL also be a sensitive value; and SHALL leave
  the existing profile unchanged for existing callers.
- **GTC-21** — The requalification SHALL run the production driver and bridge
  against a labeled fake `claude` executable that performs the MCP handshake
  and tool calls, and SHALL be recorded in a new report
  `docs/qualification/claude-code-driver-mediated.md`.

### E5 — Driver to ExecutionDriverPort adapter

- **GTC-22** — WHEN the executor runs the driver adapter THEN driver usage
  events SHALL reach `control.reportUsage` with the resolved model, driver
  start and finish SHALL be checkpointed with portable data only, and the
  executor's `cancel` or abort signal SHALL cancel the driver session.
- **GTC-23** — WHEN the driver requests a tool that is not one of the bridge
  tools, or reports an error, THEN the adapter SHALL cancel the session and
  fail closed with `VES_DRIVER_TOOL_OUTSIDE_BRIDGE` or a failed status.

## Success Criteria

- Every requirement maps to file-and-assertion evidence in `validation.md`.
- `pnpm gate:quick`, `pnpm gate:build`, `pnpm gate:security`,
  `pnpm test:e2e`, `pnpm qualify:claude`, and `pnpm agent:check` pass with zero
  skips, and no existing assertion is weakened.
