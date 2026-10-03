# Strands Subscription Integration Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill (pinned copy, commit
`120b676`, see `research.md`): activate it by name and follow its Execute flow
and Critical Rules. If the skill cannot be activated, the rules this file needs
are restated here so a clean clone can proceed: tests derive from `spec.md`
acceptance criteria, the gate decides, nothing is skipped or weakened, each
listed commit is atomic and conventional, `tasks.md` and `validation.md` are
updated in the same commit as the work they record, and a fresh verifier
(author ≠ verifier) runs the discrimination list in `validation.md` after T8.

The task units are the plan's T1–T10, which the owner approved. Most deliver
several modules, so each lists its atomic commits; a task is done when all of
its commits are on the branch and its gate passes.

---

**Design**: `.specs/features/strands-subscription-integration/design.md`
**Status**: In Progress (T1 done; T2 awaiting the owner's review of
`setup-draft.md`, the threat-model check-in, and decisions D1–D9)

---

## Test Coverage Matrix

> Generated from the codebase, `AGENTS.md`, `tests/AGENTS.md`, `scripts/gate-stages.mjs`, and `package.json`. Guidelines found: `AGENTS.md` (behaviour-focused tests, never weaken assertions), `.specs/AGENTS.md` (independent validation with a discrimination sensor), `.context` preamble (replace, don't layer; record deleted case → replacement).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Schemas and generated contracts | contract | Every valid example, every specified rejection, generated-output parity, v1 byte identity | `tests/contract/*.test.mjs` | `pnpm test:contract` |
| Domain (Driver event table) | unit | Every new row and its field kinds | `tests/unit/*.test.mjs` | `pnpm test:unit` |
| Application (normalizer, coordination plan, node results, coordinated driver, executor suspension) | unit + integration | 1:1 with SSI acceptance criteria; every edge case in `spec.md` | `tests/unit/`, `tests/integration/` | `pnpm test:unit`, `pnpm test:integration` |
| Drivers | contract + qualification spike with labelled fake CLIs | Every new flag, event mapping, refusal, and method allowlist | `tests/contract/`, `spikes/*/test/` | `pnpm test:contract`, `pnpm qualify:claude`, `pnpm qualify:codex` |
| Strands adapter | integration + child-process probe | Order, dependency failure, cancellation, write conflict, valid and forbidden handoff, malformed output, limits, explicit end, resume replay | `tests/integration/` | `pnpm test:integration` |
| Import and placement rules | architecture | Subpath-only SDK import, bans, main entry free of the SDK, literal dynamic import site | `tests/architecture/` | `pnpm test:architecture` |
| CLI composition | e2e | Plan, approve, start, status, suspend, resume, reconcile, cancel journeys with fakes | `tests/e2e/` | `pnpm test:e2e` |
| Crash and resume | fault | Uncertain and partial nodes, drift, suspension mid-node | `tests/fault/` | `pnpm test:fault` |
| Records, tokens, pipes | security | No secret, session, personal data, or path in any new record; pipe access refusals | `tests/security/` | `pnpm test:security` |
| Sealed bundle | build | Self-containment, health silence, size recorded | `tests/build/` | `pnpm test:build` |
| Specs and handoff | agent-readiness | Handoff schema, links, paths | — | `pnpm agent:check` |
| Projected docs | site | Links and projection | `apps/site/tests` | `pnpm site:check` |

## Gate Check Commands

> Generated from `scripts/gate-stages.mjs` and `package.json`.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Every task, before review (static checks, unit, agent-readiness, census) | `pnpm gate:quick` |
| Full | Tasks that add integration, e2e, fault, or mutation tests | `pnpm gate:full` |
| Build | Tasks that touch packages, exports, the bundle, or qualification | `pnpm gate:build` |
| Security | Tasks that touch credentials, billing, records, or the bridge | `pnpm gate:security` |
| Release | Only if a candidate is packaged; never publishes | `pnpm gate:release` |
| Docs | Any change under `docs/` or projected Markdown | `pnpm site:check` |
| Readiness | Every task | `pnpm agent:check` |

Guardrails on every task: `complexity-baseline.json` only ratchets down; run
`pnpm census:refresh` and `pnpm test:census` when a file gains or loses
`JSON.stringify` or `createHash`; fix `<file>.ts:<line>` citations in `docs` and
`.specs` for every moved file; keep the credential-store qualification digests;
keep the migration count (12) and the runtime error catalog count (19).

---

## Execution Plan

Phases run in order. Inside phase 2 the three tasks touch disjoint files and
may run in parallel worktrees, with one exception named in T7.

### Phase 1: Base and specification

```
T1 -> T2
```

### Phase 2: Contracts, driver results, Windows transport (parallel)

```
T3
T4
T7
```

### Phase 3: Coordination and suspension

```
T5 -> T6
```

### Phase 4: Surface, verification, handoff

```
T8 -> T9 -> T10
```

---

## Task Breakdown

### Phase 1: Base and specification

#### T1: Updated base

**What**: Start from the current `main`, preserve existing work, and record the baseline gates.
**Where**: `.specs/features/strands-subscription-integration/`
**Depends on**: None
**Reuses**: The coordinator's worktree convention
**Requirement**: SSI-83
**Parallel**: no · **Owner**: no · **Platform matrix**: no

**Done when**:

- [x] Worktree created from `origin/main` at `7e274f237648251b972081471134623097122c16`, equal to the plan's analysed remote HEAD.
- [x] `pnpm install --frozen-lockfile` succeeded with Node 24.14.0.
- [x] No conclusion relies on the old checkout; the deviation from the plan's Windows sequence is recorded in `spec.md`.
- [x] Baseline `pnpm agent:check` and `pnpm gate:quick` recorded in `validation.md`.

**Tests**: none (no code layer)
**Gate**: quick

---

#### T2: Specification, skills, decisions, and threat model

**What**: The canonical artifacts of this feature, the verified skill inventory, the decision entries, and the setup draft.
**Where**: `.specs/features/strands-subscription-integration/`
**Depends on**: T1
**Reuses**: `tlc-spec-driven`, `modular-design-principles`, `security-threat-model`, `research`, `setup-matt-pocock-skills` (pinned copies)
**Requirement**: SSI-01..85 (traceability)
**Parallel**: no · **Owner**: yes (review `setup-draft.md`, confirm `threat-model.md` assumptions, decide D1–D9) · **Platform matrix**: no

**Commits**:

1. `docs(specs): specify the Strands subscription integration` — `spec.md`, `design.md`, `threat-model.md`, `tasks.md`, `validation.md`, `handoff.md`, `research.md`, `setup-draft.md`, and the decision entries in `.specs/STATE.md`.

**Done when**:

- [x] `validate_spec.py` and `validate_tasks.py` report no error.
- [x] Every requirement maps to a task and to an evidence row in `validation.md`.
- [x] 39 skill files re-hashed and matching the inventory.
- [ ] The owner has edited or accepted `setup-draft.md`; only then is any configuration written, in a separate commit.
- [ ] The owner has confirmed or corrected the threat-model assumptions (D7) and decided D1–D9.

**Tests**: agent-readiness (`pnpm agent:check`)
**Gate**: quick

---

### Phase 2: Contracts, driver results, Windows transport

#### T3: Task Request v2 contracts

**What**: The v2 schema, the generator extension, the v2 normalizer and coordination plan, and the approval presentation, with v1 unchanged.
**Where**: `schemas/task-request/`, `scripts/`, `packages/application/src/execution/`, `apps/vestra-cli/src/task/`
**Depends on**: T2
**Reuses**: `normalizeTaskRequest`, `normalizeTask`, `taskPathsOverlap`, `isWithinTaskScope`, `isProtectedTaskPath`, `canonicalTaskRequest`
**Requirement**: SSI-11, SSI-18, SSI-20..29, SSI-37, SSI-38, SSI-83
**Parallel**: yes, with T4 and T7 · **Owner**: no · **Platform matrix**: no

**Commits**:

1. `feat(contracts): add the Task Request v2 schema and generate its type` — `schemas/task-request/2.schema.json`; `scripts/generate-contract-types.mjs` reads every `<n>.schema.json`; generated `TaskRequestV2`; v1 output byte-identical.
2. `feat(application): normalize Task Request v2 into a coordination plan` — `coordination-plan.ts`, dispatch in `task-request.ts`, limits with defaults and ceilings, topology and scope rules, `VES_TASK_REQUEST_EXECUTION_INVALID`.
3. `feat(cli): bind and present the v2 descriptor at plan time` — `task-plan.ts` review presentation (passports per node, destinations, capabilities, topology), plan record v2 load path; v1 records load unchanged.

**Done when**:

- [ ] Golden v1 fixtures keep their normalized form, execution-contract digest, and binding digest (SSI-21).
- [ ] A test mutates each descriptor field and observes a new binding digest (SSI-28).
- [ ] Every rejection in SSI-24..27 has a contract case and a normalizer case with the same verdict (schema/normalizer parity, as `tests/contract/task-request.test.mjs` does for v1).
- [ ] Defaults and ceilings are tested at, below, and above each bound (SSI-37, SSI-38).
- [ ] Gates pass with no skipped or deleted test.

**Tests**: contract, unit, integration
**Gate**: build

---

#### T4: Driver structured results and quota signals

**What**: Structured output through both drivers as bounded payload references, effective-method checks, quota signals, and the Codex method allowlist.
**Where**: `packages/domain/src/driver-event/`, `packages/drivers/src/`, `packages/agent-runtime/src/execution/`, `docs/qualification/`
**Depends on**: T2
**Reuses**: AD-063 field table, `usageUpdated`, `runProviderChild`, `DriverExecutionAdapter`, `InMemoryExecutionPayloadStore`
**Requirement**: SSI-17, SSI-46, SSI-48, SSI-49, SSI-54..58, SSI-81
**Parallel**: yes, with T3 and T7 · **Owner**: an optional owner-run probe confirms Claude's `stream-json` `structured_output` · **Platform matrix**: yes (driver contracts run on all three operating systems)

**Commits**:

1. `feat(domain): add structured-result and quota Driver events` — rows `result.structured` and `quota.exhausted`. **Done** (branch `strands/t4-driver-results`; evidence in `validation.md`, T4 section).
2. `feat(drivers): structured output, auth source, and rate limits for Claude Code` — `--json-schema`, bounded `structured_output`, `apiKeySource === "none"`, `rate_limit_event` mapping, missing-output failure; fake CLI fixtures recorded from the documented message shapes. **Done** (the fake's `system/init`, `result`, and `rate_limit_event` shapes follow the schema the installed 2.1.282 declares; `StructuredOutput` is allowed beside the bridge tools in a structured session).
3. `feat(drivers): structured output, account checks, and usage limits for Codex` — `outputSchema`, `account/read`, `account/rateLimits/read`, `usageLimitExceeded` and `rateLimitReachedType` mapping, JSON-RPC method allowlist, minimum version raised with `codex app-server generate-ts` evidence.
4. `feat(agent-runtime): carry a node's structured result as a payload reference` — `driver-execution-adapter.ts` returns `outputRefs`; `quota.exhausted` surfaced.
5. `docs(qualification): record the structured-result driver profiles` — new reports beside the existing immutable ones.

**Done when**:

- [ ] Each mapping has a fake-CLI case: success, success without output, retries exhausted, oversized output, wrong `apiKeySource`, `rejected` with and without `resetsAt`, `allowed_warning`, Codex `apiKey` account, credit balance, `ordinaryUsageAllowed: false`, `usageLimitExceeded`.
- [ ] A test proves the Codex client cannot send any method outside its allowlist, including `account/rateLimitResetCredit/consume`.
- [ ] Security tests show no e-mail address, token, or provider text in events, checkpoints, or payloads (SSI-81).
- [ ] `pnpm qualify:claude` and `pnpm qualify:codex` pass.

**Tests**: unit, contract, integration, security
**Gate**: security

---

#### T7: Windows bridge transport

**What**: The bridge transport seam, the named-pipe transport through a pinned PowerShell 7 helper, ACL proof, Windows policy sources, and diagnostics; the refusals are lifted last.
**Where**: `packages/agent-runtime/src/execution/`, `packages/platform-node/src/`, `packages/drivers/src/`
**Depends on**: T2
**Reuses**: The Unix controller logic, `windows-credential-manager.ts` logging guard, `processTreeTerminator`
**Requirement**: SSI-69..77
**Parallel**: yes, with T3 and T4, except `packages/drivers/src/claude-code-driver.ts`, which T7 edits only after T4's commits on that file have landed · **Owner**: yes (D6; a Windows machine with PowerShell 7 for the pilot) · **Platform matrix**: yes (Windows runner required)

**Commits**:

1. `refactor(agent-runtime): put the bridge channel behind a transport interface` — Unix transport extracted unchanged; existing bridge tests unchanged and passing.
2. `feat(platform-node): add a Windows named-pipe bridge transport` — constant helper script, pinned PowerShell 7 resolution, `CurrentUserOnly | FirstPipeInstance`, one instance, logging guard, ACL set-and-verify.
3. `feat(drivers): check Claude Code managed policy sources on Windows` — directory, HKLM, HKCU.
4. `feat(cli): enable the governed task path on Windows` — lifts the three refusals and updates the pinned refusal tests, only after the Windows runner passes commits 1–3.

**Done when**:

- [ ] On the Windows runner: a second same-user client, an unauthenticated client, an oversized frame, and an authentication timeout are refused with the Unix codes; a pre-created pipe name makes the transport refuse.
- [ ] Missing PowerShell 7, enforced transcription, an unprovable ACL, and each policy source give `not configured` with the prerequisite named.
- [ ] macOS and Linux bridge tests are byte-for-byte unchanged in their assertions (SSI-69).

**Tests**: unit, integration, security, e2e
**Gate**: security

---

### Phase 3: Coordination and suspension

#### T5: Strands adapter and coordinated driver

**What**: The coordinated driver and native engine in the application, the Strands engine behind its subpath, the node ledger in the Run record, the dependency addition, and the sealed build change.
**Where**: `packages/application/src/execution/`, `packages/agent-runtime/src/coordination/strands/`, `apps/vestra-cli/src/task/`, `scripts/`
**Depends on**: T3, T4
**Reuses**: `TaskExecutionCoordinator`, `DriverExecutionAdapter`, `runDriverSession`, Run record seal and readers (AD-047, AD-052, AD-061), `ProviderProcesses`
**Requirement**: SSI-01..17, SSI-19, SSI-34, SSI-39..47, SSI-49, SSI-50, SSI-79, SSI-80, SSI-82, SSI-83
**Parallel**: no · **Owner**: yes (D1 before commit 3; D2 before commit 5) · **Platform matrix**: yes

**Commits**:

1. `feat(application): run a coordination plan behind the executor's driver port` — `coordinated-driver.ts`, `coordination-engine.ts` (native engine), `node-result.ts`; scope narrowing, single writer, limits, ledger transitions.
2. `feat(cli): persist the node ledger and node results in the Run record` — sealed `coordination` member, digest-named results, validated readers.
3. `build(deps): add the Strands SDK and Zod to agent-runtime` — exact pins, approved peers, lockfile; dependency-policy test pins the versions.
4. `feat(agent-runtime): add the Strands Graph and Swarm engine` — subpath export, structural agents, Zod decision schemas with a parity test against `node-result.ts`, stable error mapping.
5. `build(release): assert sealed self-containment from the bundle metafile` — per D2; tests for static, dynamic, and `require` externals.
6. `feat(cli): compose coordinated runs` — node driver factory, literal dynamic import for `graph` and `swarm`, cancellation of every node.

**Done when**:

- [ ] The empty-environment child-process probe passes (SSI-79).
- [ ] Architecture tests pin the subpath-only import, the bans, and the main entry free of the SDK (SSI-02, SSI-03, SSI-12, SSI-13).
- [ ] Integration covers order, dependency failure, cancellation, write conflict, valid and forbidden handoff, malformed output, handoff limit, explicit end, and resume replay.
- [ ] Discrimination: removing scope narrowing, the writer mutex, a limit, or the destination check fails a test (SSI-80).
- [ ] Sealed launchers bundle, pass the new check, and the activation health check stays silent; sizes and cold start recorded (SSI-82).

**Tests**: unit, integration, architecture, build, fault
**Gate**: build

---

#### T6: Subscription preflight and suspension

**What**: The billing confirmation, the subscription-only profile, suspension in the executor and run coordinator, resume revalidation, and uncertain-node reconciliation.
**Where**: `apps/vestra-cli/src/task/`, `packages/application/src/execution/`
**Depends on**: T4, T5
**Reuses**: `loadProviderAuth`, `requireCodexSubscription`, `meterOnRunLedger`, `recordingMeter`, `resumable()` worktree reopen
**Requirement**: SSI-32, SSI-33, SSI-39, SSI-51..53, SSI-56, SSI-59..68, SSI-81, SSI-85
**Parallel**: no · **Owner**: yes (D3, D3b, D4) · **Platform matrix**: yes (e2e journeys)

**Commits**:

1. `feat(cli): require subscription auth and an extra-usage confirmation for coordinated runs` — `task-billing.ts`, preflight at start and resume.
2. `feat(application): suspend a run on a quota signal and keep its worktree` — driver status `suspended`, checkpoint `suspended`, outcome `SUSPENDED`, no workflow command.
3. `feat(cli): resume a suspended run and reconcile uncertain nodes` — revalidation, drift check, `--reconcile <digest>`, status of suspension and nodes.

**Done when**:

- [ ] Journeys: missing confirmation, `api-key` provider, Codex credits present, quota mid-graph, resume skipping completed nodes, uncertain node refused then reconciled, drift refused, approval expired while suspended.
- [ ] Budget continuity across suspension proven with a controllable clock (SSI-68).
- [ ] Discrimination: removing the billing block or the uncertain refusal fails a test.
- [ ] `INTERRUPTED` remains terminal; the workflow machine is unchanged (SSI-64).

**Tests**: unit, integration, e2e, fault, security
**Gate**: security

---

### Phase 4: Surface, verification, and the portable record

#### T8: CLI surface and examples

**What**: Plan, status, resume, and cancel presentation for coordinated runs, one example per mode, and the user documentation.
**Where**: `apps/vestra-cli/src/task/`, `docs/`
**Depends on**: T5, T6
**Reuses**: `planSurface`, `statusTask`, `nextActions`, `docs/quick-start.md`
**Requirement**: SSI-29..36
**Parallel**: no · **Owner**: no · **Platform matrix**: yes (e2e)

**Commits**:

1. `feat(cli): present coordinated runs in plan and status` — topology, per-node state, suspension, uncertain nodes, JSON result.
2. `docs(examples): add agent, graph, and swarm Task Requests` — validated by a test that plans each with `--dry-run`.
3. `docs: document coordinated runs, billing confirmation, suspension, and limits` — `docs/quick-start.md`, `README.md`; `pnpm site:check`.

**Done when**:

- [ ] Each example plans with `--dry-run` in a test (SSI-36).
- [ ] JSON and text results agree for plan and status.
- [ ] `pnpm site:check` passes.

**Tests**: e2e
**Gate**: full

---

#### T9: Verification and pilots

**What**: All gates, the independent verification against `spec.md`, the discrimination list, and the owner's pilots per platform.
**Where**: `.specs/features/strands-subscription-integration/`, `docs/qualification/`
**Depends on**: T7, T8
**Reuses**: The `code-review` skill (pinned) with this `.specs` path and the diff base `7e274f2`; the live pilot pre-registration pattern
**Requirement**: SSI-19, SSI-77, SSI-78, SSI-80, SSI-83..85
**Parallel**: no · **Owner**: yes (pilots on Windows, macOS, and Linux with subscriptions only) · **Platform matrix**: yes

**Commits**:

1. `test(specs): record independent verification of the Strands integration` — `validation.md` filled by a verifier who is not the author, with the discrimination results.
2. `docs(qualification): record coordinated-run pilots` — per platform: passed, pending, or `not configured`; never inferred.

**Done when**:

- [ ] `pnpm agent:check`, `pnpm gate:quick`, `pnpm gate:full`, `pnpm gate:build`, and `pnpm gate:security` pass with zero skipped and zero todo.
- [ ] Every SSI row in `validation.md` has file-and-assertion evidence.
- [ ] The discrimination list is killed in full.
- [ ] Pilot results recorded without exhausting any allowance; missing platforms or accounts marked `not configured`.

**Tests**: e2e, security
**Gate**: full

---

#### T10: Handoff

**What**: Canonical documentation, status surfaces, and the portable handoff with the exact next action.
**Where**: `.specs/features/strands-subscription-integration/`
**Depends on**: T9
**Reuses**: `handoff.md` schema `verchestra-feature-handoff/v1`
**Requirement**: SSI-83
**Parallel**: no · **Owner**: yes (human review before merge) · **Platform matrix**: no

**Commits**:

1. `docs(specs): hand off the Strands subscription integration` — `handoff.md` to `verification`, decisions numbered at merge, `.specs/STATE.md` handoff entry.

**Done when**:

- [ ] A clean clone can continue from `handoff.md` without repeating completed work.
- [ ] `pnpm agent:check` passes.

**Tests**: agent-readiness (`pnpm agent:check`)
**Gate**: quick

---

## Phase Execution Map

```
Phase 1 (T1, T2), then Phase 2 (T3, T4, T7 in parallel), then Phase 3 (T5, T6), then Phase 4 (T8, T9, T10)
```

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | One base and one record | ✅ Granular |
| T2 | One documentation commit | ✅ Granular |
| T3 | Three commits: schema, normalizer, plan presentation | ⚠️ Cohesive per commit |
| T4 | Five commits, one per module | ⚠️ Cohesive per commit |
| T5 | Six commits, one per module | ⚠️ Cohesive per commit |
| T6 | Three commits | ⚠️ Cohesive per commit |
| T7 | Four commits, refusal lifted last | ⚠️ Cohesive per commit |
| T8 | Three commits | ⚠️ Cohesive per commit |
| T9 | Two commits | ✅ Granular |
| T10 | One commit | ✅ Granular |

The ⚠️ rows keep the plan's task numbers; each listed commit is one module and
one atomic, independently gated change.

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | start of Phase 1 | ✅ Match |
| T2 | T1 | T1 -> T2 | ✅ Match |
| T3 | T2 (earlier phase) | Phase 2, no intra-phase edge | ✅ Match |
| T4 | T2 (earlier phase) | Phase 2, no intra-phase edge | ✅ Match |
| T7 | T2 (earlier phase) | Phase 2, no intra-phase edge | ✅ Match |
| T5 | T3, T4 (earlier phase) | start of Phase 3 | ✅ Match |
| T6 | T4 (earlier phase), T5 | T5 -> T6 | ✅ Match |
| T8 | T5, T6 (earlier phase) | start of Phase 4 | ✅ Match |
| T9 | T7 (earlier phase), T8 | T8 -> T9 | ✅ Match |
| T10 | T9 | T9 -> T10 | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | none | none | none | ✅ OK |
| T2 | specs only | agent-readiness | agent-readiness | ✅ OK |
| T3 | schemas, application, CLI | contract, unit, integration | contract, unit, integration | ✅ OK |
| T4 | domain, drivers, agent-runtime | unit, contract, integration, security | unit, contract, integration, security | ✅ OK |
| T5 | application, adapter, Run record, build | unit, integration, architecture, build, fault | unit, integration, architecture, build, fault | ✅ OK |
| T6 | application, CLI | unit, integration, e2e, fault, security | unit, integration, e2e, fault, security | ✅ OK |
| T7 | agent-runtime, platform-node, drivers | unit, integration, security, e2e | unit, integration, security, e2e | ✅ OK |
| T8 | CLI, docs | e2e, site | e2e (and `site:check` in Done when) | ✅ OK |
| T9 | specs, qualification | e2e, security | e2e, security | ✅ OK |
| T10 | specs only | agent-readiness | agent-readiness | ✅ OK |
