# Strands Subscription Integration Specification

An optional coordination module built on the Strands Agents SDK runs one
governed task as a single agent, a Graph, or a Swarm of Claude Code and Codex
sessions, on the owner's existing subscriptions only. Requirements SSI-01..85.
Evidence for every fact cited here is in `research.md`.

## Problem Statement

A governed task today runs exactly one implementer session (Claude Code) and one
independent verifier (Codex). Work that benefits from several cooperating
sessions — a planner before a writer, readers that review a writer's change, a
swarm that hands work between specialists — cannot be expressed, and running it
outside Verchestra would bypass approval, mediated tools, budgets, evidence,
gates, and independent verification. The owner wants that coordination inside
the governed path, using only the Claude and ChatGPT subscriptions already paid
for: no API key, no extra purchase, no automatic credit use, and no paid
fallback. When a subscription's allowance runs out, the run must stop safely and
continue only when the owner resumes it.

## Owner Decisions (binding)

From the owner's approved plan:

- Strands is an optional coordination module with three modes: single agent,
  Graph, and Swarm. Verchestra keeps authorization, tools, budgets, isolation,
  evidence, gates, and independent verification.
- Dependencies `@strands-agents/sdk` exactly 1.19.0 and `zod` exactly 4.6.5 are
  approved. Optional provider SDKs are not added.
- No native Strands model is instantiated; every node delegates to the existing
  Claude Code or Codex driver.
- Task Request v2 adds a declarative execution descriptor; v1 keeps its reading
  and behaviour. Authentication, credentials, and billing stay machine-local.
- The CLI is extended; no second `workflow` command set is created.
- Writer nodes are Claude Code through the existing mediation; Codex nodes are
  read-only; the final Codex verifier stays separate.
- Subscription authentication only; an owner-confirmed "extra usage is off"
  precondition; suspension and manual resume on quota exhaustion; `INTERRUPTED`
  is not a resumable state.
- A Windows bridge transport over a named pipe with a PowerShell 7 helper; the
  current Windows refusal stays until that transport is tested.
- The product stays `0.0.0-qualification`; this work is not a promotion to
  `1.0.0`.

## Vocabulary

- **Execution descriptor:** the `execution` member of a v2 Task Request: mode,
  nodes, edges or handoffs, and limits.
- **Coordination plan:** the vendor-neutral normalized form of a descriptor,
  every limit explicit, bound by the approval.
- **Node:** one governed provider session inside a task. A **writer node** is a
  Claude Code node with a non-empty write scope; every other node is a **reader
  node**. A Codex node is always a reader.
- **Structural agent:** an object the adapter builds that satisfies the SDK's
  `InvokableAgent` shape and delegates to Verchestra's node runner. It is never
  a Strands `Agent`.
- **Coordinated driver:** the implementation of the executor's driver port that
  runs a coordination plan inside the task's single executor run.
- **Node result:** a node's bounded structured output, validated, digested, and
  persisted in the Run record. A swarm node's result includes its **handoff
  decision**.
- **Node ledger:** the per-run durable record of every node visit: pending,
  started, completed, failed, partial, or uncertain.
- **Extra-usage confirmation:** a machine-local, owner-written statement that
  paid usage beyond the subscription allowance is disabled for one provider and
  one authentication method.
- **Suspension:** a checkpointed stop with no active worker, entered on a
  trusted quota signal, left only through `vestra task resume`. It is not a
  workflow state.

## Goals

- [ ] A v2 request of each mode plans, is approved once, and runs every node
      through the existing governed executor, with its evidence in the Run record.
- [ ] Every v1 request, and every Run record written before this feature,
      behaves exactly as before.
- [ ] No node can authenticate with an API key or consume paid usage the owner
      has not confirmed is off; quota exhaustion suspends and preserves work.
- [ ] Every new check has a discrimination test that fails when the check is
      removed.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Native Strands models, model routers, MCP clients, vended tools, sandboxes, sessions, memory, A2A, and telemetry exporters | Every node must go through a governed driver; these would bypass it (SSI-03). |
| Codex writer nodes | The plan keeps Codex read-only; Codex has no mediated write path. |
| Parallel writers, nested orchestrators, and conditional edges | One writer per worktree; routing code is not declarative and could not be approved by digest. |
| Automatic retry, automatic repair cycles, and automatic resumption at a reset time | Resumption is a human decision; invalid output fails. |
| API-key or paid fallback, buying credits, switching accounts or models | Forbidden by the owner's constraint. |
| Changes to the project task scheduler or multi-task runs | Coordination stays inside one task. |
| Windows support beyond the bridge transport (other Windows gaps, WSL) | Separate qualification work. |
| Exhausting a subscription to produce evidence | The plan forbids it; suspension is qualified with fakes. |
| A release, a promotion, or a change of the release decision | Governed by `docs/qualification/RELEASE-DECISION-CONTRACT.md`. |
| The skills `tlc-plan`, `implement-spec`, `handoff`, `grill-with-docs`, `spec-driven-eval`, `harness-eval` | Excluded by the plan; they compete with `.specs` or are separate evaluations. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded with a default. On 2026-10-03 the owner
delegated these decisions to the coordinating agent session (the owner's words,
translated from Portuguese: "do all of this, I trust you more"). The coordinator
accepted the chosen defaults of D1–D7 and D9 as written below. D8 stays pending: the `setup-matt-pocock-skills` skill
requires the owner to see and edit the draft before anything is written, and a
delegation does not satisfy that. The extra-usage confirmation of D3 is, by
design, the owner's own act on the machine before the first run.

On 2026-10-04, under the same delegation, the coordinating agent session
accepted two more items that the independent verification asked the owner to
decide: D1b (the exact set of packages D1 brought into the lockfile) and D10
(the v1 behaviour change of AD-080 item 5). The owner has not seen either.
Like D1–D7 and D9, they are approvals by delegation, not by the owner in
person, and each awaits the owner's own confirmation at human review, before
merge of anything that depends on it. D11 is the one question the
verification left open; it keeps its default until the owner decides it.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| D1. The SDK's required peers `@modelcontextprotocol/sdk` (1.32.0 today, with an Express/Hono tree of about 30 new packages) and `@opentelemetry/api` (1.9.1, already locked), and the version moves of `@aws-sdk/client-bedrock-runtime` and `yaml` | T5 does not start until the owner approves them; once approved, the two peers are pinned exactly beside the SDK | They are non-optional peers and the MCP SDK is needed to bundle `./multiagent` (`research.md` F3); the owner approved only two packages | y (2026-10-03, delegated) |
| D1b. The packages D1 actually brought into `pnpm-lock.yaml` (T5 commit 3): 36 package versions added, 0 removed, no existing version moved; the MCP SDK's Express 5 and Hono tree, `@aws-sdk/client-bedrock-runtime` 3.1146.0 with `@aws-sdk/token-providers` 3.1146.0 beside the versions already locked, and `yaml` 2.9.1; none declares an install script | Accept the set as locked, each reachable only from the four exact pins | Reviewed entry by entry in `validation.md` "T5 Evidence", commit 3; pinned by `tests/agent-readiness/dependency-policy.test.mjs`; the verifications found D1's acceptance delegated, not the owner's (`validation.md` "Independent Verification (T9)", finding 17) | y (2026-10-04, delegated; awaits the owner's confirmation at human review) |
| D2. The sealed build's self-containment check fails on a string literal inside the SDK | Replace the text scan with an assertion over esbuild's metafile; accept about 1.45 MiB more per launcher | Exact rather than textual, so equal or stronger; the alternative leaves Graph and Swarm unusable in a sealed release (`research.md` F2) | y (2026-10-03, delegated) |
| D3. Format and scope of the extra-usage confirmation | A machine-local `task-billing.json` beside `task-providers.json`, one entry per provider naming the authentication method and, for Codex, the plan type; no expiry; any change of method, plan type, or billing regime requires re-confirmation | Mirrors the existing machine-local provider setting; binds to what the run can verify | y (2026-10-03, delegated) |
| D3b. A Codex account that reports a credit balance or unlimited credits | Block the run as `not configured` | Pre-purchased credits would be consumed after the allowance, which the owner forbids | y (2026-10-03, delegated) |
| D4. Reconciling an uncertain or partial node | `vestra task resume --reconcile <digest>` re-runs that one node after the owner types back the digest of its uncertainty record; otherwise only `task cancel` | Never repeats an effect silently; matches the typed-back human decisions of AD-040 | y (2026-10-03, delegated) |
| D5. Mode `agent` | Runs through Verchestra's native single-node engine without loading the SDK | Strands adds no coordination for one node, and the SDK is then loaded only for Graph and Swarm | y (2026-10-03, delegated) |
| D6. Windows prerequisites | PowerShell 7 at a pinned absolute path is required on Windows; AD-039's Windows clause is superseded only when T7 qualifies | The plan names PowerShell 7; Node cannot set a pipe DACL itself | y (2026-10-03, delegated) |
| D7. Threat-model assumptions (single owner machine, same-user processes out of scope, repository content and model output hostile) | As listed in `threat-model.md` | The skill's interactive check-in could not run inside this task | y (2026-10-03, delegated) |
| D8. `setup-matt-pocock-skills` configuration | Nothing written; `setup-draft.md` holds the draft for the owner to edit | The skill requires review before writing | pending: owner review of `setup-draft.md` |
| D9. Anthropic resumes its paused Agent SDK billing change | Treat `claude -p` usage as plan usage per the page updated 2026-06-16; a regime change requires re-confirmation (D3) | The cited page says the change is paused (`research.md` F7) | y (2026-10-03, delegated) |
| D10. AD-080 item 5, a change to every v1 run on every platform: `task start` and `task resume` refuse a state root too deep for Git's path limit as `not configured` (`state-path-length`) before the run is read, and the verification scratch checkouts move from `verification/<run ID>/review` and `/mutations` to `verification/<16 hex of the run ID's digest>/r` and `/m` | Accept both on every platform, as an exception to SSI-83 | Git refuses a worktree whose `.git` path passes PATH_MAX − 40 bytes (215 bytes for the directory on Windows); the shorter layout keeps verification within it, one layout on every platform keeps the macOS and Linux journeys exercising it, and the refusal comes before any effect instead of inside Git after the run's first transition (AD-080 item 5); documented in `docs/quick-start.md` | y (2026-10-04, delegated; awaits the owner's confirmation at human review) |
| D11. A v1 verifier on a subscription and Codex credits | Unchanged: a v1 verifier keeps the T04 conversation, reads no Codex account, and can spend Codex credits at verification | SSI-83 keeps every v1 run as before, and the check needs the 0.159.3 floor a v1 verifier does not require (AD-076, AD-082 item 1) | pending: owner decision (`validation.md` "Remediation R1") |
| Claude Code's `stream-json` result carries `structured_output` | Assumed from the SDK result type; T4 confirms it with a recorded fixture and an owner-run probe before relying on it | Documented for `--output-format json` and the SDK message type | n |
| Codex minimum version | Raised in T4 to the first version whose generated App Server protocol has `outputSchema`, `account/read`, and `account/rateLimits/read` | Present in 0.159.3; the repository pins 0.115.0 | n |
| Concurrency above 1 | Only reader nodes can run together, because writers are totally ordered | Single writer per worktree | y |
| Graph node identifiers | `^[a-z][a-z0-9-]{0,31}$`; the token `<complete>` is reserved for the swarm completion value and cannot collide | Short, stable, safe in tokens and logs | y |
| New failure codes | Travel as the `reason` of existing public codes (`VES_TASK_FAILED`, `VES_TASK_NOT_CONFIGURED`, `VES_TASK_REQUEST_REJECTED`), so the public error catalogs keep their counts | The catalogs are counted; any new public code needs explicit approval | y |

**Open questions:** none without a chosen default. Status on 2026-10-04: D1–D7,
D9, D1b, and D10 are accepted by delegation and await the owner's own
confirmation at human review; D8 waits for the owner's review of
`setup-draft.md`; D11 waits for the owner's decision and keeps its default
until then. The two "n" rows stand as recorded: the live `structured_output`
shape waits for the owner-run probe, and the Codex floor is 0.159.3 for the
sessions that use the newer protocol only (AD-076).

---

## User Stories

### P1: The SDK runs only as a coordinator ⭐ MVP

**User Story**: As the owner, I want Strands to order my nodes while every node
remains a governed Claude Code or Codex session, so that the SDK can never call
a model, read a credential, or run a tool on its own.

**Why P1**: It is the safety premise of the integration.

**Acceptance Criteria**:

1. The coordination adapter SHALL depend on `@strands-agents/sdk` at exactly 1.19.0 and `zod` at exactly 4.6.5, with every transitive package pinned in `pnpm-lock.yaml`. (SSI-01)
2. The coordination adapter SHALL import the SDK only through the `@strands-agents/sdk/multiagent` subpath. (SSI-02)
3. The coordination adapter SHALL never construct a Strands `Agent`, a Strands model, a model router, a session manager, an MCP client, a sandbox, a vended tool, or a telemetry exporter. (SSI-03)
4. WHEN a Graph or Swarm runs THEN every node SHALL be a structural agent that delegates its work to Verchestra's node runner. (SSI-04)
5. The adapter SHALL leave `preserveContext` unset on every node, and resumption SHALL use Verchestra's node ledger and checkpoints, never a Strands session manager or snapshot. (SSI-05)
6. WHEN a structural agent runs THEN it SHALL ignore the input the SDK assembled and build the provider prompt only from the approved plan, the node results the node declares as inputs, and the bounded handoff message. (SSI-06)
7. The content a structural agent returns to the SDK SHALL be one text block naming the node result's payload reference, never provider output text. (SSI-07)
8. IF a structural agent fails THEN the error it raises to the SDK SHALL carry only a stable `VES_*` code. (SSI-08)
9. WHEN the adapter builds a Graph or Swarm THEN it SHALL set finite concurrency, step, invocation-timeout, and node-timeout values derived from the approved limits and the remaining duration budget. (SSI-09)
10. IF the SDK reports a node or run status of `INTERRUPTED`, or throws, THEN the adapter SHALL map it to a coordination failure with a stable code and never to a Verchestra workflow state. (SSI-10)

**Independent Test**: A scripted Graph and Swarm run in a child process with an
empty environment completes with structural agents only, and the probe records
no Bedrock client, credential variable, network connection, or SDK-spawned process.

---

### P1: Coordination stays inside the governed executor ⭐ MVP

**User Story**: As the owner, I want each node to run through the executor that
already governs my task, so that scopes, protected paths, grants, receipts,
budgets, and cancellation apply to every node.

**Why P1**: Without it the integration is a bypass.

**Acceptance Criteria**:

1. The Task Request v2 contract, the coordination plan, the node-result and handoff contracts, and the coordinated driver SHALL name no SDK, no schema library, and no provider SDK. (SSI-11)
2. The only modules that import `@strands-agents/sdk` or `zod` SHALL live under `packages/agent-runtime/src/coordination/strands/` and SHALL be reachable only through the `@verchestra/agent-runtime/strands-coordination` subpath. (SSI-12)
3. The `@verchestra/agent-runtime` main entry, the sealed launcher's static imports, and every command other than a task run of a `graph` or `swarm` plan SHALL NOT load the SDK. (SSI-13)
4. WHEN a task run executes a `graph` or `swarm` plan THEN the composition root SHALL load the adapter with one literal dynamic import and inject a node driver factory built from the existing drivers. (SSI-14)
5. WHEN any node runs THEN its provider session SHALL execute inside the task's single `TaskExecutionCoordinator.execute` call, its tool effects SHALL pass the executor's scope, protected-path, capability-grant, and tool-effect authority checks, its usage SHALL reach the run's budget meter, and its cancellation SHALL follow the executor's signal. (SSI-15)
6. The coordination SHALL run inside one task, and the project task scheduler and the one-task-per-run `vestra task` flow SHALL be unchanged. (SSI-16)
7. Each node SHALL keep its concrete provider identity, `claude-code` or `codex`, in its Passport, its usage events, and its records, and Strands SHALL never appear as a provider, a Passport, or an authentication mode. (SSI-17)
8. WHERE a node's driver is `codex` the node SHALL be a reader with an empty write scope. (SSI-18)
9. The final verification SHALL stay the existing independent Codex verifier on its own scratch checkout, and no node's output SHALL count as verification of the task. (SSI-19)

**Independent Test**: A fake two-node graph whose writer asks for a path outside
its node scope is refused before the executor; one asking for a protected path
inside its node scope is refused by the executor; usage from both nodes appears
once on the run's ledger.

---

### P1: Task Request v2 is approved as a whole and v1 is unchanged ⭐ MVP

**User Story**: As the owner, I want to describe the topology declaratively and
approve exactly what will run, while my existing v1 requests keep working.

**Why P1**: Approval by digest is the authority model.

**Acceptance Criteria**:

1. The canonical contract SHALL be `schemas/task-request/2.schema.json` with generated types produced by the contract generator, and `schemas/task-request/1.schema.json` SHALL stay byte-identical. (SSI-20)
2. WHEN a v1 request is planned THEN its normalized form, its execution-contract digest, and its approval binding SHALL equal those produced before this feature for the same input and context. (SSI-21)
3. WHEN a plan record or Run record written before this feature is loaded THEN it SHALL validate and continue exactly as before. (SSI-22)
4. WHEN a v2 request is normalized THEN the result SHALL contain the complete execution descriptor with every limit explicit at its effective value. (SSI-23)
5. IF a v2 request carries any member outside the schema, including an authentication mode, a credential, a billing mode, an executable path, or an endpoint, THEN normalization SHALL reject it with `VES_TASK_REQUEST_INVALID`. (SSI-24)
6. IF a graph has a cycle, an edge or input naming an unknown node, a node unreachable from a source, or an input that is not an ancestor of its node THEN normalization SHALL reject the request with `VES_TASK_REQUEST_EXECUTION_INVALID` before any process starts. (SSI-25)
7. IF a node scope leaves the task's change scope, a write scope covers a protected path, a `codex` node declares a write scope, two writer nodes are not ordered by a path, or no node writes THEN normalization SHALL reject the request with `VES_TASK_REQUEST_EXECUTION_INVALID`. (SSI-26)
8. IF a swarm's start node is unknown, a handoff names an unknown node or the node itself, or a swarm node declares inputs THEN normalization SHALL reject the request with `VES_TASK_REQUEST_EXECUTION_INVALID`. (SSI-27)
9. WHEN any element of the normalized descriptor changes — mode, node identifier, driver, model, instructions, description, scope, input, edge, start, handoff target, or limit — THEN the approval binding digest SHALL change. (SSI-28)
10. WHEN `task start` or `task resume` runs THEN it SHALL execute the descriptor sealed in the plan record, proven against the approved package digest, and never re-read the request file. (SSI-29)

**Independent Test**: Golden v1 fixtures keep their digests; mutating each v2
field in turn changes the binding digest; each rejection case returns its code
with no Run directory created.

---

### P1: The existing task commands cover the new modes ⭐ MVP

**User Story**: As the owner, I want `plan`, `start`, `status`, `resume`,
`cancel`, and `review` to handle coordinated runs, so that I learn no second
command set.

**Why P1**: It is the only way to drive the feature.

**Acceptance Criteria**:

1. WHEN `vestra task plan` reads a v2 request THEN its result SHALL present the mode, every node with driver, model, role, read scope, and write scope, the edges or handoff targets, the effective limits, and the subscription preconditions. (SSI-30)
2. The `task` command set SHALL gain no new top-level command, and plan, approve, start, status, resume, cancel, and review SHALL accept v1 and v2 runs. (SSI-31)
3. WHEN `vestra task status` reads a v2 run THEN it SHALL report each node's state, visit count, and result digest, the suspension reason and provider-reported reset time when suspended, and every uncertain node. (SSI-32)
4. WHEN `vestra task resume` runs THEN it SHALL revalidate the approval, the Workspace policy view, the workflow state, the subscription preconditions, the extra-usage confirmation, and the worktree change digest before any node starts. (SSI-33)
5. WHEN `vestra task cancel` runs on an active v2 run THEN every running node's provider process tree SHALL be terminated and the run SHALL end `ABORTED`. (SSI-34)
6. The `vestra task review` decision SHALL stay the existing typed-back human decision over the same review surface. (SSI-35)
7. The repository SHALL ship one example request per mode, and a test SHALL plan each with `--dry-run`. (SSI-36)

**Independent Test**: The three examples plan with `--dry-run`; a fake swarm run
reports per-node status; cancelling it leaves no provider process alive.

---

### P1: Limits, results, and handoffs are bounded and enforced ⭐ MVP

**User Story**: As the owner, I want every node result, transition, and writer
to be bounded and checked by Verchestra, so that a model cannot grow, redirect,
or escalate a run.

**Why P1**: The SDK enforces none of these per node (`research.md` F5, F6).

**Acceptance Criteria**:

1. The default limits SHALL be concurrency 1, 64 graph nodes, 128 graph edges, 8 swarm agents, 32 swarm handoffs, 64 KiB of materialized result per node, and 256 KiB of materialized results per run. (SSI-37)
2. WHERE a request raises a limit the raise SHALL be explicit in the descriptor, bound by the approval, and no higher than the hard ceilings of concurrency 4, 256 nodes, 512 edges, 16 agents, 128 handoffs, 256 KiB per node, and 1 MiB per run. (SSI-38)
3. The task's declared duration and token budgets SHALL bound all nodes together, with usage accumulated across nodes and across resumes. (SSI-39)
4. WHILE a writer node runs, no other writer node of the run SHALL run. (SSI-40)
5. WHEN a node requests a write or delete THEN the coordinated driver SHALL refuse a target outside the node's write scope before the request reaches the executor. (SSI-41)
6. WHEN a node reads through the bridge THEN its read tools SHALL be confined to the node's read scope; WHEN a Codex node reads through its own sandbox THEN its working directory SHALL be a read-only copy of its read scope alone, bounded by the bridge's read limits and removed when the node ends, and any read outside that copy, by an absolute path, by a relative path through `..`, or by a path built from the session's `HOME` or `CODEX_HOME`, is an accepted residual risk (TM-004). (SSI-42) (amended 2026-10-04: a Codex node reads through its own sandbox, not the bridge, and the copy changes where it starts reading, not what it can read, see validation.md "Remediation R2", "Remediation R4", and "Delta verification of R4")
7. WHEN a swarm node finishes THEN its handoff decision SHALL be validated against a closed schema whose target enum lists only that node's declared destinations and the reserved completion value. (SSI-43)
8. IF a swarm node's decision names an undeclared destination, is malformed, or is missing THEN the node SHALL fail and the swarm SHALL end failed with no repair cycle. (SSI-44)
9. WHEN a swarm reaches its handoff limit with a handoff pending THEN the run SHALL fail with `VES_COORDINATION_HANDOFF_LIMIT`. (SSI-45)
10. IF a node's structured result fails the node-result schema THEN the node SHALL fail with `VES_COORDINATION_RESULT_INVALID` and Verchestra SHALL start no repair cycle. (SSI-46)
11. IF a node result exceeds the per-node limit, or would take the run past the per-run limit, THEN it SHALL be refused before it is persisted and the node SHALL fail with `VES_COORDINATION_RESULT_TOO_LARGE`. (SSI-47)
12. The driver port SHALL carry a node's structured result only as a payload reference to bytes the controller has bounded and digested. (SSI-48)
13. Persisted node results and the node ledger SHALL contain no provider session, credential, unbounded provider output, environment value, or machine-local path. (SSI-49)
14. WHEN a node receives an earlier node's result or a handoff message THEN its prompt SHALL present that text as untrusted data, and its tools, scopes, and limits SHALL come only from the approved plan. (SSI-50)

**Independent Test**: Fake drivers return an oversized result, an undeclared
destination, a malformed decision, and an endless handoff loop; each ends with
its code and nothing beyond the limit is persisted.

---

### P1: Subscriptions only, with suspension and manual resume ⭐ MVP

**User Story**: As the owner, I want runs to use only my subscriptions and to
stop, preserving their work, when an allowance is exhausted, so that I am never
billed beyond my plan and lose nothing.

**Why P1**: It is the owner's mandatory constraint.

**Acceptance Criteria**:

1. WHEN a v2 run starts or resumes THEN every provider it uses, nodes and verifier, SHALL be configured as `subscription` in `task-providers.json`, and IF any is `api-key` THEN the run SHALL be `not configured` with no workflow change. (SSI-51)
2. WHEN a v2 run starts or resumes THEN an extra-usage confirmation SHALL exist for every provider the run uses, naming that provider and its effective authentication method, and IF it is absent, malformed, or names another method or plan type THEN the run SHALL be `not configured`. The plan type SHALL be one of the plan types the Codex App Server protocol names, other than `unknown`, and WHEN a v2 run starts or resumes THEN the plan type the Codex account reports SHALL equal it. (SSI-52) (amended 2026-10-04: the plan type is a closed value compared with the account at `start` and `resume`, see validation.md "Remediation R1", finding 2)
3. The extra-usage confirmation SHALL contain no token, account identifier, e-mail address, personal name, or path. (SSI-53)
4. WHEN a Claude Code session initializes THEN its reported `apiKeySource` SHALL be `none`, and IF it is not THEN the session SHALL fail with `VES_CLAUDE_AUTH_METHOD_MISMATCH` before any tool effect. (SSI-54)
5. WHEN a Codex node session, or the verifier session of a v2 run, starts THEN the driver SHALL require `account/read` to report an account of type `chatgpt`, and IF it does not THEN the session SHALL fail with `VES_CODEX_AUTH_METHOD_MISMATCH` before the turn starts. (SSI-55) (amended 2026-10-04: the v2 verifier is checked as a node is, decision D3b, see validation.md "Remediation R1", finding 1)
6. IF a Codex rate-limit snapshot of a node or of the verifier of a v2 run reports a credit balance or unlimited credits THEN that session SHALL not start its turn and the run SHALL be `not configured` with `VES_CODEX_CREDITS_PRESENT`. (SSI-56) (amended 2026-10-04: the v2 verifier's credits block the run as a node's do, decision D3b, see validation.md "Remediation R1", finding 1)
7. The drivers SHALL never call a provider method that buys, consumes, or advertises credits, and SHALL never pass an API key, an API-key helper, or a fallback model. (SSI-57)
8. WHEN Claude Code reports a `rate_limit_event` with status `rejected`, or Codex reports `usageLimitExceeded`, a usage-limit or credits-depleted `rateLimitReachedType`, or `ordinaryUsageAllowed: false`, THEN the driver SHALL emit `quota.exhausted` carrying a reset time only if the provider reported one. (SSI-58)
9. WHEN a node reports `quota.exhausted` THEN the coordinated driver SHALL start no new node, cancel every running node, and suspend the run. (SSI-59)
10. WHEN a run suspends THEN completed node results, receipts, the budget ledger, and the node ledger SHALL be persisted, the worktree SHALL be preserved, the writer lease and the active-process claim SHALL be released, and the workflow state SHALL stay `IMPLEMENTING`, or `VERIFYING` when the verifier's session raised the signal. (SSI-60) (amended 2026-10-04: a v2 verifier's quota signal or credits suspend the run at `VERIFYING`, see validation.md "Remediation R1", finding 1)
11. The suspension record SHALL hold only a reason code, the provider, the time of suspension, and, when the provider reported them, its limit window in a closed grammar and its reset time. (SSI-61) (amended 2026-10-04: the record also keeps the provider's limit-window `scope`, see validation.md "Delta verification of R4")
12. WHILE a run is suspended, Verchestra SHALL NOT switch account, provider, model, or authentication mode, and SHALL NOT retry on its own. (SSI-62)
13. The system SHALL continue a suspended run only through `vestra task resume`. (SSI-63)
14. The workflow state `INTERRUPTED` SHALL stay terminal, and suspension SHALL NOT add or reuse a workflow state. (SSI-64)
15. WHEN a run resumes THEN a completed node SHALL NOT start a provider session again and its persisted result SHALL be reused. (SSI-65)
16. IF a node started and has no recorded end, or ended without a result after one of its effects landed, THEN resume SHALL refuse with `VES_TASK_NODE_UNCERTAIN` until the owner reconciles that node by typing back the digest of its uncertainty record. (SSI-66)
17. WHEN a node ended without a result and without a landed effect — no receipt and an unchanged change digest — THEN resume SHALL run it again and record that it did. (SSI-67)
18. The budget meter SHALL count no time while a run is suspended and SHALL report subscription usage as not billed. (SSI-68)

**Independent Test**: A fake Claude stream emits `rate_limit_event` rejected in
the second of three graph nodes; the run suspends with the first node's result
and receipts kept; resume without confirmation is `not configured`; resume with
it skips the first node and re-runs the second.

---

### P2: Windows runs through a protected named pipe

**User Story**: As the owner on Windows, I want the mediated bridge to work over
a channel only my user can open, so that I can run coordinated tasks there
without weakening isolation.

**Why P2**: macOS and Linux deliver the feature first; Windows needs its own
qualification.

**Acceptance Criteria**:

1. The mediated bridge on macOS and Linux SHALL keep its Unix socket channel and controls unchanged. (SSI-69)
2. The bridge controller SHALL accept its channel through a transport interface with a Unix socket implementation and a Windows named-pipe implementation. (SSI-70)
3. WHERE the platform is Windows the transport SHALL create a named pipe with a fresh random name per run through a PowerShell 7 helper at a pinned absolute path that owns a `NamedPipeServerStream` with `CurrentUserOnly`, first-instance, and one-instance options and relays bytes to the controller over its standard streams. (SSI-71)
4. The helper SHALL run a constant script whose only argument is the validated pipe name and SHALL never interpolate agent content into a command. (SSI-72)
5. IF PowerShell 7 is absent, script-block logging or transcription is enabled, the per-run directory's ACL cannot be proven owner-only, or a Claude Code managed-policy source is present THEN the Windows run SHALL be `not configured` with a diagnostic naming the missing prerequisite. (SSI-73)
6. WHERE the platform is Windows the managed-policy check SHALL cover the `C:\Program Files\ClaudeCode\` directory, `HKLM\SOFTWARE\Policies\ClaudeCode`, and `HKCU\SOFTWARE\Policies\ClaudeCode`. (SSI-74)
7. WHEN a Windows run ends THEN the parent SHALL terminate the helper's and Claude Code's process trees and remove the per-run directory. (SSI-75)
8. IF a second client connects, a client fails authentication, authentication times out, or a frame exceeds its bound THEN the Windows transport SHALL refuse with the codes the Unix transport uses. (SSI-76)
9. The refusals `VES_BRIDGE_PLATFORM_UNSUPPORTED`, `VES_CLAUDE_MEDIATION_UNSUPPORTED`, and the `vestra task` platform refusal SHALL stay until the Windows transport passes its qualification on a Windows runner. (SSI-77)

**Independent Test**: On a Windows runner, a second process of the same user and
a process of another user both fail to open the pipe; a missing PowerShell 7 is
reported `not configured`.

---

### P1: Tests, qualification, and delivery ⭐ MVP

**User Story**: As the owner, I want evidence for every requirement and proof
that the tests would catch a removed check, so that I can review the
integration without trusting its author.

**Why P1**: Required by the repository's definition of done.

**Acceptance Criteria**:

1. Automated tests SHALL use fakes and fixtures only, a live provider test SHALL be separate and owner-run, and a missing provider SHALL be reported `not configured`, never as a pass. (SSI-78)
2. A test SHALL prove that a scripted Graph and Swarm run in a child process with an empty environment constructs no Bedrock client, reads no credential variable, opens no network connection, and spawns no process through the SDK. (SSI-79)
3. For the approval binding, each limit, the destination check, the scope narrowing, the single-writer rule, the authentication-method checks, and the billing block, a discrimination test SHALL show the suite fails when that check is removed. (SSI-80)
4. Logs, payloads, checkpoints, Run records, and tracked artifacts SHALL contain no token, session, personal data, or private path, and a security test SHALL assert it for every new record. (SSI-81)
5. The sealed candidate build SHALL stay self-contained with the adapter in its closure, and the activation health check SHALL stay silent and within its timeout. (SSI-82)
6. The integration SHALL be opt-in, so a v1 request and every command other than a v2 `graph` or `swarm` run SHALL behave as before; a v1 verifier SHALL read no Codex account, and a usage limit it meets SHALL fail the run, never suspend it. (SSI-83) (amended 2026-10-04: a v1 verifier's usage limit fails the run as before, see validation.md "Remediation R4"; the `state-path-length` refusal and the verification scratch layout of AD-080 item 5 are the one change every v1 run gets, accepted by delegation as decision D10)
7. Qualification SHALL record agent, Graph, and Swarm pilots on Windows, macOS, and Linux with subscription authentication only, and a missing platform or account SHALL be recorded as `not configured` or pending, never as passed. (SSI-84)
8. Quota suspension SHALL be qualified with deterministic fakes, and no pilot SHALL exhaust a subscription on purpose. (SSI-85)

**Independent Test**: `pnpm gate:full`, `gate:build`, and `gate:security` pass;
the mutation list in `validation.md` is killed in full.

---

## Edge Cases

- IF a writer node's session dies after some writes landed THEN the node SHALL be recorded partial and resume SHALL require reconciliation (SSI-66).
- IF the worktree's change digest differs from the suspended checkpoint's on resume THEN resume SHALL fail closed with `VES_EXECUTOR_WORKTREE_DRIFT` (SSI-33).
- IF the approval expires while a run is suspended THEN resume SHALL refuse and the owner SHALL plan again (SSI-33).
- WHEN a Claude `rate_limit_event` reports `allowed_warning` THEN the run SHALL record a warning and continue (SSI-58).
- IF two quota signals arrive from concurrent reader nodes THEN the run SHALL suspend once, recording the first (SSI-59, SSI-61).
- IF a swarm revisits a node THEN each visit SHALL have its own ledger entry and result, all counted against the run's result limit (SSI-37, SSI-47).
- IF Claude Code returns `success` with no `structured_output`, or `error_max_structured_output_retries`, THEN the node SHALL fail with `VES_COORDINATION_RESULT_INVALID` (SSI-46).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SSI-01 | P1: SDK runs only as a coordinator | T5 | Pending |
| SSI-02 | P1: SDK runs only as a coordinator | T5 | Pending |
| SSI-03 | P1: SDK runs only as a coordinator | T5 | Pending |
| SSI-04 | P1: SDK runs only as a coordinator | T5 | Pending |
| SSI-05 | P1: SDK runs only as a coordinator | T5 | Pending |
| SSI-06 | P1: SDK runs only as a coordinator | T5 | Pending |
| SSI-07 | P1: SDK runs only as a coordinator | T5 | Pending |
| SSI-08 | P1: SDK runs only as a coordinator | T5 | Pending |
| SSI-09 | P1: SDK runs only as a coordinator | T5 | Pending |
| SSI-10 | P1: SDK runs only as a coordinator | T5 | Pending |
| SSI-11 | P1: Coordination inside the executor | T3, T5 | Pending |
| SSI-12 | P1: Coordination inside the executor | T5 | Pending |
| SSI-13 | P1: Coordination inside the executor | T5 | Pending |
| SSI-14 | P1: Coordination inside the executor | T5 | Pending |
| SSI-15 | P1: Coordination inside the executor | T5 | Pending |
| SSI-16 | P1: Coordination inside the executor | T5 | Pending |
| SSI-17 | P1: Coordination inside the executor | T4, T5 | Pending |
| SSI-18 | P1: Coordination inside the executor | T3, T5 | Pending |
| SSI-19 | P1: Coordination inside the executor | T5, T9 | Pending |
| SSI-20 | P1: Task Request v2 | T3 | Pending |
| SSI-21 | P1: Task Request v2 | T3 | Pending |
| SSI-22 | P1: Task Request v2 | T3 | Pending |
| SSI-23 | P1: Task Request v2 | T3 | Pending |
| SSI-24 | P1: Task Request v2 | T3 | Pending |
| SSI-25 | P1: Task Request v2 | T3 | Pending |
| SSI-26 | P1: Task Request v2 | T3 | Pending |
| SSI-27 | P1: Task Request v2 | T3 | Pending |
| SSI-28 | P1: Task Request v2 | T3 | Pending |
| SSI-29 | P1: Task Request v2 | T3, T8 | Pending |
| SSI-30 | P1: Task commands | T8 | Pending |
| SSI-31 | P1: Task commands | T8 | Pending |
| SSI-32 | P1: Task commands | T6, T8 | Pending |
| SSI-33 | P1: Task commands | T6 | Pending |
| SSI-34 | P1: Task commands | T5, T8 | Pending |
| SSI-35 | P1: Task commands | T8 | Pending |
| SSI-36 | P1: Task commands | T8 | Pending |
| SSI-37 | P1: Limits and results | T3 | Pending |
| SSI-38 | P1: Limits and results | T3 | Pending |
| SSI-39 | P1: Limits and results | T5, T6 | Pending |
| SSI-40 | P1: Limits and results | T5 | Pending |
| SSI-41 | P1: Limits and results | T5 | Pending |
| SSI-42 | P1: Limits and results | T5 | Pending |
| SSI-43 | P1: Limits and results | T5 | Pending |
| SSI-44 | P1: Limits and results | T5 | Pending |
| SSI-45 | P1: Limits and results | T5 | Pending |
| SSI-46 | P1: Limits and results | T4, T5 | Pending |
| SSI-47 | P1: Limits and results | T5 | Pending |
| SSI-48 | P1: Limits and results | T4 | Pending |
| SSI-49 | P1: Limits and results | T4, T5 | Pending |
| SSI-50 | P1: Limits and results | T5 | Pending |
| SSI-51 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-52 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-53 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-54 | P1: Subscriptions and suspension | T4 | Pending |
| SSI-55 | P1: Subscriptions and suspension | T4 | Pending |
| SSI-56 | P1: Subscriptions and suspension | T4, T6 | Pending |
| SSI-57 | P1: Subscriptions and suspension | T4 | Pending |
| SSI-58 | P1: Subscriptions and suspension | T4 | Pending |
| SSI-59 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-60 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-61 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-62 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-63 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-64 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-65 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-66 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-67 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-68 | P1: Subscriptions and suspension | T6 | Pending |
| SSI-69 | P2: Windows named pipe | T7 | Pending |
| SSI-70 | P2: Windows named pipe | T7 | Pending |
| SSI-71 | P2: Windows named pipe | T7 | Pending |
| SSI-72 | P2: Windows named pipe | T7 | Pending |
| SSI-73 | P2: Windows named pipe | T7 | Pending |
| SSI-74 | P2: Windows named pipe | T7 | Pending |
| SSI-75 | P2: Windows named pipe | T7 | Pending |
| SSI-76 | P2: Windows named pipe | T7 | Pending |
| SSI-77 | P2: Windows named pipe | T7, T9 | Pending |
| SSI-78 | P1: Tests and qualification | T3–T9 | Pending |
| SSI-79 | P1: Tests and qualification | T5 | Pending |
| SSI-80 | P1: Tests and qualification | T3–T7 | Pending |
| SSI-81 | P1: Tests and qualification | T4–T6 | Pending |
| SSI-82 | P1: Tests and qualification | T5 | Pending |
| SSI-83 | P1: Tests and qualification | T3, T5, T9 | Pending |
| SSI-84 | P1: Tests and qualification | T9 | Pending |
| SSI-85 | P1: Tests and qualification | T6, T9 | Pending |

**Coverage:** 85 total, 85 mapped to tasks, 0 unmapped.

---

## Deviations from the Owner's Plan

| Plan item | Deviation | Reason |
| --- | --- | --- |
| §1 first execution sequence on the Windows checkout (`git checkout main`, `fetch`, `pull --ff-only`, worktree prune) | Not run. This machine started from a fresh worktree of `origin/main` at `7e274f2`, the exact remote HEAD the plan analysed; no stale record was pruned. | The coordinator's worktree convention replaces the sequence; the base equals the plan's analysed revision, so no fact needed updating. |
| §1 create the branch "using this same checkout" | Branch `codex/strands-subscription-integration` lives in its own worktree. | Isolation of concurrent agent work. |
| §2 TLC paths all under `(development)` | `modular-design-principles` is under `(architecture)` and `security-threat-model` under `(security)`. | Paths verified against the installed copies (`research.md`). |
| §2 install skills with the skills installer | The coordinator installed full copies; this task verified all 39 hashes. | Done before this task. |
| §3 "the published API accepts structural agents in Graph and Swarm" | True, but Swarm 1.19.0 offers every peer as a destination and trusts custom output; Verchestra enforces declared destinations. | `research.md` F5. |
| §3 add the SDK and Zod only | The SDK's required peers `@modelcontextprotocol/sdk` and `@opentelemetry/api` also enter the tree. | `research.md` F3; owner decision D1. |
| §3 the SDK restricted to the runtime adapter | Restricted further to the `./multiagent` subpath; the root entry cannot be bundled into a sealed release. | `research.md` F1, F2. |
| §3 single-agent execution through Strands | Mode `agent` runs on a native single-node engine; the SDK loads only for Graph and Swarm. | Owner decision D5. |
| §3 handoff validated with Zod and converted for the CLI | Kept, with a closed schema both CLIs accept, replacing the SDK's open `context` record and optional `agentId`. | `research.md` structured-output section. |
| §3 Codex structured output | Through the App Server's `turn/start` `outputSchema`, the protocol the driver already speaks, not `codex exec --output-schema`. | `research.md` F9. |
| §3 subscription facts | The cited Claude page now says the Agent SDK billing change is paused and `claude -p` still draws from plan limits; typed quota and authentication signals exist and are used. | `research.md` F7, F8. |
| §4 T1–T10 | Kept as the task units; each lists its atomic commits, since most deliver several modules. | Traceability to the plan the owner approved. |
| `security-threat-model` workflow step 6 (check-in before the final report) | `threat-model.md` lists its assumptions for the owner to confirm. | The check-in could not run inside this task (D7). |
| Assumption "Codex minimum version raised in T4" | The floor 0.159.3 applies to the Codex sessions that ask for a structured answer or the account checks; the T04 default stays 0.115.0. 0.159.3 is the lowest build observed with all three protocol elements, not a proven first version. | A raised default would fail v1 runs at verification on older builds (SSI-83); decision "The Codex floor rises only for the sessions that use the newer App Server protocol" in `.specs/STATE.md`. |

## Success Criteria

- [ ] Each mode runs from a plan to `HUMAN_REVIEW` with fakes on macOS and Linux, and on Windows after T7.
- [ ] Zero provider calls through the SDK, zero API-key sessions, and zero runs without an extra-usage confirmation in the test suite.
- [ ] Every SSI requirement has file-and-assertion evidence in `validation.md` and the discrimination list is killed in full.
- [ ] The sealed launchers stay self-contained and their size growth is recorded.
