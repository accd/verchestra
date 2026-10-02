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
| PLT-03 identity | `spec.md:107` (§3) | Claude driver minimum `packages/drivers/src/claude-code-driver.ts:67` (`2.1.282`); Codex driver minimum `packages/drivers/src/codex-driver.ts:98` (`0.115.0`) with the same-major comparison at `packages/drivers/src/driver-version-probe.ts:43-49`; `codex --version` on the pre-registration machine printed `codex-cli 0.157.1` and `claude --version` printed `2.1.282 (Claude Code)` (version queries only, no model call); both models priced at `packages/application/src/execution/model-price-table.ts:13` and `:16`; credential names at `apps/vestra-cli/src/task-provider-auth.ts:29-32` and `apps/vestra-cli/src/task/task-credentials.ts:18-19` |
| PLT-04 tasks | `spec.md:127` (§4), `requests/P1-bug-fix.json`, `requests/P2-feature.json`, `requests/P3-refactor.json`, `probes/P1-probe.mjs`, `probes/P2-probe.mjs`, `probes/P3-probe.mjs` | Every request accepted by `schemas/task-request/1.schema.json` (through `SchemaRegistry.validate`) and by `normalizeTaskRequest`; each probe fails at the pinned revision and passes against a throwaway reference change; revert checks as stated in `spec.md` §4 ("How the assertions were checked before pinning"); the P1 defect reproduced at the pinned revision (exit 1, usage on stderr for two chunks 200 ms apart); every request uses the registered label `VES-EXE-001` because the requirements register (`scripts/requirements-trace.mjs`, `tests/agent-readiness/requirements-register.test.mjs`) rejects unregistered IDs in tracked files (`spec.md` §4, Requirement label) |
| PLT-05 scenarios | `spec.md:255` (§5), `requests/S1-cancellation.json`, `requests/S2-interrupt-resume.json`, `requests/S3-out-of-scope.json`, `requests/S3b-plan-refusal.json` | S1–S3 accepted by schema and normalizer; S3b refused by the schema and by `normalizeTaskRequest` with `VES_TASK_REQUEST_TASK_INVALID` (`packages/application/src/execution/task-request.ts:244`). Expected codes traced to: cancel poll `apps/vestra-cli/src/task/task-run.ts:50`, signals `:538-539`, resume shortcut `:350`, start/resume states `:574-576`; cancel wait and refusal `apps/vestra-cli/src/task/task-status.ts:13`, `:160`; `ABORTED`/`VES_EXECUTOR_CANCELLED` `packages/application/src/execution/task-run.ts:117`, `:249`; scope and protected checks `packages/application/src/execution/task-executor.ts:387-388`; read scope `packages/agent-runtime/src/execution/mcp-bridge-tools.ts:203`; non-fatal `denied:` result `packages/agent-runtime/src/execution/mcp-tool-bridge.ts:253`; denied count kept only in a checkpoint `packages/agent-runtime/src/execution/driver-execution-adapter.ts:111`; the same journeys with stand-ins in `tests/e2e/task-cli-e2e.test.mjs` |
| PLT-06 limits and success | `spec.md:383` (§6) | Per-request `budgets` in each request file (P1–P3 `maximumTokens` 3,000,000; `maximumCostUsd` is declared and not consumed on a subscription); gate pass rule including `skipped === 0` and `minimumTests` at `apps/vestra-cli/src/task/task-verifier.ts:60`; ceilings pending owner approval (handoff Blocker 2) |
| PLT-07 recording | `spec.md:459` (§7); results tables below | Evidence path is not a `tNN-validation.md` name, so it cannot enter the qualification chain (`scripts/agent-readiness.mjs:134`) |
| PLT-08 reproduction and boundaries | `spec.md:498` (§8), `spec.md:551` (§9) | Steps 2–3 were executed as written in a throwaway clone (baseline reproduced) |
| PLT-09 review checklist | `spec.md:574` (§10); review table below | — |
| PLT-10 allowlist example | `task-gates.example.json` | Fields match the loader in `apps/vestra-cli/src/task/task-gates.ts` (`schemaVersion` 1, absolute `executable`, non-empty `protocols`); the `node` placeholder is deliberately not an absolute path, so an uninstantiated copy fails closed with `VES_TASK_NOT_CONFIGURED` (`requirement: gate-allowlist`) |

Gates for this change: `pnpm agent:check` and `pnpm gate:quick` (results in the
handoff's `lastGate`). No test, gate, or assertion was changed.

## Blocker resolution (T1)

| Blocker | Resolution | Date (UTC) | Recorded by |
| --- | --- | --- | --- |
| 1 Candidate published | | | |
| 2 Usage and time approved | | | |
| 3 Provider access and model availability | | | |
| 4 Machine | | | |
| 5 Accountable human and independent reviewer | | | |
| 6 Pre-registration merged | | | |
| 7 Subscription profile decisions (G1–G3) | | | |

## Configuration identity (T2)

| Item | Recorded value |
| --- | --- |
| macOS product version / arch | |
| Node | |
| Git | |
| Claude Code | |
| Codex CLI | |
| Credential mode (`providerAuth` in the plan output) | |
| Candidate `--version` / `dist.integrity` / `gitHead` / declared source revision | |
| Baseline `node --test test.js` counts | |
| First checkout fingerprint (digest) | |

## Pilot results (T3–T6)

One row per attempted run, in execution order. `unavailable` is written where a
value cannot be observed; nothing is estimated.

| Run | Attempt | runId | Request SHA-256 | Start (UTC) | Duration | Final state / status / reason | Gate results | Verification | Implementer usage (tokens / billing, ledger) | Verifier usage | Plan usage | Tool receipts | Interventions | Human review (outcome, handle, capsuleId) | Fingerprint unchanged | Assertions (pass/fail per item) | Evidence record |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

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

## Deviations

| Time (UTC) | What changed | Why | Runs affected |
| --- | --- | --- | --- |

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
