# Governed Task CLI Foundations Validation (#405)

Base revision: `f31264c9623c6588fe0732d7890484ab2f6386cc`.
Branches: `feat/405-governed-task-foundations` (GTC-01..23) and, stacked on it
with PR #409 and #379, `feat/405-governed-task-cli` (GTC-24..41).
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
| GTC-07 | `tests/integration/runtime-checkpoint-store.test.mjs:44-48` (table columns, twelfth migration); `tests/integration/runtime-store.test.mjs:46-50` (registry pinned to 12, ending at `012_execution_checkpoints`), `:293` (public-error catalog 19 codes); `tests/build/sealed-launcher-closure.test.mjs:247-248` (sealed health report observes 12 migrations ending at 012). |
| GTC-08 | `tests/integration/runtime-checkpoint-store.test.mjs:88` (identical replay returns the original reference), `:98` (conflict and gap fail with `VES_RUNTIME_CHECKPOINT_CONFLICT`), `:109` (unencodable, extra-field, bad-stage, zero-sequence, oversized records refused), `:120` (unawaited saves keep order), `:174` (real executor resumes the sequence). |
| GTC-09 | `tests/integration/runtime-checkpoint-store.test.mjs:73` (latest record, reference, frozen data, per-task isolation), `:128` (edited bytes, re-digested foreign identity, non-JSON → `VES_RUNTIME_CHECKPOINT_CORRUPT`), `:158` (survives reopen). |
| GTC-10 | `tests/integration/runtime-checkpoint-store.test.mjs:201` (gates-passed resumes the real gate coordinator), `:226` (committed reported by inspection, refused by the coordinator), `:234` (gate-failed leaves nothing resumable), `:250` (idempotent and undeclared records refused), `:265` (tampered gate record), `:281` (repair loop state persists and invalid state is refused). |
| GTC-11 | `tests/integration/git-context-source.test.mjs:60` (committed blobs at the exact revision, working-tree edits excluded, untrusted deterministic fragments), `:80` (links, binaries, out-of-scope excluded), `:98` (explicit paths, missing path), `:110` (every bound fails closed), `:122` (inexact revision, scope, selector, kind). |
| GTC-12 | `tests/security/worktree-tool-security.test.mjs:23-29` (parent traversal and a `.` segment), `:31` (link parent), `:41` (link final component, write and delete), `:62-68` (`.git` and protected roots), `:70` (command denied), `:124` (several targets, unknown fields), `:132` (directory target), `:138` (unregistered handle); the absolute, drive, backslash and nested traversal forms, nested and case-variant `.git`, and case aliases of a protected root are rows of the task-path rule, `tests/unit/task-path.test.mjs:24-65`, `:126-146`, `:153-165`; `tests/integration/worktree-tool-adapter.test.mjs:13` (parents created inside the worktree only), `:25` (mode preserved), `:32` (delete). |
| GTC-13 | `tests/integration/worktree-tool-adapter.test.mjs:50` (duplicate returns the original receipt, no second effect), `:78` (crash after write converges without the payload), `:99` (crash before write re-applies as attempt 2, nothing dispatchable), `:120` (definite denial is durable); `tests/security/worktree-tool-security.test.mjs:89` (reused ID with different payload or target → `VES_TOOL_REQUEST_CONFLICT`, no effect), `:102` (binding holds even with a permissive receipt store). |
| GTC-14 | `tests/security/worktree-tool-security.test.mjs:75` (swapped bytes never written), `:83` (payload reference must match operation). |
| GTC-15 | `tests/integration/task-branch-anchoring.test.mjs:39` (branch anchored on the verified commit, worktree removed, idempotent), `:50` (existing branch elsewhere keeps worktree and branch), `:59` (unverified commit never anchored), `:68` (no commit, no branch), `:75` (default behavior unchanged), `:83` (invalid run/task IDs refused before any worktree). |
| GTC-16 | `tests/integration/mcp-tool-bridge.test.mjs:12` (initialize, tools/list, ping), `:107` (unknown method, unknown tool, extra arguments, parse error); `tests/security/mcp-tool-bridge-security.test.mjs:119` (oversized frame refused). |
| GTC-17 | `tests/security/mcp-tool-bridge-security.test.mjs:23` (`0700` directory, `0600` socket, removed on close), `:35` (wrong token refused, nothing served), `:46` (no channel → not configured), `:52` (call before authentication), `:65` (single authenticated connection). |
| GTC-18 | `tests/integration/mcp-tool-bridge.test.mjs:30` (scoped read, bounded partial read, listing and search limited to scope); `tests/security/mcp-tool-bridge-security.test.mjs:81-101` (six refused reads: traversal, `.git`, out of scope, protected, links), `:103` (listing and search never cross links or scope); the absolute and nested traversal forms and the case aliases are rows of the task-path rule, `tests/unit/task-path.test.mjs:24-65`, `:126-146`, `:153-165`. |
| GTC-19 | `tests/integration/mcp-tool-bridge.test.mjs:55` (write and delete become executor requests with `payload:sha256:<digest>` and `payload:none`), `:88` (denial returned as a tool error; approval failure is fatal); `tests/security/mcp-tool-bridge-security.test.mjs:131` (oversized content refused). |
| GTC-20 | `tests/contract/claude-code-driver-mediated.test.mjs:12` (allowlist equals bridge tools), `:18` (T03 invocation unchanged), `:45` (exact mediated invocation), `:82` (T03 refuses mediation); `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs:57` (flags, no bypass, `0600` config naming one server), `:77` (worktree cwd, isolated and removed identity directories, exact environment, ambient credential ignored), `:130`/`:138` (tool surface and bridge connection enforced), `:145` (credential redacted), `:153-170` (credential, environment, mediation refused before spawn), `:172` (construction checks), `:189` (minimum build). |
| GTC-21 | `spikes/claude-code-driver/test/claude-driver-mediated.test.mjs:35` (fake `claude` completes the MCP handshake and tool calls through the production bridge), `:119` (denied reads), `:202` (cancellation cleans up), `:239` (every mediated flag exists in the installed build's `--help`); report `docs/qualification/claude-code-driver-mediated.md`. |
| GTC-22 | `tests/integration/driver-execution-adapter.test.mjs:83` (usage metered on the resolved model; portable start/finish checkpoints), `:119` (bridge writes reach `invokeTool`), `:161` (executor cancel), `:176` (caller abort), `:198` (unmeterable usage stops the run); `tests/e2e/mediated-task-execution-e2e.test.mjs:133` (real executor + mediated driver + bridge + tool adapter + durable checkpoints reach `AWAITING_GATE`), `:147` (out-of-scope write denied while in-scope work proceeds). |
| GTC-23 | `tests/integration/driver-execution-adapter.test.mjs:133` (error event → failed with stable code, no path leak), `:148` (tool outside the bridge → `VES_DRIVER_TOOL_OUTSIDE_BRIDGE`, session cancelled), `:184` (fatal denial ends the run); `tests/e2e/mediated-task-execution-e2e.test.mjs:156` (outside-bridge tool fails the real run closed and removes the worktree). |

## Composition slice requirements (E6–E9)

Deterministic fakes are labeled in their files: `tests/helpers/task-cli-fakes/`
(`fake-claude-task.mjs`, `fake-codex-task.mjs`, run through the private
`claude` and `codex` wrappers that `tests/helpers/task-cli-fixture.mjs`
generates per fixture; through `fixture-channel.mjs` they read and write only
inside their private temp directory and record only whether each child
received its brokered credential, never a digest of it) and the fake keychain preload `tests/helpers/fake-keychain-spawn.mjs`, which installs
the deny guard first. The child-process journeys run on macOS; off macOS the
suite asserts the honest `not configured` refusal instead
(`tests/e2e/task-cli-e2e.test.mjs:159`).

| Requirement | Evidence |
| --- | --- |
| GTC-24 | `tests/unit/task-run-coordinator.test.mjs:126` (authorized run reaches `HUMAN_REVIEW` through START_IMPLEMENTATION and START_VERIFICATION only), `:237` (a failed verification never reaches review); `tests/e2e/task-cli-e2e.test.mjs:168` (the real binary stops at `HUMAN_REVIEW`; only `review` completes, `:283`). |
| GTC-25 | `tests/unit/task-run-coordinator.test.mjs:137` (resumable awaiting-gate skips the implementer), `:146` (committed task skips the gates), `:153` (verifying run resumes verification only); `tests/e2e/task-cli-e2e.test.mjs:550` (killed mid-gate, resumed with one implementer session and one tool receipt, `:593`/`:599`). |
| GTC-26 | `tests/unit/task-run-coordinator.test.mjs:159` (stale binding back to approval), `:167` (gate failure → FAILED, released), `:176` (repair with feedback converges), `:187` (escalation left for a human), `:197` (budget outcome), `:212` (cancel → ABORTED by the human), `:226` (executor code preserved), `:245` (non-startable states refused before any port). |
| GTC-27 | `tests/contract/cli-surface.test.mjs:71` (manifest lists the seven task commands after the existing slice), `:121` (named options only, `--keychain` on each, outcome enum, mutating flags); `tests/e2e/cli-launchers-e2e.test.mjs:45` (exact help for both launchers, with empty stderr, so the dynamic import keeps SQLite lazy). |
| GTC-28 | `tests/e2e/task-cli-e2e.test.mjs:168` (plan prints the surface and binding digest, run awaits approval); `tests/build/sealed-launcher-closure.test.mjs:471` (`--dry-run` from the sealed layout writes no task state and opens no runtime store). |
| GTC-29 | `tests/e2e/task-cli-e2e.test.mjs:191` (wrong digest → `VES_TASK_BINDING_MISMATCH`), `:195`/`:213` (no confirmation or a mistyped one → `VES_TASK_CONFIRMATION_REQUIRED`, state unchanged); `tests/unit/task-cli-composition.test.mjs:142` (terminal prompt, `--confirm-stdin`, exact match only). |
| GTC-30 | `tests/e2e/task-cli-e2e.test.mjs:337` (missing `anthropic-api-key` → `VES_TASK_NOT_CONFIGURED` naming it, state still `EXECUTION_AUTHORIZED`, no grant, no worktree, no provider call, `:347`), `:549` (a second writer refused while the lease is held, state unchanged). |
| GTC-31 | `tests/unit/task-cli-composition.test.mjs:38` (built-in permits need approval; writes need the grant), `:49` (Workspace forbid narrows and changes the digest), `:64` (a Workspace permit is refused as non-monotonic); `tests/e2e/task-cli-e2e.test.mjs:313` (a Workspace forbid denies the start: `FAILED` with `VES_EXECUTOR_APPROVAL_INVALID`, no worktree, no provider call, `:340`). |
| GTC-32 | `tests/e2e/task-cli-e2e.test.mjs:397-404` (API-key mode: implementer saw only its brokered credential, in an isolated home, without the verifier's key), `:405-411` (verifier read-only, zero tools, its own credential only, `CODEX_HOME` under the Workspace state); the subscription mode's counterpart is `:245-267`, mapped in `.specs/features/subscription-provider-auth/validation.md`; driver conflict: `tests/unit/verification-driver-isolation.test.mjs` (unchanged, `VES_VERIFIER_DRIVER_CONFLICT`). |
| GTC-33 | `tests/unit/task-cli-composition.test.mjs:80` (verdict fields validated, foreign requirement ignored, absolute evidence path uncovers), `:108` (malformed or reversed verdict covers nothing); `tests/e2e/task-cli-e2e.test.mjs:168` (report verdict PASS only after the revert-implementation sensor killed the mutant and the checkout stayed unchanged). |
| GTC-34 | `tests/e2e/task-cli-e2e.test.mjs:168` (branch `vestra/<run>/T1` holds only `src/value.txt`, parent is the source revision, trailers name the run), `:294` (HEAD, status, files, and registered worktrees unchanged). |
| GTC-35 | `tests/e2e/task-cli-e2e.test.mjs:519` (cancel from another process stops the run: `ABORTED`, worktree removed, `:552`; a second cancel of the ended run is refused), `:638` (with no live process, cancel removes the uncommitted worktree, releases the lease so a new run starts, and aborts). |
| GTC-36 | `tests/e2e/task-cli-e2e.test.mjs:258` (stale surface refused), `:279` (unconfirmed review refused), `:283-285` (accepted → `COMPLETED`, capsule sealed, never merges), `:624` (rejected → `ABORTED`, branch kept, checkout untouched, `:630`). |
| GTC-37 | `tests/e2e/task-cli-e2e.test.mjs:289` (status next actions empty once complete), `:604` (tampered and non-JSON plan fail status and start closed, `:617`). |
| GTC-38 | `tests/build/sealed-launcher-closure.test.mjs:471` (relay staged, resolvable from the bundle, runnable by the release runtime; task dry run loads Cedar from `native/cedar-wasm.wasm`), `:245`/`:298` (health report and help list the task commands). |
| GTC-39 | `tests/e2e/task-cli-e2e.test.mjs:168`, `:307`, `:322`, `:357` and `:367`, `:513`, `:528`, `:567`, `:604`, `:624`, `:638` (the journeys). |
| GTC-40 | `tests/security/task-cli-security.test.mjs:77` (traversal), `:108` (planted symlink, nothing written outside, `:113`), `:118` (protected path unchanged in the commit, `:125`), `:122` (injection read as untrusted data, `:126`, cannot widen scope and ends at `VES_DRIVER_TOOL_OUTSIDE_BRIDGE`, `:131`). |
| GTC-41 | `docs/quick-start.md` (install, credentials, allowlist, complete request, plan → approve → start → status → review, merge yourself, limits). |

## Prerequisite requirements from PR #409 (task-delivery-cli)

| Requirement | Evidence |
| --- | --- |
| TDC-01 | `tests/integration/codex-process-context.test.mjs:14` (probe and execution run in the selected directory; controller cwd unchanged). |
| TDC-02 | `tests/integration/codex-process-context.test.mjs:14` with `tests/helpers/codex-context-observer.mjs` (exact identity directories, no inherited synthetic identity), `:132` (each identity directory required). |
| TDC-03 | `tests/integration/codex-process-context.test.mjs:73`, `:80`, `:114` (malformed context, mutation after construction, relative executable refused). |
| TDC-04 | `tests/contract/codex-driver.test.mjs` and `tests/integration/codex-driver-lifecycle.test.mjs` unchanged and passing. |

The TDC-01 test compared the controller's `mkdtemp` path with the child's
`process.cwd()`; on macOS the temporary directory is reached through
`/var -> /private/var`, so it failed there on PR #409's own branch (reproduced
at `470aab3`). The fixture root is now resolved once (`eee4bb9`); the exact
assertion and the discrimination control are unchanged.

## Composition gate results (pinned Node 24.14.0, macOS arm64)

| Command | Result |
| --- | --- |
| `pnpm gate:quick` | PASS — unit 2214/2214, agent-readiness 252/252; format, lint, complexity, typecheck clean |
| `pnpm gate:build` | PASS — unit 2214, contract 588, integration 732, e2e 211, architecture 61, build 104, qualification 270; 0 failed, 0 skipped, 0 todo |
| `pnpm gate:security` | PASS — unit 2214, contract 588, e2e 211, architecture 61, qualification 270, security 1246, fault 300; 0 failed, 0 skipped, 0 todo |
| `pnpm gate:release` | PASS — unit 2214, architecture 61, build 104, qualification 270, security 1246, fault 300, release 28; 0 failed, 0 skipped, 0 todo |
| `pnpm test:e2e` | PASS as a stage of gate:build and gate:security — 211/211 (task journeys 11/11) |
| `pnpm agent:check` | PASS |
| `pnpm site:check` | PASS — site unit 50/50, astro check 0 errors, build and built-output checks |
| `pnpm site:test` | Not runnable on this machine: its Playwright stage needs a browser that is not installed (the `site:check` part passed) |

## Foundations gate results (pinned Node 24.14.0, macOS arm64)

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
