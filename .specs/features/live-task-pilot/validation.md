# Live task pilot: validation (#406)

Two parts. **Pre-registration** (T0) maps each requirement of this change to
where it is met and how it was checked; it is complete. **Pilot results** (T1–T9)
are empty tables with their columns fixed in advance; they are filled only by
executing the pilot, one row per attempted run, and never edited to remove a row.

## Pre-registration evidence (T0)

| Requirement | Where it is met | How it was checked |
| --- | --- | --- |
| PLT-01 target | `spec.md:41` (§1) | `git ls-remote https://github.com/words/levenshtein-edit-distance.git` lists `1fffec16713ca76c85dcda696abca9d011f9c51b` as `refs/heads/main` and `refs/tags/3.0.1`; `gh api repos/words/levenshtein-edit-distance` reports `license: MIT`, `archived: false`, public; baseline in a clean clone with Node 24.14.0 and only `PATH`, `HOME`, `CI=1`: `tests 4, pass 4, fail 0, cancelled 0, skipped 0, todo 0` three times, 0.47–0.89 s |
| PLT-02 candidate | `spec.md:87` (§2) | `npm view verchestra versions` lists `0.0.0-qualification` and `0.0.0-qualification.2` only; `npm view vestra` reports the name unpublished, hence the pinned-package invocation rule |
| PLT-03 identity | `spec.md:107` (§3) | Claude driver minimum `packages/drivers/src/claude-code-driver.ts:87` (`2.1.282`); Codex driver minimum `packages/drivers/src/codex-driver.ts:254` (`0.115.0`) with the same-major comparison at `packages/drivers/src/driver-version-probe.ts:43-49`; `codex --version` on the pre-registration machine printed `codex-cli 0.157.1` and `claude --version` printed `2.1.282 (Claude Code)` (version queries only, no model call); both models priced at `packages/application/src/execution/model-price-table.ts:13` and `:16`; credential names at `apps/vestra-cli/src/task-provider-auth.ts:29-32` and `apps/vestra-cli/src/task/task-credentials.ts:18-19` |
| PLT-04 tasks | `spec.md:127` (§4), `requests/P1-bug-fix.json`, `requests/P2-feature.json`, `requests/P3-refactor.json`, `probes/P1-probe.mjs`, `probes/P2-probe.mjs`, `probes/P3-probe.mjs` | Every request accepted by `schemas/task-request/1.schema.json` (through `SchemaRegistry.validate`) and by `normalizeTaskRequest`; each probe fails at the pinned revision and passes against a throwaway reference change; revert checks as stated in `spec.md` §4 ("How the assertions were checked before pinning"); the P1 defect reproduced at the pinned revision (exit 1, usage on stderr for two chunks 200 ms apart); every request uses the registered label `VES-EXE-001` because the requirements register (`scripts/requirements-trace.mjs`, `tests/agent-readiness/requirements-register.test.mjs`) rejects unregistered IDs in tracked files (`spec.md` §4, Requirement label) |
| PLT-05 scenarios | `spec.md:255` (§5), `requests/S1-cancellation.json`, `requests/S2-interrupt-resume.json`, `requests/S3-out-of-scope.json`, `requests/S3b-plan-refusal.json` | S1–S3 accepted by schema and normalizer; S3b refused by the schema and by `normalizeTaskRequest` with `VES_TASK_REQUEST_TASK_INVALID` (`packages/application/src/execution/task-request.ts:276`). Expected codes traced to: cancel poll `apps/vestra-cli/src/task/task-run.ts:63`, signals `:658-659`, resume shortcut `:447`, start/resume states `:709-711`; cancel wait and refusal `apps/vestra-cli/src/task/task-status.ts:21`, `:192`; `ABORTED`/`VES_EXECUTOR_CANCELLED` `packages/application/src/execution/task-run.ts:122`, `:267`; scope and protected checks `packages/application/src/execution/task-executor.ts:418-420`; read scope `packages/agent-runtime/src/execution/mcp-bridge-tools.ts:197`; non-fatal `denied:` result `packages/agent-runtime/src/execution/mcp-tool-bridge.ts:216`; denied count kept only in a checkpoint `packages/agent-runtime/src/execution/driver-execution-adapter.ts:144`; the same journeys with stand-ins in `tests/e2e/task-cli-e2e.test.mjs` |
| PLT-06 limits and success | `spec.md:383` (§6) | Per-request `budgets` in each request file (P1–P3 `maximumTokens` 3,000,000; `maximumCostUsd` is declared and not consumed on a subscription); gate pass rule including `skipped === 0` and `minimumTests` at `apps/vestra-cli/src/task/task-verifier.ts:72`; ceilings pending owner approval (handoff Blocker 2) |
| PLT-07 recording | `spec.md:459` (§7); results tables below | Evidence path is not a `tNN-validation.md` name, so it cannot enter the qualification chain (`scripts/agent-readiness.mjs:134`) |
| PLT-08 reproduction and boundaries | `spec.md:498` (§8), `spec.md:551` (§9) | Steps 2–3 were executed as written in a throwaway clone (baseline reproduced) |
| PLT-09 review checklist | `spec.md:574` (§10); review table below | — |
| PLT-10 allowlist example | `task-gates.example.json` | Fields match the loader in `apps/vestra-cli/src/task/task-gates.ts` (`schemaVersion` 1, absolute `executable`, non-empty `protocols`); the `node` placeholder is deliberately not an absolute path, so an uninstantiated copy fails closed with `VES_TASK_NOT_CONFIGURED` (`requirement: gate-allowlist`) |

Gates for this change: `pnpm agent:check` and `pnpm gate:quick` (results in the
handoff's `lastGate`). No test, gate, or assertion was changed.

## Blocker resolution (T1)

| Blocker | Resolution | Date (UTC) | Recorded by |
| --- | --- | --- | --- |
| 1 Candidate published | `verchestra@0.0.0-qualification.7`, `latest` on npm since 2026-10-04, `dist.integrity` `sha512-B9971s…RXIag==`, declared source revision `2e97443ea60192464cddfefe2c55dc9c625a975e` (ledger sequence 7); carries the subscription path (ADP-A), the protected-path fix (#485), the complete run usage account (AD-055, AD-056), and the state-path check (AD-080). It replaced `.5` and `.6` before any run; live update and rollback `.6` → `.7` on five targets is run 37235055911, recorded in `.specs/features/live-activation-matrix/validation.md` | 2026-10-04 | owner `accd` (decision); coordinating agent session (record) |
| 2 Usage and time approved | The ceilings of `spec.md` §6 approved as proposed: 3,000,000 tokens per task run, S1 1,000,000, S2 and S3 2,000,000 each, the per-run durations, and at most four hours of operator time | 2026-10-03 | owner `accd` |
| 3 Provider access and model availability | The owner's Claude subscription and ChatGPT plan. Model availability is confirmed only by the first run; a refusal is a stop rule (§6). The owner binds `claude-code-oauth-token` and `evidence-signing-passphrase` and signs Codex in at T2 | 2026-10-03 | owner `accd` |
| 4 Machine | The owner's own account on the owner's Mac (macOS arm64), not a fresh account; Node 24.14.0 first on `PATH` for the pilot session. Recorded as a deviation from §8 step 1 | 2026-10-03 | owner `accd` |
| 5 Accountable human and independent reviewer | Accountable human: `accd`. **No independent reviewer exists** (owner statement; the same fact closed #408 as not planned). The §10 review is not performed, T8 is recorded as not performed, and no record or report claims an independent review | 2026-10-03 | owner `accd` |
| 6 Pre-registration merged | `aee87ac` (#406 pre-registration) and the 2026-10-02 subscription amendment (`8362138`) are on `main`; this blocker resolution is merged before the first run | 2026-10-03 | coordinating agent session |
| 7 Subscription profile decisions (G1–G3) | Accepted by the owner: managed policy (G1; file and MDM locations refuse the launch, server-managed settings cannot be detected), the Keychain lookup keyed to a per-run directory (G2), and startup requests no switch covers (G3) | 2026-10-03 | owner `accd` |

## Configuration identity (T2)

| Item | Recorded value |
| --- | --- |
| macOS product version / arch | 26.6.2 / arm64 |
| Node | v24.14.0, first `node` on `PATH` for the pilot session |
| Git | 2.50.1 (Apple Git-155) |
| Claude Code | 2.1.282 (Claude Code), first `claude` on `PATH`; with `CLAUDE_CONFIG_DIR` and `HOME` pointing at two new empty directories, `claude auth status` reports `loggedIn: false` (§8 step 5) |
| Codex CLI | codex-cli 0.159.3, first `codex` on `PATH` (meets the driver minimum 0.115.0 in major 0; differs from the 0.157.1 of the pre-registration machine, recorded under Deviations) |
| Credential mode (`providerAuth` in the plan output) | recorded from the first plan output (P1) |
| Candidate `--version` / `dist.integrity` / `gitHead` / declared source revision | recorded at the first run on `.7` / `sha512-B9971s…RXIag==` / `unavailable` (the package carries none) / `2e97443ea60192464cddfefe2c55dc9c625a975e` |
| Baseline `node --test test.js` counts | `tests 4, pass 4, fail 0, cancelled 0, skipped 0, todo 0` at `1fffec16713ca76c85dcda696abca9d011f9c51b`, environment `PATH`, `HOME`, `CI=1` |
| First checkout fingerprint (digest) | `sha256:8d4e46e0d5d4b8a93f83d890825958c7404d75d2dea3284e049a0b7bb9359ef0`, taken after `init` (which adds `.verchestra/` and modifies `.gitignore`) and after the unrelated work |

## Pilot results (T3–T6)

One row per attempted run, in execution order. `unavailable` is written where a
value cannot be observed; nothing is estimated.

| Run | Attempt | runId | Request SHA-256 | Start (UTC) | Duration | Final state / status / reason | Gate results | Verification | Implementer usage (tokens / billing, ledger) | Verifier usage | Plan usage | Tool receipts | Interventions | Human review (outcome, handle, capsuleId) | Fingerprint unchanged | Assertions (pass/fail per item) | Evidence record |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | 1 | none (no run created) | `cc74d9d68094890cd526aaf1ac38a36fc10f6ff52c7a6a6a53da79d5c4afa5fd` | 2026-10-06T20:46:04Z | 2 s | `plan` exit 5, `VES_TASK_NOT_CONFIGURED`, requirement `evidence-signing-passphrase`; `approve`, `start`, and `status` then ran with no run ID and were refused `VES_CLI_ARGUMENT_INVALID` (`--run-id`) | not reached | not reached | none | none | none | none | none | not reached | not applicable (no run) | not evaluated | operator's pilot records, not tracked |
| P1 | 2 | `run_194aff18-a2b6-4ad1-a5ca-77aa0143e113` | `cc74d9d68094890cd526aaf1ac38a36fc10f6ff52c7a6a6a53da79d5c4afa5fd` | 2026-10-06T20:52:03Z | 77 s wall clock; the run's meter 73,862 ms | `FAILED`, `FAILED`, `VES_TASK_FAILED`; stop rule of §6 (below) | `gate:target-tests` passed, evidence `gate-evidence:5f079c69c72daded5dbc92b338521aa5`; repair `converged`; task commit `4c4f6f626691a09986040c06542e536254f6b2a6` on `vestra/run_194aff18-a2b6-4ad1-a5ca-77aa0143e113/PILOT-P1` | not completed: no verdict (the verifier asked for `gpt-5.2-codex`, which the account does not offer) | 6,088 tokens, `not billed (subscription)` (`unbilledTokens` 6,088, 1 usage event, ledger of the run) | none recorded (no usage event) | `unavailable` | 2 | approval by the agent with `--confirm-stdin`, at the owner's request (Deviations) | not reached | yes, but for the task branch ref `refs/heads/vestra/<runId>/PILOT-P1` that §8 allows | not evaluated (the run did not reach `HUMAN_REVIEW`) | operator's pilot records, not tracked |

## Scenario outcomes (T6)

| Scenario | Expected outcome (spec.md §5) | Observed | Evidence record |
| --- | --- | --- | --- |
| S1 | cancel returns `stopped: true`, `state: ABORTED`; start exits 1 with `VES_EXECUTOR_CANCELLED`; no worktree or branch left; repeat cancel/start `VES_TASK_TRANSITION_REFUSED` | | |
| S2 | after `SIGKILL`: `IMPLEMENTING`, not active, `awaiting-gate`; start refused `VES_TASK_TRANSITION_REFUSED`; resume reaches `HUMAN_REVIEW` without a new implementer session; receipts unchanged; one commit on the branch | | |
| S3 | out-of-scope and protected attempts refused (`VES_BRIDGE_SCOPE_DENIED`, `VES_EXECUTOR_SCOPE_DENIED`, `VES_EXECUTOR_PROTECTED_PATH`) or `not attempted` / `unavailable`; diff only `cli.js`, `test.js`; `readme.md` and `package.json` unchanged at the task commit | | |
| S3b | plan refused `VES_TASK_REQUEST_REJECTED`, reason `VES_TASK_REQUEST_TASK_INVALID`; no run created | | |

## Spend (T3–T6)

| After run | Recorded spend this run (US$, source) | Cumulative (US$) | Next run's ceiling (US$) | Stop rule satisfied |
| --- | --- | --- | --- | --- |

## Stop rule triggered: P1-2 (2026-10-06)

P1 attempt 2 stopped at the verifier. The pilot stopped, and the owner decided
(`spec.md` §6, amended on 2026-10-06 to name this case).

**What worked.** Through the installed candidate `verchestra@0.0.0-qualification.7`
with real subscription logins: `plan` and `approve` succeeded; the implementer,
Claude Code with `claude-sonnet-5`, made its change through the mediated tools
(2 tool receipts); the gate `gate:target-tests` passed and the repair loop
`converged`; the task commit `4c4f6f626691a09986040c06542e536254f6b2a6` was
made on the isolated branch `vestra/run_194aff18-a2b6-4ad1-a5ca-77aa0143e113/PILOT-P1`.
The run's usage was 6,088 tokens in 1 usage event, 73,862 ms on its meter,
`not billed (subscription)`. The checkout fingerprint changed only by that
branch ref.

**What stopped it.** The verifier asked the account for `gpt-5.2-codex`. The
owner's ChatGPT account does not offer it; the coordinating session read the
models the account does offer as `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`,
`gpt-6-luna`, `gpt-reserve`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`,
`gpt-5.5`, and `codex-auto-review` (the run itself recorded none of this). The
run ended `FAILED` and `status` showed `lastReason: VES_TASK_FAILED`.

**The diagnostic gap it revealed.** Nothing said why. The cause was lost in
four places (the driver's refusal read as a generic protocol failure, the
verifier ignoring the codes its session reported, the run recording the public
code and dropping its `reason`, and the executor and the nodes dropping the
driver's code), and nothing checked the model before the implementer's
allowance was spent. The remediation is
`.specs/features/p1-pilot-remediation/` (AD-083 to AD-085); the run's own
record cannot be repaired, and it stays `VES_TASK_FAILED` as it was.

**Next action.** Run P1 again on the candidate that carries the remediation,
with the amended request (`gpt-5.5`), as attempt 3. P1-2 is not counted as a
success or as a retry of the same request.

## Request digests after the amendment of 2026-10-06

The verifier model of each request changed from `gpt-5.2-codex` to `gpt-5.5`.
Each file still passes `normalizeTaskRequest` (S3b is still refused
`VES_TASK_REQUEST_TASK_INVALID`) and the Task Request v1 schema. The operator
plans with a copy whose SHA-256 equals the tracked file's.

| Request | SHA-256 before | SHA-256 after |
| --- | --- | --- |
| `P1-bug-fix.json` | `cc74d9d68094890cd526aaf1ac38a36fc10f6ff52c7a6a6a53da79d5c4afa5fd` (the digest of P1-1 and P1-2) | `b6a18a5a5d69cd82378666f5dee3e9929a7d3be7f6481a9764e7c90d4dbcd2b5` |
| `P2-feature.json` | `e9658eded7b1dd0ae9d8fcdbf32a036487f3f6a65ef1a3e216006f04a61b68a9` | `7e4b6d2a5ec80050434146dca01b8d93c3d69b1400af776edecf56fbe0154ccf` |
| `P3-refactor.json` | `a31a8189e334776a29719f8758cb818d49691753f67e7aceedfaaf9d2e83370e` | `4978d89bf4854a907d709ee76e8c7876d44d72b85c97333351ef40b3c63a086a` |
| `S1-cancellation.json` | `2664a2b7fe299f06027d17c694a548c41773a307c9b10db848fcbeea05bed44a` | `e66d81936ca9c9b6964921a3a75b361e6cf434e40b45e6fd5d73f68009dae8e7` |
| `S2-interrupt-resume.json` | `54d6ff1aa73fa7293cdb3dec62f3239811d8b20cedcc50c30269872f1d5865b3` | `3d7b28134f65a5ae896cb049d25365d264a9948266856838882d3f011c75ef80` |
| `S3-out-of-scope.json` | `6689e8adafd29c4d3d091bf9df7a7c41c7965ede2a9f5ce918eab4f1610c99be` | `42fa866b4b2321f991dde3a60a6f2af419d12df2d4da35c9eee997600c2a4bd7` |
| `S3b-plan-refusal.json` | `942fd3308f115d0455ba1c3a3596b3d8358f22082a1a04a43db1f7eba2e29824` | `051cd0b31e1028c0dc22e2a723c58b288e8a3a6114b70530a7fe39e0e8d1dbec` |

## Deviations

| Time (UTC) | What changed | Why | Runs affected |
| --- | --- | --- | --- |
| 2026-10-03, before any run | Candidate `.4` → `.5` (`spec.md` §2) | `.4` predates the subscription path the owner needs; `.5` is the first published release that carries it | all |
| 2026-10-03, before any run | Machine: the owner's own account, not a fresh account (`spec.md` §8 step 1) | Owner decision; the pilot Workspace, its Codex identity directory and its credentials are still created for the pilot and deleted after it (§8 step 11) | all |
| 2026-10-03, before any run | No independent reviewer; T8 not performed | No second person exists (owner statement) | all; the report says so |
| 2026-10-03, before any run | Codex CLI 0.159.3 instead of 0.157.1 (`spec.md` §3) | The installed Codex updated itself after pre-registration; it meets the driver minimum, and the verifier model is unchanged | all |
| 2026-10-03, before any run | Candidate `.5` → `.6` (`spec.md` §2), with §5 S2 and §7 usage rows restated | `.6` carries the protected-path fix (#485) and the complete usage account (AD-055, AD-056); in `.6` `checkpoints.budget` covers implementer and verifier | all |
| 2026-10-04, before any run | Candidate `.6` → `.7` (`spec.md` §2) | `.7` is the published `latest` and carries the state-path check and the shorter verification scratch layout (AD-080); no step or expectation of the pilot changes | all |
| 2026-10-06, after P1-1 and before P1-2 | The `evidence-signing-passphrase` requirement was satisfied for the pilot Workspace | P1-1 stopped at `plan` with `VES_TASK_NOT_CONFIGURED` (`evidence-signing-passphrase`); nothing had run | P1-1 |
| 2026-10-06, P1-2 | The approval was made by the agent through `--confirm-stdin`, piping the binding digest, at the owner's request, and not typed by the owner at an interactive prompt (`spec.md` §8 step 9) | The owner asked the agent to approve. The agent's shell is no interactive terminal: its first approval attempt was refused `VES_TASK_CONFIRMATION_REQUIRED`, so the digest was piped with `--confirm-stdin` | P1-2; every later run, until the owner types the digest again |
| 2026-10-06, after P1-2 | The verifier model of all seven requests is `gpt-5.5`, not `gpt-5.2-codex` (`spec.md` §3, §4, §6 and the digest table above) | The first run stopped because the account does not offer `gpt-5.2-codex`; the owner chose `gpt-5.5` the same day | every run after P1-2 |
| 2026-10-06, after P1-2 | The stop rule of `spec.md` §6 names a model the account does not offer | P1-2 hit it | every run after P1-2 |

## Independent review (T8)

Reviewer (GitHub handle): — ; not the operator: —

| # | Checklist item (spec.md §10) | Result (pass / fail / not verifiable) | Note | Next action |
| --- | --- | --- | --- | --- |
| 1 | Pre-registration predates the first run | | | |
| 2 | Request SHA-256 matches the tracked file | | | |
| 3 | Candidate and identity match §2 and §3 | | | |
| 4 | Every attempted run has a record | | | |
| 5 | Each claimed success meets all four conditions, reproduced | | | |
| 6 | Scenario outcomes and codes match §5 | | | |
| 7 | No unavailable metric filled in; no hand-derived cost | | | |
| 8 | No dollar cost recorded; tokens and duration within the per-run ceilings, or overshoot recorded | | | |
| 9 | Checkout fingerprint unchanged across every run | | | |
| 10 | Sanitized evidence has no credential or local value | | | |
| 11 | Every failure has a next action | | | |
| 12 | No statistical, readiness, or release claim | | | |
