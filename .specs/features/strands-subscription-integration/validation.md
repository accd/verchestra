# Strands Subscription Integration Validation

**Verdict**: PENDING — no implementation task has run. This file holds the
evidence of T1 and T2 and the empty evidence rows that T3–T9 fill. The
independent verifier (author ≠ verifier) fills the verdict after T8, against
`spec.md`, with the discrimination list below.

**Diff range for verification**: `7e274f237648251b972081471134623097122c16..<T9 head>`

## T1 and T2 Evidence

| Check | Command or source | Result |
| --- | --- | --- |
| Base revision | `git rev-parse HEAD` in the new worktree | `7e274f237648251b972081471134623097122c16`, equal to the plan's analysed remote HEAD |
| Install | `pnpm install --frozen-lockfile` (Node 24.14.0, pnpm 10.34.5) | PASS |
| Spec structure | `python3 <tlc-spec-driven>/scripts/validate_spec.py spec.md` | 0 errors, 0 warnings |
| Task structure | `python3 <tlc-spec-driven>/scripts/validate_tasks.py tasks.md` | 0 errors; 1 warning (T1 has no code layer, as the matrix says) |
| Skill copies | SHA-256 of the 39 installed files against the inventory | 39 of 39 match; no extra file |
| Readiness | `pnpm agent:check` | Recorded in `handoff.md` `lastGate` |
| Quick gate | `pnpm gate:quick` | Recorded in `handoff.md` `lastGate` |
| Probes | Scratch install, import, run, and bundle probes in the ignored `.tmp/` (`research.md` S5–S9) | No file outside `.tmp/` changed; `git status` clean apart from this feature's files |

## T4 Evidence (driver structured results and quota signals)

Author's evidence, commit by commit, on branch `strands/t4-driver-results`
(base `origin/main` at `dc35c52`). The independent verifier re-derives it.

| Commit | Behaviour | Assertion (file:line) | Gate run |
| --- | --- | --- | --- |
| 1 | The closed table names ten types; `result.structured { value, bytes }` and `quota.exhausted { scope, resetsAt? }` have exactly these kinds | `tests/unit/driver-event.test.mjs:18` (type list), `:63-64` (rows) | `node --test tests/unit/driver-event.test.mjs`: 37 of 37 |
| 1 | The structured-result rule: canonical value and UTF-8 size; a copy, so the provider's object cannot change it; exactly at the bound passes, one byte over is `too-large`; bytes, not characters; a bound that is not a positive count refuses; non-canonical values (cycle, depth 1000, non-finite, function, lone surrogate) are `invalid` | `tests/unit/driver-event.test.mjs:128`, `:136`, `:143`, `:153`, `:158` | same |
| 1 | The quota rule: epoch seconds become a canonical UTC instant; an unspellable reset is dropped, never guessed; a scope outside `^[a-z][a-z0-9_]{0,63}$` is `unknown`, so no free provider text reaches the event | `tests/unit/driver-event.test.mjs:171`, `:186`, `:196` | same |
| 1 | The mock scripts the new types and refuses a structured result whose size is not its canonical size, a quota scope the rule would not keep, and a scripted optional field | `tests/contract/mock-driver.test.mjs:30-31`, `:95`, `:109` | `node --test tests/contract/mock-driver.test.mjs`: 20 of 20 |

| 2 | A structured invocation adds `--json-schema <canonical schema>` before `--model` and `StructuredOutput` to `--allowedTools`, nothing else, in both mediated profiles; the plain invocations are unchanged | `tests/contract/claude-code-driver-structured.test.mjs:47` | `node --test tests/contract/claude-code-driver-structured.test.mjs`: 9 of 9 |
| 2 | Success: one `result.structured` (canonical value, 53 bytes) after `usage.updated`; the `StructuredOutput` call is no `tool.requested`; listed or unlisted at init | `tests/contract/claude-code-driver-structured.test.mjs:68`; exact sequence `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:51` | same; `node --test spikes/claude-code-driver/test/claude-driver-structured.test.mjs`: 5 of 5 |
| 2 | Success without `structured_output` and `error_max_structured_output_retries` fail with `VES_CLAUDE_STRUCTURED_OUTPUT_MISSING` (spec edge case) | `tests/contract/claude-code-driver-structured.test.mjs:88`; `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:65` | same |
| 2 | An answer one byte over its bound (53 > 52) and an 8 KiB answer fail with `VES_CLAUDE_STRUCTURED_OUTPUT_LIMIT`; the answer text is in no event | `tests/contract/claude-code-driver-structured.test.mjs:119` | same |
| 2 | A session that asked for no schema refuses `StructuredOutput` at init (`VES_CLAUDE_TOOL_SURFACE_UNEXPECTED`) and keeps an unasked call a `tool.requested`, which the adapter refuses | `tests/contract/claude-code-driver-structured.test.mjs:136` | same |
| 2 | A request that is not exactly `{ schema, maxBytes }`, a schema that is not a canonical JSON object of at most 16 KiB, a bound outside 1..1 MiB, and a structured request on the T03 profile are refused with `VES_CLAUDE_OUTPUT_SCHEMA_INVALID` before spawn | `tests/contract/claude-code-driver-structured.test.mjs:149` | same |
| 2 | SSI-54: `apiKeySource` other than `none` in the subscription profile ends the session before `session.started`, with no tool effect; the bare profile is not refused for its key | `tests/contract/claude-code-driver-structured.test.mjs:172`; `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:108` | same |
| 2 | SSI-58: `rate_limit_event` `rejected` emits one `quota.exhausted` with the window as scope and the reset when given (`five_hour`, `2026-09-21T14:13:20.000Z`; `seven_day` without reset); purchase, overage, and session fields are dropped | `tests/contract/claude-code-driver-structured.test.mjs:187`; `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:92` | same |
| 2 | `allowed_warning` (twice) records one `VES_CLAUDE_QUOTA_WARNING` and the session completes with its write | `tests/contract/claude-code-driver-structured.test.mjs:214` | same |
| 2 | The installed Claude Code documents `--json-schema` (read-only `--help`; not configured when absent) | `spikes/claude-code-driver/test/claude-driver-structured.test.mjs:122` | same, against the installed 2.1.282 |
| 2 | Existing Claude sequences unchanged: the child-run, cancel-order, provider-ends, input-failure, mediated, subscription, and lifecycle suites pass with no edit | `spikes/claude-code-driver/test/*.test.mjs` (unchanged files), `tests/contract/driver-lifecycle-matrix.test.mjs` | 235 of 235 across the Claude, adapter, bridge, and e2e suites |

Changed assertions (no test deleted): `tests/unit/driver-event.test.mjs:18`
"the field table names the eight event types" became "ten event types" with the
two new rows inserted after `usage.updated`; the eight existing types keep
their order.

Guardrails: `complexity-baseline.json` lost the key
`packages/drivers/src/index.ts :: Function 'validateScriptEvent'` (15): the
scripted checks moved into a table, so the function fell below the target of
10. It also lost `packages/drivers/src/claude-code-driver.ts :: Arrow function`
(17): the stream translation dispatches by message type through a table, so no
arrow function of the file is above 10; `Async method 'start'` keeps 14.
`docs/canonical-json-census.json` gained
`packages/domain/src/driver-event/driver-event.ts` and
`packages/drivers/src/driver-structured-output.ts` (both `migrated-v2`, two
`canonicalizeJsonV2` signals each).

## Requirement Evidence

Each row needs a file-and-assertion citation (`path:line` and what the assertion
checks), the gate run that executed it, and PASS or FAIL. A row without
evidence is FAIL.

| Requirement | Evidence (file:line, assertion) | Gate run | Verdict |
| --- | --- | --- | --- |
| SSI-01 | — | — | — |
| SSI-02 | — | — | — |
| SSI-03 | — | — | — |
| SSI-04 | — | — | — |
| SSI-05 | — | — | — |
| SSI-06 | — | — | — |
| SSI-07 | — | — | — |
| SSI-08 | — | — | — |
| SSI-09 | — | — | — |
| SSI-10 | — | — | — |
| SSI-11 | — | — | — |
| SSI-12 | — | — | — |
| SSI-13 | — | — | — |
| SSI-14 | — | — | — |
| SSI-15 | — | — | — |
| SSI-16 | — | — | — |
| SSI-17 | — | — | — |
| SSI-18 | — | — | — |
| SSI-19 | — | — | — |
| SSI-20 | — | — | — |
| SSI-21 | — | — | — |
| SSI-22 | — | — | — |
| SSI-23 | — | — | — |
| SSI-24 | — | — | — |
| SSI-25 | — | — | — |
| SSI-26 | — | — | — |
| SSI-27 | — | — | — |
| SSI-28 | — | — | — |
| SSI-29 | — | — | — |
| SSI-30 | — | — | — |
| SSI-31 | — | — | — |
| SSI-32 | — | — | — |
| SSI-33 | — | — | — |
| SSI-34 | — | — | — |
| SSI-35 | — | — | — |
| SSI-36 | — | — | — |
| SSI-37 | — | — | — |
| SSI-38 | — | — | — |
| SSI-39 | — | — | — |
| SSI-40 | — | — | — |
| SSI-41 | — | — | — |
| SSI-42 | — | — | — |
| SSI-43 | — | — | — |
| SSI-44 | — | — | — |
| SSI-45 | — | — | — |
| SSI-46 | — | — | — |
| SSI-47 | — | — | — |
| SSI-48 | — | — | — |
| SSI-49 | — | — | — |
| SSI-50 | — | — | — |
| SSI-51 | — | — | — |
| SSI-52 | — | — | — |
| SSI-53 | — | — | — |
| SSI-54 | — | — | — |
| SSI-55 | — | — | — |
| SSI-56 | — | — | — |
| SSI-57 | — | — | — |
| SSI-58 | — | — | — |
| SSI-59 | — | — | — |
| SSI-60 | — | — | — |
| SSI-61 | — | — | — |
| SSI-62 | — | — | — |
| SSI-63 | — | — | — |
| SSI-64 | — | — | — |
| SSI-65 | — | — | — |
| SSI-66 | — | — | — |
| SSI-67 | — | — | — |
| SSI-68 | — | — | — |
| SSI-69 | — | — | — |
| SSI-70 | — | — | — |
| SSI-71 | — | — | — |
| SSI-72 | — | — | — |
| SSI-73 | — | — | — |
| SSI-74 | — | — | — |
| SSI-75 | — | — | — |
| SSI-76 | — | — | — |
| SSI-77 | — | — | — |
| SSI-78 | — | — | — |
| SSI-79 | — | — | — |
| SSI-80 | — | — | — |
| SSI-81 | — | — | — |
| SSI-82 | — | — | — |
| SSI-83 | — | — | — |
| SSI-84 | — | — | — |
| SSI-85 | — | — | — |

## Discrimination Sensor (planned)

Each mutant is applied in a scratch worktree, the named suite is run, and the
mutant must be killed (a test fails). A surviving mutant becomes a fix task.

| Mutant | Requirement | Expected killer | Result |
| --- | --- | --- | --- |
| Drop one descriptor field from the canonical request before digesting | SSI-28 | Per-field binding-digest test | — |
| Accept a cycle in the graph normalizer | SSI-25 | Cycle rejection case | — |
| Let a write scope leave `task.changeScope` | SSI-26 | Scope rejection case | — |
| Skip node write-scope narrowing in the coordinated driver | SSI-41 | Out-of-node-scope write refused before the executor | — |
| Remove the writer mutex | SSI-40 | Two writers never overlap (instrumented fake) | — |
| Raise a default limit by one | SSI-37 | Limit boundary cases | — |
| Accept an undeclared handoff target | SSI-43 | Forbidden-destination swarm case | — |
| Persist a result before checking its size | SSI-47 | Oversized result leaves nothing persisted | — |
| Skip the `apiKeySource` check | SSI-54 | Fake init with `ANTHROPIC_API_KEY` | — |
| Skip the Codex `account/read` check | SSI-55 | Fake `apiKey` account | — |
| Allow `account/rateLimitResetCredit/consume` | SSI-57 | Method allowlist test | — |
| Skip the billing confirmation at resume | SSI-52 | Resume without confirmation is `not configured` | — |
| Clean up the worktree on `suspended` | SSI-60 | Suspended worktree survives | — |
| Re-run a partial node silently | SSI-66 | Uncertain-node refusal | — |
| Construct a Strands `Agent` in the adapter | SSI-03, SSI-79 | Architecture ban and empty-environment probe | — |
| Import the SDK root entry | SSI-02 | Architecture test and sealed build | — |

**Sensor result**: not run.

## Deleted Case → Replacement

None yet. Every test deleted by T3–T8 is listed here with the test at the
deepened interface that covers the same case.
