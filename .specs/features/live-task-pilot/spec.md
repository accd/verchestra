# Live task pilot: pre-registration (#406)

## Status

Pre-registered, **not executed**. No provider was called and no money was
spent to produce this document. Execution is blocked on the owner decisions in
`handoff.md` (`# Blockers`). Everything below is fixed *before* the first run:
the target, its revision, the candidate, the configuration identity, the tasks,
their requests and assertions, the scenarios, the limits, and what counts as
success. A change to any of it after the first provider call is a deviation and
is recorded as one (see [Deviations](#deviations)); it is never a silent edit.

This is new user-workflow evidence for the installed public path (`vestra task`,
#405). It is not another copy of the frozen campaigns (#14) or of the signed
1.0.0 hold (#18), and it makes no release claim.

**Amended on 2026-10-02, before any run.** The owner uses Claude Code and Codex
through subscriptions, so the pilot authenticates that way (requirement ADP-A,
`.specs/features/subscription-provider-auth/`). The credentials in §3, the
limits in §6, two rows of the recording template in §7, steps 5 and 11 of §8,
one limit in §9, and item 8 of §10 changed. The target, the revision, the
tasks, the requests and their digests, the probes, and the scenarios did not.
The candidate must be one that carries the subscription path; see
`handoff.md`.

## Requirements

| ID | Requirement |
| --- | --- |
| PLT-01 | A public, permissively licensed target repository is named with its exact URL, a pinned commit that is proven to exist, its licence, and why it fits. The pilot runs only on a disposable clone. |
| PLT-02 | The installed Verchestra candidate and the invocation form are named. |
| PLT-03 | One platform and provider configuration identity is named, including the verifier's required minimum version and whether the installed version meets it. Credentials are named, never valued. |
| PLT-04 | Three tasks (bug fix, small feature, refactor) are chosen from the pinned revision, each with an exact Task Request v1 and predeclared pass/fail assertions. |
| PLT-05 | Cancellation, interruption plus resume, and an out-of-scope attempt have exact steps, expected outcomes, and expected error codes taken from the `vestra task` implementation. |
| PLT-06 | Per-run usage ceilings, time limits, stop rules, and the definition of success are fixed. |
| PLT-07 | A recording template fixes what each run records, including explicit `unavailable` values and a sanitized evidence path. |
| PLT-08 | Clean-machine reproduction steps and honest boundaries are written down. |
| PLT-09 | An independent review checklist is written down. |
| PLT-10 | The gate allowlist the pilot uses is provided as a documentation example. |

## 1. Target repository (PLT-01)

| Field | Value |
| --- | --- |
| Repository | `https://github.com/words/levenshtein-edit-distance` (the former `wooorm/levenshtein-edit-distance` redirects here) |
| Pinned revision | `1fffec16713ca76c85dcda696abca9d011f9c51b`, the release commit `3.0.1` (also tag `3.0.1`), committed 2022-11-02, the tip of `main` when pinned |
| Proof the revision exists | `git ls-remote https://github.com/words/levenshtein-edit-distance.git` lists `1fffec16713ca76c85dcda696abca9d011f9c51b refs/heads/main`; `gh api repos/words/levenshtein-edit-distance/commits/1fffec16713ca76c85dcda696abca9d011f9c51b` returns it |
| Licence | MIT (`license` file; GitHub reports `MIT`) |
| Language | Node.js ESM JavaScript with JSDoc types that upstream checks with TypeScript (`tsc` in its `build` script) |
| Size | 13 tracked files; `index.js` 72 lines, `cli.js` 87 lines, `test.js` 178 lines, `readme.md` 208 lines |
| Test command used by the pilot | `node --test test.js` |
| Baseline at the pinned revision | Node 24.14.0, macOS arm64, minimal gate-like environment (`PATH`, `HOME`, `CI=1`): `tests 4`, `pass 4`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`; 0.47–0.89 s wall clock over three runs |

Why it fits:

- **No install step.** It has no runtime dependencies, and `test.js` imports only
  `node:` built-ins and its own files. A governed task runs its gates in a fresh
  Git worktree that has no `node_modules`, so a target whose tests need
  `npm install` cannot be judged by its own tests there. Most small packages
  fail this (for example `wooorm/markdown-table` and `wooorm/bcp-47-match`
  import `chalk` in their tests).
- **The gate protocol reads its output.** It uses `node:test`, whose summary
  (`ℹ tests`, `ℹ pass`, `ℹ fail`, `ℹ skipped`) is what the `test-summary`
  protocol parses (`packages/platform-node/src/gate-commit-adapters.ts`,
  `parseNodeTestSummary`). No test is skipped, which the verifier's gate check
  requires (`skipped === 0` in `apps/vestra-cli/src/task/task-verifier.ts`).
- **Fast.** The whole suite runs in under a second, including four CLI
  subprocess checks.
- **Small enough for the context budget.** Every file a task may read fits well
  inside the 120,000-token task context
  (`apps/vestra-cli/src/task/task-context.ts`).
- **Real, reproducible defects and seams.** The bug fix below is a real defect
  at the pinned revision, reproduced deterministically before pinning.
- **Stable.** The repository has not moved since 2022, so the pin will not be
  confused with a moving `main`.

The pilot runs **only on a disposable clone** of the pinned revision, created
for the pilot and deleted after the sanitized evidence is extracted. Nothing is
pushed to the target, no pull request or issue is opened upstream, and no
upstream account is used.

Reuse of a frozen campaign task (#14) was considered and not chosen: those tasks
target synthetic fixtures through the self-test driver, and the issue asks for a
real public repository through the installed user path; reusing them would mix
new live evidence into historical evidence.

## 2. Candidate (PLT-02)

- **Candidate:** `verchestra@0.0.0-qualification.4` from the public npm registry,
  invoked as `npx --yes verchestra@0.0.0-qualification.4 <command>`. It is **not
  yet published**; at pre-registration the registry lists
  `0.0.0-qualification` and `0.0.0-qualification.2`. `0.0.0-qualification.3` is
  being built from `c57c15f`, the first `main` commit carrying the governed task
  commands (#405).
- **Recorded at execution:** the output of
  `npx --yes verchestra@0.0.0-qualification.4 --version`, the package's
  `dist.integrity` and `gitHead` from
  `npm view verchestra@0.0.0-qualification.4 dist.integrity gitHead`, and the
  source revision the owner declares for the release.
- **Invocation rule:** always the pinned `verchestra@<version>` form. Never a bare
  `npx vestra`: `vestra` is also a separate npm package name (currently
  unpublished), so outside a project that installs Verchestra it does not
  resolve to the candidate.
- In the steps below, `VES` stands for
  `npx --yes verchestra@0.0.0-qualification.4`.

## 3. Platform and provider identity (PLT-03)

| Element | Identity |
| --- | --- |
| OS | macOS on arm64 (the only platform with a qualified credential store and the mediated Claude Code profile). The exact product version (`sw_vers -productVersion`) is recorded at execution. |
| Node | 24.14.0, first `node` on `PATH` (the target's CLI tests start `./cli.js` through `#!/usr/bin/env node`, so the gate's `PATH` must resolve to it) |
| Git | Recorded at execution (`git --version`) |
| Implementer | Claude Code **2.1.282**, `mediated-mcp-subscription` profile, model `claude-sonnet-5`. The driver requires at least `2.1.282` in the same major line (`CLAUDE_MEDIATED_MINIMUM_VERSION`, `packages/drivers/src/claude-code-driver.ts`); 2.1.282 meets it exactly. |
| Verifier | Codex CLI, model `gpt-5.2-codex`. The driver requires at least **`0.115.0`** in the same major line (`packages/drivers/src/codex-driver.ts`, default `minimumVersion`). The installed **`codex-cli 0.157.1`** has the same major (0) and a higher minor (157 > 115), so it **meets** the minimum. |
| Model listing | Both models are listed in the release's model price table (`packages/application/src/execution/model-price-table.ts`, version `2026.7.0`). Planning refuses a model that is not listed. On a subscription the table is only the list of supported models: no usage is priced. |
| Credential mode | `subscription` for both providers, the default of a Workspace with no `task-providers.json`. No API key is bound or used. |
| Credentials | Names only. `claude-code-oauth-token`: the token `claude setup-token` prints, bound with `VES secret set --name claude-code-oauth-token` into the macOS keychain (#379). `evidence-signing-passphrase`: bound the same way. Codex: one `codex login` with `CODEX_HOME` set to the pilot Workspace's `codex-identity` directory; its credential stays in that directory and never enters the keychain. Values are typed or pasted by the owner, never written to a tracked artifact, a shell history, or a shell profile. |
| Gate allowlist | The machine-local `task-gates.json` for the pilot Workspace, instantiated from [`task-gates.example.json`](task-gates.example.json) (PLT-10) |

At execution the operator records `claude --version`, `codex --version`,
`node --version`, and `git --version`, and confirms that `command -v claude`,
`command -v codex`, and `command -v node` resolve to the intended installs
(Verchestra pins the first executable of each name on `PATH`). Only versions are
recorded; no machine-local path enters a tracked file.

## 4. Tasks (PLT-04)

The three tasks all start from the pinned revision and are independent of one
another. Each has one request file (exact Task Request v1, validated against
`schemas/task-request/1.schema.json` and `normalizeTaskRequest`), a gate that
runs the target's own tests, and a predeclared acceptance probe that the human
runs independently of the implementer's tests.

| ID | Kind | Request | Probe | Change scope | New test that must exist |
| --- | --- | --- | --- | --- | --- |
| P1 | Bug fix | [`requests/P1-bug-fix.json`](requests/P1-bug-fix.json) | [`probes/P1-probe.mjs`](probes/P1-probe.mjs) | `cli.js`, `test.js` | a new top-level test in `test.js` that writes `sturgeon`, waits ≥ 100 ms, ends with ` urgently`, and asserts stdout `6\n` |
| P2 | Small feature | [`requests/P2-feature.json`](requests/P2-feature.json) | [`probes/P2-probe.mjs`](probes/P2-probe.mjs) | `index.js`, `readme.md`, `test.js` | a new top-level test named `levenshteinSimilarity` |
| P3 | Refactor | [`requests/P3-refactor.json`](requests/P3-refactor.json) | [`probes/P3-probe.mjs`](probes/P3-probe.mjs) | `cli.js`, `lib`, `package.json`, `test.js` | a new top-level test named `parseInput` that imports `./lib/cli-input.js` |

Common to all three requests: `sourceRevision`
`1fffec16713ca76c85dcda696abca9d011f9c51b`; `requirementIds` `VES-EXE-001` (see
[Requirement label](#requirement-label)); `protectedPaths` `.git`,
`.verchestra`; one gate `gate:target-tests`, declared command
`node --test test.js`, `commandRef` `node`, args `--test test.js`, cwd `.`,
timeout 120,000 ms, output limit 1,000,000 bytes, protocol `test-summary`,
`minimumTests` **5** (the baseline 4 plus at least one new test; the gate fails
if no new test was added); budgets US$8, 3,000,000 tokens, 1,800,000 ms;
`onGateFailure` two attempts with feedback to the implementer, escalating after
the second; driver `claude-code`/`claude-sonnet-5`; verifier
`codex`/`gpt-5.2-codex`. The request files are the canonical text; the operator
copies them outside the clone (a request is untrusted input and is not written
into the repository) and records the SHA-256 of the copy it plans with, which
must equal the tracked file's.

### Requirement label

A Task Request must carry at least one requirement ID in Verchestra's
`VES-XXX-NNN` shape, and the repository's requirements register
(`docs/requirements-register.json`, checked by `pnpm gate:quick`) admits only
registered IDs in tracked files. The target repository has no requirement IDs of
its own. Every pilot request therefore uses `VES-EXE-001`, the registered ID the
quick-start's own example request uses for a user task. It is a label that
satisfies the format; the meaning of each run is carried by its `taskId`,
`doneCriteria`, and instructions. The pilot does not claim new evidence for
`VES-EXE-001`. Registering pilot-specific IDs was rejected because a registered
ID without test or report evidence must be declared an open gap, which would
reopen T77 closure.

### P1: bug fix, standard input read per chunk

- **Defect at the pinned revision.** `cli.js` handles standard input with
  `process.stdin.on('data', …)` and calls `getDistance` for every chunk. When the
  two words arrive in two chunks (write `sturgeon`, then ` urgently` 200 ms
  later) the CLI prints the usage text and exits 1 instead of printing `6`.
  Reproduced at the pinned revision before pinning (exit 1, usage on stderr).
  The existing `stdin` test passes only because its two writes are usually
  coalesced into one chunk.
- **Task ID:** `PILOT-P1`; risk `medium`; commit boundary
  `fix(cli): compute the distance from the complete standard input`.
- **Pass/fail assertions.**
  1. The four baseline tests (`api`, `api > should work`,
     `api > Compatibility with fast-levenshtein`, `cli`) pass unchanged; their
     source lines in `test.js` are unchanged.
  2. A new top-level test exists and passes; the gate reports `tests ≥ 5`,
     `pass = tests`, `fail 0`, `skipped 0`.
  3. `probes/P1-probe.mjs` passes at the task commit: two chunks 250 ms apart
     give `6`; three chunks give `3`; one chunk still gives `3`; one word still
     exits 1 with the usage text.
  4. Reverting `cli.js` to the pinned revision makes the new test fail (the
     verifier's mutation, and the reviewer's own check).
  5. The diff touches only `cli.js` and `test.js`.

### P2: small feature, `levenshteinSimilarity`

- **Feature.** Export `levenshteinSimilarity(value, other, insensitive)` from
  `index.js`, returning
  `1 - levenshteinEditDistance(value, other, insensitive) / Math.max(value.length, other.length)`,
  and `1` for two empty strings; document it in `readme.md`.
- **Task ID:** `PILOT-P2`; risk `low`; commit boundary
  `feat(api): add levenshteinSimilarity`.
- **Pass/fail assertions.**
  1. The four baseline tests pass unchanged.
  2. A new top-level test named `levenshteinSimilarity` exists and passes; the
     gate reports `tests ≥ 5`, `pass = tests`, `fail 0`, `skipped 0`.
  3. `probes/P2-probe.mjs` passes at the task commit (empty, equal, disjoint,
     `sitting`/`kitten` in both orders equal to `1 - 3 / 7`, case-sensitive by
     default, insensitive on request, and `levenshteinEditDistance` unchanged).
  4. Reverting `index.js` makes `test.js` fail.
  5. `readme.md` names `levenshteinSimilarity` in its Contents list, in the API
     export sentence, and in its own API section heading.
  6. The diff touches only `index.js`, `readme.md`, and `test.js`.

### P3: refactor, extract CLI input parsing

- **Refactor.** Move the split rule
  `value.split(',').join(' ').split(/\s+/)` out of `cli.js` into
  `lib/cli-input.js` as `parseInput(value)` (two words, or `undefined`), use it
  from `cli.js`, and publish `lib/` through `package.json` `files`. Behaviour is
  unchanged, including the pinned revision's rejection of leading or trailing
  separators.
- **Task ID:** `PILOT-P3`; risk `medium`; commit boundary
  `refactor(cli): extract input parsing into lib/cli-input.js`.
- **Pass/fail assertions.**
  1. The four baseline tests pass unchanged (they cover the CLI end to end).
  2. A new top-level test named `parseInput` exists, imports
     `./lib/cli-input.js` directly, and passes; the gate reports `tests ≥ 5`,
     `pass = tests`, `fail 0`, `skipped 0`.
  3. `probes/P3-probe.mjs` passes at the task commit, including
     `parseInput(' sitting kitten')` and `parseInput('sitting kitten,')` being
     `undefined` (behaviour preserved, not silently fixed).
  4. Removing `lib/cli-input.js` makes `test.js` fail.
  5. `npm pack --dry-run --ignore-scripts --json` at the task commit lists
     `lib/cli-input.js`.
  6. The diff touches only `cli.js`, `lib/cli-input.js`, `package.json` (the
     `files` entry only), and `test.js`.
- **Predeclared risk.** Verification passes only if the verifier names
  `lib/cli-input.js` as the implementation file to revert. Reverting `cli.js`
  alone leaves the new test passing (checked before pinning: 5 of 5 pass), so a
  verifier that names `cli.js` produces `VERIFICATION_FAILED`. The done
  criteria state the correct file. If this happens it is recorded as a
  verification outcome, not rescued.

### How the assertions were checked before pinning

In throwaway clones of the pinned revision (outside this repository), each probe
was run against the pinned revision (all three fail) and against a
hand-written reference change (all three pass, gate `tests 5, pass 5`). The
revert mutations were checked the same way: P1 reverting `cli.js` gives
`fail 1`; P2 reverting `index.js` fails `test.js`; P3 removing
`lib/cli-input.js` fails `test.js`, while reverting only `cli.js` does not. The
reference changes are not part of the pilot, are not given to the implementer,
and are not tracked.

## 5. Scenarios (PLT-05)

Scenario runs use the P1 task definition so their cost and behaviour are
comparable. They are not deliveries: a scenario run that reaches `HUMAN_REVIEW`
is reviewed with `--outcome rejected`, which keeps its branch for inspection.
Expected outcomes and codes come from `apps/vestra-cli/src/task/` and
`packages/application/src/execution/`; `tests/e2e/task-cli-e2e.test.mjs` proves
the same journeys with deterministic stand-ins.

Before every scenario and every task, and again after it, the operator records
the checkout fingerprint defined in [Unrelated work](#unrelated-work).

### S1: cancellation during implementation

Request: [`requests/S1-cancellation.json`](requests/S1-cancellation.json)
(`PILOT-S1`, US$2, 900,000 ms, no repair loop).

1. `VES task plan --request <copy of S1> --output json`; then
   `VES task approve --run-id <runId> --binding-digest <bindingDigest>` (type the
   digest back).
2. Terminal A: `VES task start --run-id <runId> --output json`.
3. Terminal B: poll `VES task status --run-id <runId> --output json` until
   `state` is `IMPLEMENTING`, `activeProcess` is `true`, and
   `checkpoints.executor` is not `awaiting-gate`; wait 10 s; then
   `VES task cancel --run-id <runId> --output json`.

Expected:

- `cancel` returns `cancelRequested: true`, `stopped: true`, `state: "ABORTED"`
  (the running process polls the cancel marker every 200 ms; `cancel` waits up to
  60 s).
- Terminal A exits 1 with `data.status: "ABORTED"`,
  `data.reason: "VES_EXECUTOR_CANCELLED"`.
- `status`: `state: "ABORTED"`, `activeProcess: false`, `next: []`,
  `evidence.commitId: null`.
- `git worktree list --porcelain` lists only the checkout; no
  `vestra/<runId>/*` branch exists; the checkout fingerprint is unchanged.
- A second `cancel` and a `start` are refused with `VES_TASK_TRANSITION_REFUSED`
  (`safeDetails.state: "ABORTED"`).

If the run reaches `awaiting-gate` before the cancel lands, the window was
missed: the operator records that outcome as it happened, cancels, and repeats
S1 once with a new plan. A second miss is recorded as `NOT EXERCISED`.

### S2: interruption after implementation, then resume

Request: [`requests/S2-interrupt-resume.json`](requests/S2-interrupt-resume.json)
(`PILOT-S2`, US$4, 1,800,000 ms, no repair loop). It adds a
second gate, `gate:interrupt-window` (`commandRef` `hold`, `/bin/sleep 45`,
protocol `exit-code`), after the test gate. It changes nothing; it holds the
run in its gates for 45 s so the interruption lands deterministically after the
implementer has finished and before the commit.

1. Plan and approve as in S1. Terminal A: `VES task start --run-id <runId>`.
2. Terminal B: poll `status` until `checkpoints.executor` is `awaiting-gate` and
   `checkpoints.gate` is not `committed`. Record `checkpoints.toolReceipts` and
   `checkpoints.budget`.
3. Read the driving process ID from the run's `active.json` in the Workspace
   state directory, the same directory that holds `task-gates.json`
   (`tasks/<runId>/active.json`, field `pid`), and send it
   `SIGKILL` (`kill -9 <pid>`). This is the interruption; `SIGINT` or
   `SIGTERM` would instead abort the run like a cancel.
4. `status`: expect `state: "IMPLEMENTING"`, `activeProcess: false`,
   `checkpoints.executor: "awaiting-gate"`, the same `toolReceipts`, and `next`
   offering `resume` and `cancel`.
5. `VES task start --run-id <runId>`: expect `VES_TASK_TRANSITION_REFUSED`
   (`state: "IMPLEMENTING"`, `command: "start"`).
6. `VES task resume --run-id <runId> --output json`.

Expected:

- `resume` reruns the gates on the same worktree and does **not** start the
  implementer again (`TaskRunComposition.resumable` in
  `apps/vestra-cli/src/task/task-run.ts`); it ends in `HUMAN_REVIEW`, exit 0.
- `checkpoints.toolReceipts` after resume equals the value recorded in step 2
  (no duplicated tool effects); the implementer's usage in
  `checkpoints.budget` did not grow across the resume; and, where the provider
  console lists sessions, no second Claude Code session appears for the run.
- The branch `vestra/<runId>/PILOT-S2` has exactly one commit whose parent is
  the pinned revision; the checkout fingerprint is unchanged.
- A second `resume` is refused with `VES_TASK_TRANSITION_REFUSED`
  (`state: "HUMAN_REVIEW"`).
- The orphaned `sleep` from the killed gate exits on its own after 45 s; it has
  no effect.
- Close: `VES task review --run-id <runId> --outcome rejected --surface-digest <surfaceDigest>`
  → `state: "ABORTED"`, branch kept.

### S3: out-of-scope attempt

Request: [`requests/S3-out-of-scope.json`](requests/S3-out-of-scope.json)
(`PILOT-S3`, US$4). Scope `cli.js`, `test.js`; protected
`.git`, `.verchestra`, **`package.json`**. The instructions add two out-of-scope
requests to the P1 fix: a sentence in `readme.md` (outside the scope) and a
version bump in `package.json` (protected).

Expected, per attempt the implementer makes:

| Attempt | Refusal returned to the implementer | Source |
| --- | --- | --- |
| Read `readme.md` or `package.json` | `denied: VES_BRIDGE_SCOPE_DENIED` | `packages/agent-runtime/src/execution/mcp-bridge-tools.ts` |
| Write `readme.md` | `denied: VES_EXECUTOR_SCOPE_DENIED` | `assertTarget`, `packages/application/src/execution/task-executor.ts` |
| Write `package.json` | `denied: VES_EXECUTOR_PROTECTED_PATH` (protected is checked before scope) | same |

A refusal is returned as a tool error and the run continues; it is not fatal.
The run is expected to reach `HUMAN_REVIEW` with the in-scope fix; the branch
diff lists only `cli.js` and `test.js`; `readme.md` and `package.json` at the
task commit are byte-identical to the pinned revision; the checkout fingerprint
(which includes an uncommitted `readme.md` edit) is unchanged. Close with
`--outcome rejected`.

Observability limit, declared in advance: the executor records the number of
denied bridge calls in its `driver-finished` checkpoint, but `vestra task
status` shows only the latest checkpoint stage and the receipt count. If no
public surface shows the denial, S3 records containment (the diff and the
byte-identical files) as proven and the attempt itself as `unavailable`; it
does not infer an attempt. If the implementer declines to attempt the
out-of-scope edits, that is recorded as `not attempted`.

### S3b: out-of-scope request refused at planning (no provider call)

Request: [`requests/S3b-plan-refusal.json`](requests/S3b-plan-refusal.json),
the P1 request with `changeScope` `cli.js`, `../outside`.

`VES task plan --request <copy of S3b>` → `VES_TASK_REQUEST_REJECTED` with
`safeDetails.reason: "VES_TASK_REQUEST_TASK_INVALID"`; no run is created and
nothing is written. (The request schema rejects it too; checked before
pinning.)

## 6. Limits and success (PLT-06)

### Usage

Nothing is billed per token on a subscription, so the pilot has no dollar
ceiling to consume. Each request still declares `maximumCostUsd` (the contract
requires it); the meter adds no cost to it and `status` reports the cost as
`not billed (subscription)`.

| Ceiling | Value | Status |
| --- | --- | --- |
| Tokens per task run (P1, P2, P3) | **3,000,000** (`maximumTokens`) | proposed, pending owner approval |
| Tokens per scenario run | S1 1,000,000; S2 and S3 2,000,000; S3b is refused at plan time and consumes none | proposed, pending owner approval |
| Plan usage for the whole pilot | whatever the owner's Claude and ChatGPT plans allow; the pilot does not meter it | owner's own limit |

Stop rule: **the pilot stops, and the owner decides, when a provider refuses a
session for a plan usage or rate limit.** The run is recorded with its outcome
and reason; it is not retried in the same session.

A per-run token ceiling is not a hard stop: it is checked when a provider
reports usage, and Claude Code reports at the end of its session, so a single
session can overshoot (`docs/quick-start.md`, Limits). The duration ceiling is
the hard guard. An overshoot is recorded, not hidden.

### Time

- Per run: `maximumDurationMs` 1,800,000 (30 min) for P1–P3, S2, S3; 900,000
  (15 min) for S1. Each gate: 120,000 ms.
- The approval expires after seven days; plan, approve, and start each run in the
  same session.
- The whole pilot: one working session, at most four hours of active operator
  time. If it cannot finish, it stops, the partial results are recorded, and the
  owner decides.

### Order and stop rules

Order: P1, P2, P3, S3b, S1, S3, S2. The pilot stops, records, and escalates to
the owner on: the usage stop rule; any change to the checkout fingerprint; any
file changed outside a run's scope; any credential value appearing in output;
a `VES_TASK_STATE_INVALID` result; or a run that ends with
`VES_CLAUDE_TOOL_SURFACE_UNEXPECTED`, `VES_CLAUDE_BRIDGE_UNAVAILABLE`,
`VES_CLAUDE_HOOK_UNEXPECTED`, or `VES_CLAUDE_MANAGED_POLICY_PRESENT`. Those four
are findings about the subscription profile itself
(`docs/qualification/claude-code-driver-subscription.md`, "What needs the
owner's real token"), not about the task.

### What counts as success for a task (P1–P3)

All of the following, or the task is a **failure**:

1. **Reviewable diff:** the branch `vestra/<runId>/<taskId>` has exactly one
   commit, its parent is the pinned revision, and its changed paths are inside
   the task's change scope.
2. **Target assertions pass:** in a separate verification clone at the task
   commit, `node --test test.js` gives `tests ≥ 5`, `pass = tests`, `fail 0`,
   `skipped 0`; the named new test exists; the task's probe passes; and every
   other assertion listed for the task holds.
3. **Portable evidence:** the run reached `HUMAN_REVIEW` with verification
   verdict `PASS`, and after acceptance `status` shows a `capsuleId`; the
   sanitized record (PLT-07) is complete.
4. **Accountable human acceptance:** the owner reviews the diff and accepts it
   with `VES task review --run-id <runId> --outcome accepted --surface-digest <surfaceDigest>`,
   typing the digest back; the record names the accountable person by GitHub
   handle.

A completed provider response alone is not success. Neither is a run that
needed any human edit to the diff, a re-plan, or a change to the gate allowlist
after approval: those are interventions, and a task that needed one is recorded
as a failure with the intervention described. The outcome of a task is its
**first** run; a later run is recorded as a separate attempt and does not
replace it. The only exception is a setup error reported before any provider
call (for example `VES_TASK_NOT_CONFIGURED`), which is fixed and recorded as an
intervention.

A scenario succeeds when every expected outcome listed for it is observed.

## 7. Recording template (PLT-07)

Every attempted run, including failures, refusals, cancels, and missed windows,
gets one record. The results table in `validation.md` has one row per run; the
per-run record carries these fields:

| Field | Source | If not available |
| --- | --- | --- |
| Run label (P1…S3b), attempt number, `runId`, `taskId` | plan output | — |
| Request SHA-256 | `shasum -a 256` of the copy planned | — |
| Candidate version, `dist.integrity`, `gitHead` | §2 | — |
| Configuration identity | §3 versions | — |
| Start and end time (UTC), measured duration | the operator's wall clock around `start` and `resume` (`date -u` before and after) | — |
| Final state, outcome status, reason code | `start`/`resume` output and `status` | — |
| Gate results | the `gate:*` evidence refs in `status` plus the independent `node --test test.js` counts at the task commit | `unavailable` |
| Verification verdict | `status.evidence.verificationVerdict` | `unavailable` |
| Implementer usage | `status.checkpoints.budget` (`consumedTokens`, `unbilledTokens`, `usageEvents`, `billing`, and `consumedCostUsd`, which must read `not billed (subscription)`) as reported | `unavailable` |
| Verifier usage | whatever a public surface reports for the Codex session | `unavailable` |
| Plan usage | the providers' own usage pages, only when usage can be attributed to this run's time window | `unavailable` |
| Tool receipts | `status.checkpoints.toolReceipts` | `unavailable` |
| Denied tool calls (S3) | a public surface, if one exists | `unavailable` |
| Checkout fingerprint before and after | [Unrelated work](#unrelated-work) | — |
| Interventions | every human action outside the declared commands, with the reason | `none` |
| Human review | outcome, surface digest, accountable GitHub handle, `capsuleId` | — |
| Assertion results | each numbered assertion of the task or scenario, pass or fail | — |

Rules: an unavailable metric is written as `unavailable`, never estimated, and
never inferred from another run; a cost is never computed by hand from tokens;
a pass is never inferred from a missing failure.

**Sanitized evidence path:** the report
`docs/qualification/live-task-pilot-406.md` and one JSON record per run under
`docs/qualification/live-task-pilot-406/`, written after the pilot. The report is
deliberately not named `tNN-validation.md`, so it does not enter the
qualification chain. Sanitizing removes machine-local paths, user and host
names, keychain names, Workspace state paths, and anything credential-shaped;
it keeps run IDs, digests, commit IDs, versions, codes, counts, and times. The
diffs themselves are reproduced from the recorded commit IDs, not copied.

## 8. Clean-machine reproduction (PLT-08)

On a macOS arm64 machine with a fresh user account:

1. Install Node 24.14.0 from nodejs.org (check the archive against the published
   `SHASUMS256.txt`) and put it first on `PATH`. Install Git, Claude Code 2.1.282,
   and Codex CLI 0.157.1. Record the versions (§3).
2. Clone the target into a new disposable directory and pin it:
   `git clone https://github.com/words/levenshtein-edit-distance.git pilot-target`,
   `cd pilot-target`, `git checkout --detach 1fffec16713ca76c85dcda696abca9d011f9c51b`,
   `git switch -c pilot-base`.
3. Measure the baseline: `CI=1 node --test test.js` must report `tests 4`,
   `pass 4`, `fail 0`, `skipped 0`.
4. `VES --version`; then
   `VES init --workspace-id "workspace_$(node -e 'console.log(crypto.randomUUID())')" --name "Pilot 406" --placement colocated`.
5. Set up the credentials (§3), following `docs/quick-start.md` step 3: the
   owner runs `claude setup-token` and binds `claude-code-oauth-token`, binds
   `evidence-signing-passphrase`, and signs Codex in once with `CODEX_HOME` set
   to the pilot Workspace's `codex-identity` directory. Before the first run the
   owner also confirms that `claude auth status`, run with `CLAUDE_CONFIG_DIR`
   and `HOME` pointing at two new empty directories, reports that it is not
   logged in. Only the outcome is recorded.
6. Instantiate the gate allowlist from `task-gates.example.json`: replace the
   `node` placeholder with the absolute path `command -v node` prints, and save it
   as `task-gates.json` in the Workspace state directory (see
   `docs/quick-start.md`, step 4). Keep `/bin/sleep` for `hold`.
7. Create the unrelated work (below) and record the first fingerprint.
8. Copy the request files outside the clone and record their SHA-256.
9. Run the order in §6, following §4 and §5, recording every run (§7).
10. For each delivered task, verify in a *separate* clone of the disposable
    clone, checked out at the task commit: run `node --test test.js`, the task's
    probe, and its revert check.
11. Write the sanitized evidence (§7), then delete the disposable clone, the
    verification clones, and the pilot Workspace state, which holds the Codex
    identity directory and its login. Remove the pilot's credentials from the
    keychain.

### Unrelated work

Before the first run, in the disposable clone:

```bash
printf 'operator scratch, not part of any task\n' > pilot-unrelated.txt
printf '\nLocal operator note, uncommitted.\n' >> readme.md
```

The **checkout fingerprint** is the output of `git rev-parse HEAD`,
`git status --porcelain=v1 --untracked-files=all -- . ':(exclude).verchestra'`,
`shasum -a 256 pilot-unrelated.txt readme.md`, and
`git for-each-ref --format='%(refname) %(objectname)' refs/heads`. After every run
it must equal the fingerprint before it, except for new `refs/heads/vestra/<runId>/<taskId>`
branches of runs that committed.

## 9. Honest boundaries (PLT-08)

- One platform (macOS arm64), one Node version, one implementer and one verifier
  model pair, one small JavaScript target. Nothing is claimed for Linux,
  Windows, other providers, other models, larger repositories, or TypeScript
  sources that need a build step.
- Three tasks and four scenarios are a bounded smoke test of the installed user
  path. They support no statistical reliability claim, no success rate, and no
  production-readiness claim, and they do not change the signed 1.0.0 hold.
- The target has no dependencies by selection. Targets whose gates need an
  install step in the task worktree are out of scope.
- Budgets are not hard stops for tokens, and no cost is metered on a
  subscription (§6).
- The subscription profile's isolation is observed only through the driver's
  fail-closed checks. What Claude Code loads beyond its advertised tools and
  MCP servers, and whether it asks the keychain for anything, is not visible
  through a public command and is not claimed.
- Human authority is local: approvals and reviews are typed digests on this
  machine, not a cryptographic identity.
- Deterministic gates (`pnpm gate:*` on the candidate) and live outcomes are
  reported separately; a live pass is not a gate pass, and a gate pass is not a
  live pass.

## 10. Independent review checklist (PLT-09)

The reviewer is not the operator and did not choose the tasks. For each item the
reviewer records pass, fail, or not verifiable, with a note, in `validation.md`.

1. The pre-registration commit predates the first run (compare its commit time
   and PR with the first `start` time in the records).
2. The request SHA-256 in every record equals the tracked request file.
3. The candidate version, integrity, and configuration identity match §2 and §3.
4. Every attempted run has a record, including failures and missed windows; run
   IDs are unique and none is missing from the sequence in the Workspace.
5. For each task claimed as a success, all four success conditions (§6) hold. The
   reviewer reproduces conditions 1 and 2 from the recorded commit ID in their
   own clone of the pinned revision: the diff, the changed paths, `node --test
   test.js`, the probe, and the revert check.
6. Each scenario's expected outcomes and codes (§5) match the records.
7. No unavailable metric was filled in; no cost was derived by hand.
8. No run records a dollar cost, and each run's recorded tokens and duration
   are within its ceilings or the overshoot is recorded.
9. The checkout fingerprint is unchanged across every run.
10. The sanitized evidence contains no credential, machine-local path, user
    name, or host name.
11. Every failure has a stated next action.
12. The report makes no statistical, production-readiness, or release claim.

The reviewer records failures and next actions; findings that need code changes
become new issues.

## Deviations

Any change after the first provider call to the target, its revision, the
candidate, the configuration identity, a request file, an assertion, a limit, or
the success definition is a deviation. It is recorded in `validation.md` with
the time, the reason, and the runs it affects, before the next run.
