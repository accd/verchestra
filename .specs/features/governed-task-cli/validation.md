# Governed Task CLI Foundations Validation (#405)

Base revision: `4ff9bed6e5e19ba38e11d45d9112667d81a4b254`.
Branch: `feat/405-governed-task-foundations`.
This is implementation evidence, not independent qualification or issue closure.
Deterministic fakes are labeled in their files: `ScriptedFakeDriver`
(`tests/integration/driver-execution-adapter.test.mjs`) and the fake `claude`
executable (`spikes/claude-code-driver/test/fake-claude-mediated.mjs`).

## Requirements and assertions

| Requirement | Evidence |
| --- | --- |
| GTC-01 | `tests/contract/task-request.test.mjs:31` (frozen normalized copy), `:42` (optional repair policy), `:98-110` shape rejections for unknown fields, schema version, and missing fields; `tests/security/task-request-security.test.mjs:18` (identity, digests, approvals, and credentials refused), `:51` (non-objects). |
| GTC-02 | `tests/contract/task-request.test.mjs:98` cases for invalid requirement IDs, traversing or absolute scope, and unknown task fields (`VES_TASK_REQUEST_TASK_INVALID`) and an abbreviated revision (`VES_TASK_REQUEST_INVALID`). |
| GTC-03 | `tests/contract/task-request.test.mjs:98` cases for an executable path on a gate and absolute, traversing, embedded-absolute, and drive-letter arguments; `:143` cross-field cases for uncovered commands and requirements, foreign requirements, duplicate gate IDs, and a missing test baseline; `tests/security/task-request-security.test.mjs:57`. |
| GTC-04 | `tests/contract/task-request.test.mjs:98` cases for budget bounds, a Codex implementer, a Claude verifier, and a verifier model on the implementer; `:143` cases for unpriced implementer and verifier models. |
| GTC-05 | `tests/contract/task-request.test.mjs:98` cases for empty text, NUL, bidirectional override, and >8192 characters; `:143` case for >16384 UTF-8 bytes; `tests/security/task-request-security.test.mjs:33` (injection text never widens scope). |
| GTC-06 | `tests/contract/task-request.test.mjs:26` (registered and valid), `:98-110` (schema and normalizer agree on every shape rejection), `:143-148` (schema admits, normalizer refuses cross-field rules); `tests/contract/schema-registry.test.mjs:42` (registry list includes `task-request@1`), `:120` (generated contracts have zero drift). |
| GTC-07 | `tests/integration/runtime-checkpoint-store.test.mjs:44-48` (table columns, twelfth migration); `tests/integration/runtime-store.test.mjs:47-51` (registry pinned to 12, ending at `012_execution_checkpoints`), `:378` (public-error catalog 19 codes); `tests/build/sealed-launcher-closure.test.mjs:247-248` (sealed health report observes 12 migrations ending at 012). |
| GTC-08 | `tests/integration/runtime-checkpoint-store.test.mjs:88` (identical replay returns the original reference), `:98` (conflict and gap fail with `VES_RUNTIME_CHECKPOINT_CONFLICT`), `:109` (unencodable, extra-field, bad-stage, zero-sequence, oversized records refused), `:120` (unawaited saves keep order), `:174` (real executor resumes the sequence). |
| GTC-09 | `tests/integration/runtime-checkpoint-store.test.mjs:73` (latest record, reference, frozen data, per-task isolation), `:128` (edited bytes, re-digested foreign identity, non-JSON → `VES_RUNTIME_CHECKPOINT_CORRUPT`), `:158` (survives reopen). |
| GTC-10 | `tests/integration/runtime-checkpoint-store.test.mjs:201` (gates-passed resumes the real gate coordinator), `:226` (committed reported by inspection, refused by the coordinator), `:234` (gate-failed leaves nothing resumable), `:250` (idempotent and undeclared records refused), `:265` (tampered gate record), `:281` (repair loop state persists and invalid state is refused). |
| GTC-11 | `tests/integration/git-context-source.test.mjs:60` (committed blobs at the exact revision, working-tree edits excluded, untrusted deterministic fragments), `:80` (links, binaries, out-of-scope excluded), `:98` (explicit paths, missing path), `:110` (every bound fails closed), `:122` (inexact revision, scope, selector, kind). |
| GTC-12 | `tests/security/worktree-tool-security.test.mjs:23-36` (six traversal forms), `:38` (link parent), `:48` (link final component, write and delete), `:69-81` (`.git`, case aliases, protected roots), `:83` (command denied), `:137` (several targets, unknown fields), `:145` (directory target), `:151` (unregistered handle); `tests/integration/worktree-tool-adapter.test.mjs:13` (parents created inside the worktree only), `:25` (mode preserved), `:32` (delete). |
| GTC-13 | `tests/integration/worktree-tool-adapter.test.mjs:47` (duplicate returns the original receipt, no second effect), `:75` (crash after write converges without the payload), `:96` (crash before write re-applies as attempt 2, nothing dispatchable), `:117` (definite denial is durable); `tests/security/worktree-tool-security.test.mjs:102` (reused ID with different payload or target → `VES_TOOL_REQUEST_CONFLICT`, no effect), `:115` (binding holds even with a permissive receipt store). |
| GTC-14 | `tests/security/worktree-tool-security.test.mjs:88` (swapped bytes never written), `:96` (payload reference must match operation). |
| GTC-15 | `tests/integration/task-branch-anchoring.test.mjs:39` (branch anchored on the verified commit, worktree removed, idempotent), `:50` (existing branch elsewhere keeps worktree and branch), `:59` (unverified commit never anchored), `:68` (no commit, no branch), `:75` (default behavior unchanged), `:83` (invalid run/task IDs refused before any worktree). |
| GTC-16 | `tests/integration/mcp-tool-bridge.test.mjs:12` (initialize, tools/list, ping), `:107` (unknown method, unknown tool, extra arguments, parse error); `tests/security/mcp-tool-bridge-security.test.mjs:116` (oversized frame refused). |
| GTC-17 | `tests/security/mcp-tool-bridge-security.test.mjs:22` (`0700` directory, `0600` socket, removed on close), `:33` (wrong token refused, nothing served), `:43` (no channel → not configured), `:49` (call before authentication), `:61` (single authenticated connection). |
| GTC-18 | `tests/integration/mcp-tool-bridge.test.mjs:30` (scoped read, bounded partial read, listing and search limited to scope); `tests/security/mcp-tool-bridge-security.test.mjs:76-99` (ten refused reads: traversal, absolute, `.git`, case alias, out of scope, protected, links), `:101` (listing and search never cross links or scope). |
| GTC-19 | `tests/integration/mcp-tool-bridge.test.mjs:55` (write and delete become executor requests with `payload:sha256:<digest>` and `payload:none`), `:88` (denial returned as a tool error; approval failure is fatal); `tests/security/mcp-tool-bridge-security.test.mjs:127` (oversized content refused). |
| GTC-20 | `tests/contract/claude-code-driver-mediated.test.mjs:12` (allowlist equals bridge tools), `:18` (T03 invocation unchanged), `:45` (exact mediated invocation), `:82` (T03 refuses mediation); `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs:121` (flags, no bypass, `0600` config naming one server), `:140` (worktree cwd, isolated and removed identity directories, exact environment, ambient credential ignored), `:186`/`:193` (tool surface and bridge connection enforced), `:199` (credential redacted), `:206-222` (credential, environment, mediation refused before spawn), `:224` (construction checks), `:240` (minimum build). |
| GTC-21 | `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs:100` (fake `claude` completes the MCP handshake and tool calls through the production bridge), `:176` (denied reads), `:252` (cancellation cleans up), `:270` (every mediated flag exists in the installed build's `--help`); report `docs/qualification/claude-code-driver-mediated.md`. |
| GTC-22 | `tests/integration/driver-execution-adapter.test.mjs:83` (usage metered on the resolved model; portable start/finish checkpoints), `:119` (bridge writes reach `invokeTool`), `:161` (executor cancel), `:176` (caller abort), `:198` (unmeterable usage stops the run); `tests/e2e/mediated-task-execution-e2e.test.mjs:133` (real executor + mediated driver + bridge + tool adapter + durable checkpoints reach `AWAITING_GATE`), `:147` (out-of-scope write denied while in-scope work proceeds). |
| GTC-23 | `tests/integration/driver-execution-adapter.test.mjs:133` (error event → failed with stable code, no path leak), `:148` (tool outside the bridge → `VES_DRIVER_TOOL_OUTSIDE_BRIDGE`, session cancelled), `:184` (fatal denial ends the run); `tests/e2e/mediated-task-execution-e2e.test.mjs:156` (outside-bridge tool fails the real run closed and removes the worktree). |

## Gate results (pinned Node 24.14.0, macOS arm64)

| Command | Result |
| --- | --- |
| `pnpm gate:quick` | PASS — unit 2166/2166, agent-readiness 252/252; format, lint, complexity, typecheck clean |
| `pnpm gate:build` | PASS — unit 2166, contract 587, integration 712, e2e 195, architecture 50, build 103, qualification 270; all passed, 0 skipped, 0 todo |
| `pnpm gate:security` | PASS — unit 2166, contract 587, e2e 195, architecture 50, qualification 270, security 1223, fault 300; all passed, 0 skipped, 0 todo |
| `pnpm test:e2e` | PASS as a stage of both gates — 195/195 |
| `pnpm test:qualification` (includes `qualify:claude`) | PASS as a stage of both gates — 270/270 |
| `pnpm agent:check` | PASS |

The gates ran before the permissive-store security test was added. After it,
`pnpm gate:quick`, `pnpm agent:check`, and the four new security suites (55/55)
were re-run and pass.

## Discrimination sensor

Recorded after the gates: each mutation below was applied to a disposable copy
of one source file, the named suite was run, and the file was restored byte for
byte. See the table at the end of this file.

| Mutation (one source file, restored byte for byte) | Suite | Result |
| --- | --- | --- |
| Drop the link check on parent components in `worktree-tool-adapter.ts` | `tests/security/worktree-tool-security.test.mjs` | killed (1 failure) |
| Accept any well-formed token in the bridge controller | `tests/security/mcp-tool-bridge-security.test.mjs` | killed (the wrong-token relay is admitted and never exits; test times out) |
| Count any requested tool as a bridge tool in `driver-execution-adapter.ts` | `tests/integration/driver-execution-adapter.test.mjs` | killed (1 failure) |
| Skip the stored-digest comparison in `RuntimeStore.latestExecutionCheckpoint` | `tests/integration/runtime-checkpoint-store.test.mjs` | killed (1 failure) |
| Stop checking gate arguments in `normalizeTaskRequest` | `tests/contract/task-request.test.mjs` | killed (4 failures) |
| Skip anchoring in `NodeGitWorktreeAdapter.cleanup` | `tests/integration/task-branch-anchoring.test.mjs` | killed (3 failures) |
| Skip the mediated init tool-surface check | `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs` | killed (2 failures) |
| Remove the adapter's own request-content binding | `tests/security/worktree-tool-security.test.mjs` | killed (1 failure) |
| Remove the duplicate-receipt early return | `tests/integration/worktree-tool-adapter.test.mjs` | killed (1 failure) |

9 killed, 0 survived. The content-binding mutation first survived because the
runtime store's own key-conflict check caught the same fault. A permissive-store
test was added (`tests/security/worktree-tool-security.test.mjs`, "binds a
request ID to its content even when the receipt store does not"), so the
adapter's guard is now observed directly. No assertion was weakened.
