# Validation — candidate C4 (ADP-4, driver session runner and process-tree termination)

Requirement ADP-4: the start, observe and close loop is implemented once.
Cancelling a Claude Code or Codex session terminates its whole process tree.

Four task rows on one branch, `refactor/driver-session-runner`, each a
contiguous range of commits and its own pull request: T4a (C4-1, the session
runner), T4b (C4-2, the Codex verifier adopts it), T4c (C4-3, the two Self-Test
scenarios adopt it) and T4d (C4-4, process-tree termination).

The commit identifiers below are those of the branch as it was measured, on
base revision `e17abb3`. A rebase gives the same changes new identifiers; the
tip measured after the last rebase is named at the end of the C4-4 section.

Sources are named by symbol. Assertions are cited by test file and line: `R` is
`tests/contract/driver-session-runner.test.mjs`, `D` is
`tests/integration/driver-session-runner-drivers.test.mjs`, `A` is
`tests/integration/driver-execution-adapter.test.mjs`, and `U` is
`tests/unit/budget-meter.test.mjs`. Nothing here was observed against a real
provider session. The provider executables are the repository's labeled fakes,
and Pi runs against its faux provider.

## C4-1 (T4a) — the session runner

Owning module: `packages/agent-runtime/src/execution/driver-session-runner.ts`
(`runDriverSession`), beside the structural `DriverSessionPort`, which moved
into it from the driver execution adapter. `packages/agent-runtime` still
imports no driver. Consumer in this range:
`DriverExecutionAdapter#run`. The metering step both metering points share is
`recordUsageAndDecide` in `packages/application/src/execution/budget-meter.ts`;
its consumer in this range is the executor's `reportUsage`.

The adapter loses its own start, cancel-on-abort, close and outcome rule, its
record of the session identifier, and its list of error codes. What stays in it
is what a mediated implementer session may do: the tool surface, metering, the
checkpoints, and the order in which its own refusals outrank the outcome.

### Requirement evidence

| Clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| Start, observation and close happen once, in order | `runDriverSession` | `R:66-87`; with no signal and no observer: `R:89-94`. On the Claude Code, Codex and Pi drivers, with the session gone from the driver afterwards: `D:92-111` |
| The already-aborted check | `runDriverSession` | The driver is never started, closed or cancelled, and nothing is observed: `R:96-106`. On three drivers, with no execution resolved and no process spawned: `D:113-125`. Through the adapter: `A:197-212` |
| Cancel on abort | `ObservedSession#stop`, `#cancel` | Once, with the announced identifier and the runner's reason, and the driver's own signal aborted: `R:108-124`. A session announced after the stop is cancelled when it is known: `R:203-215`. The first announced identifier is the session: `R:217-229`. Never announced, never cancelled: `R:231-237`. On three drivers the provider is stopped and one terminal event carries the cancel and its reason: `D:127-147` |
| The cancel finishes before the close | `ObservedSession#settled` | `R:126-143` |
| A cancel that fails does not change the outcome | `#cancel` | `R:239-250` |
| The stop listener is removed | `runDriverSession` | `R:252-259` |
| A stop always ends as `cancelled` | `ObservedSession#classify` | The end ADP-3 recorded, scripted: `R:149-166`. A failure before the stop: `R:187-201`. Through the adapter, with the late code recorded: `A:217-239` |
| A terminal event or a close that says `cancelled` is `cancelled` | `classify` | Terminal event, runner never stopped: `R:168-180`. Close: `R:182-185`. A real running session cancelled through `cancel()` alone, on three drivers: `D:152-172` |
| An error event is `failed`, with stable codes | `#track`, `safeCode` | `R:261-272`; through the adapter: `A:149-163` |
| `completed` is what the driver's close says and nothing less | `classify` | Failed, absent, unknown and already-closed answers: `R:274-284`. Through the adapter: `A:241-246` |
| An observer that throws is contained and rethrown | `#deliver`, `rethrowObserverFailure` | `R:286-308`, `R:310-324`; it outranks the start it broke: `R:366-382` |
| A start that fails | `runDriverSession`, `ObservedSession#abandon` | Rethrown, nothing closed: `R:326-333`. After an announcement the session is closed by its identifier: `R:335-349`. After the stop it is the cancel: `R:351-364` |
| `DriverExecutionAdapter#run` delegates | `DriverExecutionAdapter#run` | Every case of `A` runs through the runner; the three cases above (`A:197-212`, `A:217-239`, `A:241-246`) fail on the adapter's former rule. `tests/e2e/mediated-task-execution-e2e.test.mjs` passes unmodified |
| One "record usage and decide" step | `recordUsageAndDecide` | No stop: `U:234-241`. Threshold: `U:243-252`. Duration: `U:254-262`. The meter's refusal carries its failure: `U:264-275`. Any other error is rethrown, a look-alike included: `U:277-304`. A stop with no named threshold: `U:306-312` |
| The executor meters through it, unchanged | `TaskExecutionCoordinator#execute` | `tests/fault-injection/budget-enforcement-faults.test.mjs`, `tests/integration/task-executor.test.mjs` and `tests/fault-injection/task-executor-faults.test.mjs`, all unmodified |

### The cancel-initiated end ADP-3 recorded

ADP-3 left this unchanged and recorded it: cancelling a running session through
`cancel()` emits `session.closed` with `cancelled`, then the run reports how its
process ended as an error event, and `close` answers `failed`.

The runner's classification for that end is `cancelled`. Three facts decide it,
any one of which is enough: the runner stopped the session, the first terminal
event said `cancelled`, or the close said `cancelled`. An error event or a
`failed` close after that does not turn the cancel into a failure. The late
event is still delivered to the observer and its code is in the result, so the
adapter's `driver-finished` checkpoint records it whatever the order of the two
events was.

It is asserted at the runner's interface against a script (`R:149-166`,
`R:168-180`) and against a real running session of each driver that can be
stopped (`D:152-172`). `D:175-195` pins the order the Claude Code driver emits
today (terminal event, then `VES_CLAUDE_STREAM_INCOMPLETE`) together with the
runner's answer, so that a change to that order is a decision.

The driver-level sequence is not changed here. It is pinned by the lifecycle
matrix and the ledger contract (`tests/contract/driver-session-ledger.test.mjs`,
"an event emitted after the terminal event is still delivered and numbered"),
and the qualification suites run on it. Whether it should change is an open point below.

### Behaviour changes

1. A caller that is already aborted is reported `cancelled` and its driver is
   never started. Before, the adapter started the driver with an aborted
   signal; a real driver answered `VES_DRIVER_CANCELLED`, and the executor
   then wrote a `failed` checkpoint with `VES_EXECUTOR_DRIVER_FAILED` instead
   of a `cancelled` one. The run ended `ABORTED` either way. The window is an abort between the executor's own entry check
   and the driver start.
2. A session is closed only after a cancel in flight has finished. Before, the
   close could overtake the cancel, and the terminal event then carried no
   reason.
3. A close that does not report `completed` is `failed`. Before, a close with
   no outcome and no error event counted as completed. The four drivers always
   report an outcome on the first close, so no session of theirs changes.
4. A start that fails after the adapter stopped the session (a tool outside the
   bridge, a fatal denial, unmeterable usage) now raises the adapter's own
   refusal. Before, the start's failure was raised in its place.
5. `recordUsageAndDecide` names the reason `budget` when a meter stops without
   naming a threshold. Before, the executor's failure message then read
   "declared undefined was reached". The meter this repository builds always
   names a threshold.

### Tests changed

No case was deleted. One was replaced.

| Former case (`A` at `e17abb3`) | Assertion | Replacement |
| --- | --- | --- |
| "an aborted caller signal reaches the driver before it starts work" | Inside the driver's start, the signal is aborted; the status is `cancelled` | `A:197-212` "an already aborted caller is reported cancelled and its driver is never started": the driver's start fails the case if it runs at all, the status is `cancelled`, nothing is closed or cancelled, and the one checkpoint is `driver-finished` with `cancelled`. `R:96-106` and `D:113-125` assert the same at the runner |

Added: `R` (25 cases), `D` (13), three cases in `A`, six in `U`.

### Discrimination (disposable copy)

A copy of `packages`, `apps`, `tests`, `spikes`, `scripts`, `schemas` and `docs`
at `0e0dfb6`, in an ignored scratch directory, was mutated one change at a time
and restored from the tracked sources after each run. The tracked sources were
never mutated. Suites run: `R`, `D`, `A`, `U`,
`tests/fault-injection/budget-enforcement-faults.test.mjs`,
`tests/integration/task-executor.test.mjs`,
`tests/fault-injection/task-executor-faults.test.mjs` and
`tests/e2e/mediated-task-execution-e2e.test.mjs`. Unmutated copy: 116 passed,
0 failed.

| Mutation in the copy of the runner | Failing cases |
| --- | --- |
| **The already-aborted check is removed** | 5: `R:96-106`, the `D:113-125` row of three drivers, `A:197-212` |
| **A stop no longer decides the outcome** | 6 in `R`, among them "a failure that preceded the stop…" and "a stopped session that never announced itself…" |
| **The terminal event's outcome is not read** | 5: `R:168-180`, the `D:152-172` row of three drivers, `D:175-195` |
| A close that reports cancelled is not read | 1 in `R` |
| **Completed unless close reports failed (the adapter's former rule)** | 4: three of `R:274-284` and `A:241-246` |
| Error events do not fail a session | 1 in `R` |
| Close does not wait for the cancel in flight | 1: `R:126-143` |
| A stop does not cancel the session | 9: 5 in `R`, the Claude Code and Codex rows of `D:127-147`, 2 in `A` |
| A session announced after the stop is not cancelled | 1: `R:203-215` |
| An observer failure is thrown into the driver | 2 in `R` |
| A failed observer keeps being called | 1 in `R` |
| An observer failure does not stop the session | 2 in `R` |
| An observer failure is swallowed | 3 in `R` |
| A start that failed after announcing a session is not closed | 2 in `R` |
| A start that failed after the stop is rethrown | 1 in `R` |
| A start failure is always read as a cancel | 2 in `R` |
| The session is cancelled again on every event after the stop | 4: 3 in `R`, 1 in `A` |
| A cancel that fails is not contained | 1 in `R` |
| The stop listener stays on the caller's signal | 1 in `R` |
| Error codes are reported as the driver spelled them | 1 in `R` |
| The result is not frozen | 2 in `R` |
| The driver is handed the caller's own signal | 4: `R:89-94` and the `D:92-111` row of three drivers |
| The cancel carries another reason | 5: 2 in `R`, the `D:127-147` row of three drivers |
| The first announced session identifier is replaced by a later one | 1: `R:217-229` |
| Events are observed before the runner tracks them | **none: equivalent** (below) |

| Mutation in the copy of the adapter, the meter or the executor | Failing cases |
| --- | --- |
| **The adapter reports completed whatever the runner says** | 5 in `A` |
| The adapter drops the runner's error codes from the checkpoint | 2 in `A` |
| The adapter gives the runner no signal | 4 in `A` |
| The adapter gives the runner no observer | 5: 3 in `A`, 2 of the mediated end-to-end journeys |
| **Any metering error is read as a budget stop** | 1: `U:277-304` |
| The meter's verdict is not asked for | 6: 3 in `U`, 3 of the executor's budget cases |
| The meter's refusal is rethrown | 2: `U:264-275` and "an unknown model stops the run instead of running for free" |
| The refusal is reported without its failure | 2: the same |
| The refusal is reported under the generic reason | 2: the same |
| The event is not recorded | 8 across `U` and the executor's budget cases |
| The executor does not stop on the verdict | 3 of the executor's budget cases |
| The executor raises a budget failure in place of the meter's refusal | 1: "an unknown model stops the run instead of running for free" |

36 mutations failed at least one case. One did not: swapping the order in which
the runner records an event and hands it to the observer. It is equivalent. The
only reader of that order is a stop raised by the observer on the announcement
itself, and the check that follows every event cancels the session in either
order.

### Guardrails

- Complexity baseline: no entry changed, no key added or moved
  (`pnpm complexity:update` rewrites `complexity-baseline.json` to the same
  bytes). `packages/application/src/execution/task-executor.ts :: Async method
  'execute'` stays 53. Every new function is below the target of 10.
- Census: no file gained or lost `JSON.stringify` or `createHash`.
- Citations fixed in `.specs/features/live-task-pilot/validation.md`: the
  executor's scope check, now `task-executor.ts:387-388`, and the adapter's
  checkpoint, now `driver-execution-adapter.ts:111`.
- No file under `docs/qualification/` changed. The digest-bound reports of
  `credential-store.ts` are untouched.
- Migration count (12) and runtime error catalog count (19) unchanged. No
  public error code was added, removed or changed.
- `tests/mutation/*` and the fault-injection suites pass unmodified.

### Gates (Node 24.14.0, macOS arm64)

Each row was measured on a detached checkout of exactly that commit.

| Commit | `pnpm gate:quick` | `pnpm test:architecture` | Focused suites |
| --- | --- | --- | --- |
| `e17abb3` (base) | PASS — unit 2476, agent-readiness 323, census 13 | PASS — 76 | `A`, `U`: PASS — 33 |
| `85d7646` the metering step | PASS — 2482, 323, 13 | PASS — 76 | `U`, the executor's budget and integration suites: PASS — 53 |
| `f347545` the runner and its suites | PASS — 2482, 323, 13 | PASS — 76 | `R`, `D`, `A`: PASS — 47 |
| `0e0dfb6` the adapter delegates | PASS — 2482, 323, 13 | PASS — 76 | `R`, `D`, `A`, `U`: PASS — 79 |

At the last code commit of the range:

| Command (at `0e0dfb6`) | Result |
| --- | --- |
| `pnpm gate:build` | PASS — unit 2482, contract 756, integration 910, e2e 238, architecture 76, build 146, qualification 296 |
| `pnpm gate:security` | PASS — unit 2482, contract 756, e2e 238, architecture 76, qualification 296, security 1339, fault 310 |
| `pnpm test:fault` | PASS — 310 |
| `pnpm test:contract` | PASS — 756 |
| `pnpm test:integration` | PASS — 910 |
| `pnpm qualify:claude` | PASS — 53 |
| `pnpm qualify:codex` | PASS — 20 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 23 |
| `pnpm agent:check` | PASS |

No test was skipped in any stage. The `qualify:*` scripts start no provider
session and need no login: they run the labeled fakes, and probe an installed
CLI only with `--version`, `--help` and `codex login status` in a disposable
directory. `qualify:keychain` was not run.

### Open points for the reviewer

- **The driver-level order of a cancelled run.** The runner tolerates it; it
  does not fix it. A cancelled Claude Code or Pi run still emits an error event
  after `session.closed`, and its `close` still answers `failed`. The
  recommendation is to change that in the drivers, in a change of its own that
  requalifies them: a `cancel()` should mark the run as cancelled, so that the
  run ends as the driver's `…_ABORTED` and `close` answers `cancelled`, and the
  ledger should let nothing follow the terminal event. That changes the ledger
  contract case "an event emitted after the terminal event is still delivered
  and numbered" and `D:175-195`,
  which is why it is not part of this range.
- **`completed` is strict.** The adapter used to count a close with no outcome
  as completed. One rule now serves the adapter, the verifier and the Self-Test
  verifier session, and the last two already required `completed`; the lenient
  rule would have weakened them.
- **Events after the terminal event are delivered.** Dropping them would make
  the content of the adapter's checkpoint depend on which of two events a
  driver emitted first.
- **Platform matrix.** Every result above is from macOS arm64. The range has no
  platform-specific code, but the task path is on the list that requires a
  `platform-matrix.yml` run on the branch before merge.

## C4-2 (T4b) — the Codex verifier adopts the runner

`V` is `tests/integration/codex-verifier-session.test.mjs`. Its fixture is
`tests/helpers/codex-verifier-fixture.mjs`, and the provider is the labeled
fake `tests/helpers/task-cli-fakes/fake-codex-task.mjs`. On Windows the
governed task path is refused before a verifier session is reachable, so every
case of `V` asserts that refusal there instead of skipping.

`runCodexVerifier` in `apps/vestra-cli/src/task/task-codex.ts` loses its own
start, observation and close, and its own rule for a metering error. It runs
the session through `runDriverSession` and meters through
`recordUsageAndDecide`. What stays in it is the verifier's own: the isolated
identity, the zero-tool grant, the verdict text, the duration timer, and the
reason it gives for a session that did not complete.

### Requirement evidence

| Clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| The verifier runs its session through the runner | `runCodexVerifier` | Every case of `V` and the four verifier cases of `tests/integration/codex-identity.test.mjs` (unmodified) run through it; `tests/architecture/driver-session-runner-locality.test.mjs` (C4-3) fails if it starts a session itself |
| The already-aborted check | `runCodexVerifier` → `runDriverSession` | No thread is opened, the reason is `VES_EXECUTOR_CANCELLED`, the session root is gone: `V:44-52` |
| Cancel | `runCodexVerifier`, `failureReason` | A verifier with an open turn is cancelled, the reason is `VES_EXECUTOR_CANCELLED`, the Codex process is gone, the session root is gone: `V:54-79` |
| Usage spends from the run's budget | `meterUsage` | Tokens and events recorded, verdict returned: `V:81-90`; no meter, no stop: `V:145-150` |
| A reached ceiling is a budget outcome | `meterUsage`, `failureReason` | Tokens: `V:92-101`, with the meter's stop reason. Duration, through the timer, not before it: `V:103-121` |
| A reached ceiling outranks the caller's cancel in the reason | `failureReason` | A meter that is already at its ceiling and a caller that is already cancelled: `VES_EXECUTOR_BUDGET_EXCEEDED`, no Codex process: `V:155-164` |
| The meter's refusal stops the verifier under its own code | `meterUsage`, `failureReason` | `VES_BUDGET_MODEL_UNKNOWN`, nothing recorded: `V:123-129` |
| An error that is not a budget error is not swallowed | `meterUsage` → `recordUsageAndDecide` → the runner's observer guard | The same error object is raised, and the session root is still removed: `V:131-143` |
| The public error is unchanged | `runCodexVerifier` | `VES_TASK_FAILED` with exactly one safe detail, `reason`, in every refusal of `V` (`failedWith`, `V:35-41`); the subscription case of `codex-identity.test.mjs` still answers `VES_TASK_VERIFIER_FAILED` |

### Behaviour changes

1. A caller that is already cancelled starts no Codex process. Before, the
   driver was started and answered `VES_DRIVER_CANCELLED`.
2. A stop cancels the announced session through the runner, which stops the
   Codex process at once. Before, an abort sent `turn/interrupt` and killed the
   process after the 250 ms grace period.
3. The `reason` detail of a session that did not complete is more specific.
   A caller's cancel is `VES_EXECUTOR_CANCELLED` and the meter's refusal is the
   meter's code (`VES_BUDGET_MODEL_UNKNOWN`, `VES_BUDGET_USAGE_INVALID`).
   Before, both were `VES_TASK_VERIFIER_FAILED`. The public code stays
   `VES_TASK_FAILED`, and a run whose signal was aborted still ends `ABORTED`.
4. An error from the metering that is not the meter's own refusal is raised as
   itself. Before, it stopped the session and was reported as
   `VES_TASK_VERIFIER_FAILED`. For `vestra task` the run then fails with that
   error's own code, or `VES_TASK_RUN_FAILED` when it has none, instead of
   `VES_TASK_FAILED`.

### Tests changed

None deleted and none modified. Added: `V` (9 cases) with its fixture, and a
neutral liveness helper, `tests/helpers/process-liveness.mjs`. The labeled fake
Codex gains `verifier-scenario:hang`, a turn that never answers, and writes the
process of each turn to a log of its own, `fake-codex-turn.log`; no existing
reader of its other log is affected. The fixture kills, by identifier, every
process named in such a log when the suite ends, so a failing case cannot keep
the suite alive.

### Discrimination (disposable copy)

Same method as for C4-1, on a copy of the tree at `11df689`. Suites run: `V`,
`tests/integration/codex-identity.test.mjs` and
`tests/unit/task-cli-composition.test.mjs`. Unmutated copy: 31 passed, 0 failed.

| Mutation in the copy of `task-codex.ts` | Failing cases |
| --- | --- |
| **The verifier as it was before this range** (the file of `e17abb3`: no runner, no cancel, every metering error swallowed) | 5 in `V`: `V:44-52`, `V:54-79`, `V:123-129`, `V:131-143`, `V:155-164` |
| The session ignores the caller's signal | 3: `V:44-52`, `V:54-79`, `V:155-164` |
| The session ignores the verifier's own stop | 3: `V:92-101`, `V:103-121`, `V:123-129` |
| **Every metering error is swallowed and stops the session** | 1: `V:131-143` |
| The meter's refusal is not kept | 1: `V:123-129` |
| A budget verdict does not stop the session | 2: `V:92-101`, `V:123-129` |
| There is no duration timer | 1: `V:103-121` |
| A caller's cancel is reported as a verifier that failed | 2: `V:44-52`, `V:54-79` |
| A reached ceiling is reported as a verifier that failed | 3: `V:92-101`, `V:103-121`, `V:155-164` |
| The meter's refusal is reported as budget exceeded | 1: `V:123-129` |
| The outcome is not read | 7: 6 in `V` and the subscription verifier without a login in `codex-identity.test.mjs` |
| The session root is left behind | 7: 5 in `V` and the two completed verifier sessions in `codex-identity.test.mjs` |
| Usage is metered against another model | 2: `V:81-90`, `V:92-101` |
| Usage events are not metered | 4 in `V` |
| The caller's cancel outranks a reached ceiling | 1: `V:155-164` |
| The verdict text is not collected | 4: 2 in `V`, 2 in `codex-identity.test.mjs` |

All 16 mutations failed at least one case. A mutation that removes a stop makes
its case run into its own time limit; the copy is then run with a limit for the
whole suite, so that a fake left running cannot keep the run alive.

### Guardrails

- Complexity baseline: no entry changed, no key added or moved. The new
  functions are below the target of 10.
- Census: no file gained or lost `JSON.stringify` or `createHash`.
- No `file.ts:line` citation of `task-codex.ts` exists in `docs` or `.specs`.
- No file under `docs/qualification/` changed. Migration count (12) and runtime
  error catalog count (19) unchanged. No public error code was added, removed
  or changed: the reasons above are values of the existing `reason` detail of
  `VES_TASK_FAILED`, and each is a code that already exists.
- `tests/mutation/*` and the fault-injection suites pass unmodified.

### Gates (Node 24.14.0, macOS arm64)

Measured on a detached checkout of `11df689`, the one code commit of the range.

| Command (at `11df689`) | Result |
| --- | --- |
| `V`, `codex-identity.test.mjs`, `tests/unit/task-cli-composition.test.mjs`, `tests/security/task-cli-security.test.mjs` | PASS — 40 |
| `pnpm gate:quick` | PASS — unit 2482, agent-readiness 323, census 13 |
| `pnpm test:architecture` | PASS — 76 |
| `pnpm gate:build` | PASS — unit 2482, contract 756, integration 919, e2e 238, architecture 76, build 146, qualification 296 |
| `pnpm gate:security` | PASS — unit 2482, contract 756, e2e 238, architecture 76, qualification 296, security 1339, fault 310 |
| `pnpm test:fault` | PASS — 310 |
| `pnpm test:contract` | PASS — 756 |
| `pnpm test:integration` | PASS — 919 |
| `pnpm qualify:claude` | PASS — 53 |
| `pnpm qualify:codex` | PASS — 20 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 23 |
| `pnpm agent:check` | PASS |

No test was skipped in any stage. No provider session was started and no login
was needed. `qualify:keychain` was not run.

### Open points for the reviewer

- **The reason of a metering refusal.** The verifier now reports the meter's
  own code in the `reason` detail, as the executor raises the meter's own
  error. The alternative was to keep `VES_TASK_VERIFIER_FAILED` for it, which
  says less and is what a swallowed error looked like.
- **The verifier is stopped at once.** The runner cancels a stopped session, so
  Codex is killed without the `turn/interrupt` grace period. The driver's own
  abort path is unchanged and still interrupts first.
- **Platform matrix.** As for C4-1.

## C4-3 (T4c) — the two Self-Test scenarios adopt the runner

`S` is `tests/integration/self-test-verifier-session.test.mjs` and `Y` is
`tests/architecture/driver-session-runner-locality.test.mjs`.

`exercise` in `apps/vestra-cli/src/self-test-driver-scenario.ts` and
`runVerifierDriverSession` in `apps/vestra-cli/src/self-test-full-scenario.ts`
lose their own start and close and run their session through
`runDriverSession`. The `drivers` scenario still takes its facts from the
lifecycle events alone. The `full` scenario records its verifier session only
when the runner reports it completed.

The runner hands an observer the driver's own event type: `DriverSessionPort`
and `DriverSessionRun` carry it as a parameter that defaults to the widest
shape, so a scenario that holds a `Driver` collects `DriverEvent` and the
adapter is unchanged. It is a type-only change.

`runVerifierDriverSession` is exported and takes the driver commands, as
`resolveDriverBinding` already does, because no test could reach its refusal
before.

### Requirement evidence

| Clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| The `drivers` scenario runs its three sessions through the runner | `exercise` | `tests/integration/self-test-driver-scenario.test.mjs` (unmodified, 5 cases): three sessions started and closed, the check catalog, no writer request. `Y:64-79` names it as a consumer |
| The `full` scenario's verifier session runs through the runner | `runVerifierDriverSession` | Completed, read-only and closed, on the driver the binding names: `S:18-28`, `S:30-34`. `tests/integration/self-test-full-scenario.test.mjs`, the Self-Test end-to-end suite and the crash matrix pass unmodified. `Y:64-79` |
| A verifier session that does not complete is refused | `runVerifierDriverSession` | A driver that reports a qualified version and ends before it answers: `S:36-41` |
| A verifier session that requests a tool is refused | `runVerifierDriverSession`, `assertNoToolRequests` | `VES_VERIFIER_GRANT_INVALID` from the events the runner delivered: `S:45-56` |
| A binding to a driver that is not composed is refused | `verifierDriver` | `S:58-63` |
| The start, observe and close loop is implemented once | the runner | No other source of the composition root or of `agent-runtime` calls `start`: `Y:54-58`. None cancels or closes a session on a driver it holds: `Y:60-62`. The consumers are exactly the adapter, the verifier and the two scenarios: `Y:64-79`. The scan reads both roots and finds the three calls in the runner: `Y:48-52` |
| An observer reads events as the driver types them | `DriverSessionPort`, `DriverSessionRun` | `pnpm typecheck`: both scenarios push the observed events into `DriverEvent[]` |

### Behaviour changes

1. The `full` scenario refuses a verifier session that emitted an error event
   even when its close reports `completed`. Before, only the close was read.
   No driver emits an error event and then closes as completed.

Nothing else changes: the `drivers` scenario never read the outcome of a
session and still does not.

### Tests changed

None deleted and none modified. Added: `S` (5 cases) with two labeled fakes
under `tests/helpers/self-test-fakes/`, and `Y` (4 cases).

### Discrimination (disposable copy)

Same method, on a copy of the tree at `60f619e`. Suites run:
`tests/integration/self-test-driver-scenario.test.mjs`, `S`,
`tests/integration/self-test-full-scenario.test.mjs`,
`tests/unit/self-test-driver-binding.test.mjs`, `Y`, `R` and `D`. Unmutated
copy: 67 passed, 0 failed.

| Mutation in the copy | Failing cases |
| --- | --- |
| **The `drivers` scenario as it was before this range** (the file of `e17abb3`: start and close by hand) | 3: `Y:54-58`, `Y:60-62`, `Y:64-79`. Its five behaviour cases still pass, which is the evidence that the scenario's behaviour did not change |
| **The `full` scenario as it was before this range** (the file of `e17abb3`) | 4: the same three cases of `Y`, and `S` as a whole, which cannot load without the seam |
| The `full` scenario records a verifier session whatever its outcome | 1: `S:36-41` |
| The `full` scenario does not observe its verifier session | 1: `S:45-56` |
| The `full` scenario does not check its verifier session for tool requests | 1: `S:45-56` |
| The verifier session ignores the commands it is given | 2: `S:36-41`, `S:45-56` |
| The verifier session always runs on Codex | 2: `S:45-56`, `S:58-63` |
| The `drivers` scenario does not observe its sessions | 5: every case of `self-test-driver-scenario.test.mjs` |
| The `drivers` scenario runs no session | 6: the same five and `Y:64-79` |
| The verifier of `vestra task` closes its session a second time by hand | 1: `Y:60-62` |

All 10 mutations failed at least one case. One more was checked with the
compiler, because no test can see a type: with the observer typed as the widest
event again, `pnpm typecheck` fails in both scenario sources.

### Guardrails

- Complexity baseline: no entry changed, no key added or moved.
- Census: no file gained or lost `JSON.stringify` or `createHash`.
- Citation fixed in `.specs/features/architecture-deepening/validation-c5.md`:
  the verification ports of the full scenario, now
  `self-test-full-scenario.ts:731-772`. The other citations of that file in
  `.specs` name lines of earlier revisions and were already stale.
- No file under `docs/qualification/` changed. Migration count (12) and runtime
  error catalog count (19) unchanged. No public error code was added, removed
  or changed.
- `tests/mutation/*`, the fault-injection suites and the Self-Test suites pass
  unmodified.

### Gates (Node 24.14.0, macOS arm64)

Each row was measured on a detached checkout of exactly that commit.

| Commit | `pnpm gate:quick` | `pnpm test:architecture` | Focused suites |
| --- | --- | --- | --- |
| `b4984f9` the typed observer | PASS — unit 2482, agent-readiness 323, census 13 | PASS — 76 | `R`, `D`, `A`: PASS — 49 |
| `cfa6433` the two scenarios | PASS — 2482, 323, 13 | PASS — 76 | `self-test-driver-scenario.test.mjs`, `S`, `self-test-full-scenario.test.mjs`, `self-test-driver-binding.test.mjs`: PASS — 25 |
| `60f619e` the locality test | PASS — 2482, 323, 13 | PASS — 80 | `Y`, the four suites above and `tests/e2e/self-test-cli-e2e.test.mjs`: PASS — 39 |

At the last code commit of the range:

| Command (at `60f619e`) | Result |
| --- | --- |
| `pnpm gate:build` | PASS — unit 2482, contract 756, integration 924, e2e 238, architecture 80, build 146, qualification 296 |
| `pnpm gate:security` | PASS — unit 2482, contract 756, e2e 238, architecture 80, qualification 296, security 1339, fault 310 |
| `pnpm test:fault` | PASS — 310 |
| `pnpm test:contract` | PASS — 756 |
| `pnpm test:integration` | PASS — 924 |
| `pnpm qualify:claude` | PASS — 53 |
| `pnpm qualify:codex` | PASS — 20 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 23 |
| `pnpm agent:check` | PASS |

No test was skipped in any stage. No provider session was started and no login
was needed. `qualify:keychain` was not run.

### Open points for the reviewer

- **The seam on the verifier session.** `runVerifierDriverSession` is exported
  and takes the driver commands so that its two refusals can be reached. The
  alternative was to leave them untested, as they were.
- **The locality test reads source text.** It forbids a call to `start` in the
  composition root and in `agent-runtime` outside the runner. A source that
  needs another `start` method there will have to say why in that test.
- **Platform matrix.** As for C4-1.

## C4-4 (T4d) — process-tree termination

`Q` is `tests/helpers/process-tree-fixture.mjs`, whose `processTreeSuite` holds
the cases the two qualification suites run:
`spikes/claude-code-driver/test/claude-driver-process-tree.test.mjs` under
`pnpm qualify:claude` and
`spikes/codex-driver/test/codex-driver-process-tree.test.mjs` under
`pnpm qualify:codex`. `N` is `tests/integration/process-tree-termination.test.mjs`,
`P` is `tests/integration/driver-process-tree.test.mjs`, `K` is
`tests/integration/task-process-tree.test.mjs`, `X` is
`tests/architecture/provider-process-tree-termination.test.mjs`, `V` is the
verifier suite of C4-2, and `E` is `tests/e2e/task-cli-e2e.test.mjs`.

Every process these suites start is a labeled fake or an idle Node process the
fake started. Each is killed by its identifier when its case ends, and nothing
outside those identifiers is signalled. The fakes' `fork` mode starts one
process that stays in the provider's group and inherits its output, and one
that leaves the group with `setsid()`.

### What moved where

| Knowledge | Before | Now |
| --- | --- | --- |
| How a tree is killed, escapees included | Inline in the probe host | `terminateProcessTree` in `packages/platform-node/src/process-tree-terminator.ts`, exported to the composition root; the probe host calls it |
| Which group a provider runs in, and the terminator a driver uses when none is injected | Twice, one expression in each driver, signalling one process | `packages/drivers/src/driver-process-tree.ts` (`OWN_PROCESS_GROUP`, `processTreeTerminator`) |
| The terminator `vestra task` injects | Two single-process `SIGKILL`s, in `task-implementer.ts` and `task-codex.ts` | `ProviderProcesses` in `apps/vestra-cli/src/task/task-process-tree.ts`, whose sessions hand a driver its terminator |

`packages/drivers` imports nothing from `packages/platform-node`.

### Requirement evidence

| Clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| The drivers start their child in its own process group | `ClaudeCodeDriver#start`, `CodexDriver#start`, `OWN_PROCESS_GROUP` | In each qualification suite the provider leads a group that is not the caller's, one descendant is in it and one is not, before anything is stopped: `assertTreeRunning`, `Q:62-69`. Source: `X:29-34`, `X:37-42`, `P:34-36` |
| A cancel terminates the whole tree, a `setsid` escapee included | ledger `stop` hook → `ProviderProcesses` → `terminateProcessTree` | Claude Code and Codex: `Q:118-139`. The run ends, which it cannot while a descendant holds the provider's output |
| An aborted start signal terminates the whole tree | the drivers' abort paths | Claude Code and Codex: `Q:141-154` |
| With no terminator injected the group is still stopped | `processTreeTerminator` | `Q:156-178`, where the escapee survives, which is why the composition injects one; `P:38-42`, `P:44-51`, `P:53-59` |
| The tree routine itself | `terminateProcessTree` | A group signal alone leaves the escapee: `N:43-56`. The tree routine leaves nothing: `N:58-71`. A tree already gone: `N:73-79`. The probe host's fault suite, which requires the same property, passes unmodified |
| The CLI injects the tree terminator into both drivers | `implementerAdapter`, `runCodexVerifier` | Verifier, as composed: `V:170-195`. Implementer, through the `vestra` binary on macOS: `E:729-755`. Both, by source: `X:47-68`. The single-process `SIGKILL`s are gone: `X:70-84` |
| The injected terminator never rejects | `ProviderProcesses#terminate` | A live provider, a tree already gone, and a kill the runtime refuses: `K:37-49`, `K:71-79`; a tree its final check still sees alive: `K:51-69` |
| One termination per child on the Claude Code failure path | `ClaudeCodeDriver#start` | `P:64-75` |
| `drivers` does not import `platform-node` | package edges | `tests/architecture/repository-boundaries.test.mjs` (unmodified); `X:37-42` |
| Windows stays refused for the mediated path | `mediatedProfile`, the task command | Unchanged and still asserted by the mediated suites on win32. On win32 the three cases of `Q` assert that a stopped session ends, its terminal event says cancelled, and its provider is gone (`stoppedOnWin32`, `Q:83-106`); `V` and `E` assert the refusal of the task path |
| Both drivers are requalified with new reports | `docs/qualification/` | `claude-code-driver-process-tree.md` and `codex-driver-process-tree.md` are new. No existing report is edited |

### Behaviour changes

1. Stopping a provider kills everything it started. Before, one process was
   killed, and a descendant that held the provider's output kept the session
   and `vestra task cancel` waiting.
2. A provider no longer receives the terminal's signals. Ctrl-C reaches
   `vestra`, which aborts the run and kills the tree with `SIGKILL`.
3. If the `vestra` process is killed with `SIGKILL`, nothing stops the
   provider. A hang-up and a termination request are answered by `vestra`
   itself, which stops the providers; see the continuation of this section.
4. A stop takes as long as reading the process table and confirming that the
   group is gone, at most about half a second more than one signal.
5. A driver composed without a terminator sends its `SIGTERM` to the provider's
   group, and a fallback that finds nothing left to stop no longer rejects.

### Tests changed

None deleted. One existing file gained a case and no existing case changed:
`E` (appended at its end, so no cited line moves). Added: `N` (3 cases), `P`
(5), `K` (2), `X` (5), one case in `V`, three cases in each qualification
suite, and the `fork` and `chatter` modes of the labeled fakes.

### Discrimination (disposable copy)

Same method, on a copy of the tree at `a9d3003`. Suites run: the two
qualification suites, `N`, `tests/integration/process-tree-terminator.test.mjs`,
`P`, `K`, `V`, `X`, `tests/fault-injection/out-of-process-probe-host-faults.test.mjs`,
`tests/contract/driver-lifecycle-matrix.test.mjs`, and the Claude Code and
Codex lifecycle suites. Unmutated copy: 99 passed, 0 failed. `E` is
not among them: under a mutation that removes a stop it runs into a
five-minute limit, and `V` and `X` cover the same wiring.

| Mutation in the copy of the terminator | Failing cases |
| --- | --- |
| **The tree terminator records no descendants** | 7: `N:58-71`, the probe host's tree case, `V:170-195`, and the cancel and abort cases of both qualification suites |
| The tree terminator does not kill what it recorded | 7: the same |
| The tree terminator does not kill the group | 10: `N:58-71`, `N:73-79`, `K:37-49`, three cases of `V`, and the cancel and abort cases of both qualification suites |
| The descendants are recorded after the group is killed | 7: the same as the first row |
| The probe host kills only the group | 1: the probe host's tree case |

| Mutation in the copy of a driver | Failing cases |
| --- | --- |
| **Claude Code starts its provider in the caller's process group** | 4: its three qualification cases and its row of `X:29-34` |
| **Codex starts its provider in the caller's process group** | 7: its three qualification cases, its row of `X:29-34`, and three cases of `V` |
| The fallback signals the provider process alone | 3: the fallback case of both qualification suites, `X:37-42` |
| The fallback rejects when nothing is left to stop | 1: `P:53-59` |
| The injected terminator is ignored | 11: `P:38-42`, `P:64-75`, `V:170-195`, the cancel and abort cases of both qualification suites, the running-cancel row of both drivers in the lifecycle matrix, and the abort case of each lifecycle suite |
| Claude Code starts a termination for every failing line | 1: `P:64-75` |
| The Claude Code cancel does not stop the provider | 3: its cancel and fallback cases of `Q`, and its running-cancel row of the lifecycle matrix |
| The Codex cancel does not stop the provider | 3: its cancel and fallback cases of `Q`, and its running-cancel row of the lifecycle matrix |
| The Codex abort timer does not escalate to the terminator | 2: the Codex abort case of `Q:141-154` and "Codex abort sends protocol interrupt before process-tree termination" |

| Mutation in the copy of the task composition | Failing cases |
| --- | --- |
| **The task composition kills the provider process alone** (as before this range) | 6: `V:170-195`, the cancel and abort cases of both qualification suites, `X:70-84` |
| The task composition's terminator rejects when the kill fails | 1: `K:71-79` |
| The verifier is built without the tree terminator | 2: `V:170-195`, `X:47-68` |
| The implementer is built without the tree terminator | 1: `X:47-68` |
| A task source kills one process itself | 2: `X:47-68`, `X:70-84` |

All 19 mutations failed at least one case. A mutation that leaves a
provider or a descendant alive makes its case run into its own time limit and
leaves processes behind; the copy is then run with a limit for the whole suite,
and whatever still runs from the copy is killed after each run.

One thing the mutations show and the sources state: the tree terminator
addresses the provider's group, so it stops nothing when the provider does not
lead one. The two changes belong together, and `X` fails if either is dropped.

### Guardrails

- Complexity baseline: no entry changed, no key added or moved.
  `packages/drivers/src/claude-code-driver.ts :: Async method 'start'` stays 24
  and `packages/drivers/src/codex-driver.ts :: Async method 'start'` stays 27.
- Census: no file gained or lost `JSON.stringify` or `createHash`.
- Citations fixed: `.specs/features/live-task-pilot/validation.md` (the
  mediated minimum, now `claude-code-driver.ts:68`, and the Codex minimum, now
  `codex-driver.ts:97`) and
  `.specs/features/platform-qualification-matrix/matrix.md` (the same Codex
  line). `process-tree-terminator.ts` grew at its end, so the citations of its
  lines 12-37, 24, 32 and 44 do not move. `E` and
  `tests/integration/process-tree-terminator.test.mjs` are cited by line
  elsewhere; `E` grew at its end and the other is untouched.
- Qualification reports: two new files under `docs/qualification/`; no
  existing report is edited. The driver reports are named by path and are not
  bound by digest. The three digest-bound reports of `credential-store.ts`
  keep their digests (`tests/security/os-secret-backend-security.test.mjs`,
  unmodified, recomputes them under `gate:security`).
- Migration count (12) and runtime error catalog count (19) unchanged. No
  public error code was added, removed or changed.
- `tests/mutation/*` and the fault-injection suites pass unmodified.
- Documentation: `docs/quick-start.md` names the new limit, and
  `.specs/features/governed-task-cli/design.md` lists the new task source.
  `pnpm site:check` passes (135 pages, internal links valid).

### Gates (Node 24.14.0, macOS arm64)

Each row was measured on a detached checkout of exactly that commit.

| Commit | `pnpm gate:quick` | `pnpm test:architecture` | Focused suites |
| --- | --- | --- | --- |
| `a1e8f0f` the tree routine | PASS — unit 2482, agent-readiness 323, census 13 | PASS — 80 | `N`, the group terminator suite, the probe host's fault suite: PASS — 10 |
| `58e595c` the drivers' process group | PASS — 2482, 323, 13 | PASS — 80 | `P`, the lifecycle matrix, the Claude Code and Codex lifecycle and contract suites: PASS — 103 |
| `2d2e916` the task composition | PASS — 2482, 323, 13 | PASS — 85 | `K`, `V`, `X`, the two qualification suites: PASS — 23 |
| `a9d3003` the two reports | PASS — 2482, 323, 13 | PASS — 85 | `K`, `P`, `N`, `V`, `X`, the two qualification suites: PASS — 31 |

At the last commit of the range outside `.specs`:

| Command (at `a9d3003`) | Result |
| --- | --- |
| `pnpm gate:build` | PASS — unit 2482, contract 756, integration 935, e2e 239, architecture 85, build 146, qualification 302 |
| `pnpm gate:security` | PASS — unit 2482, contract 756, e2e 239, architecture 85, qualification 302, security 1339, fault 310 |
| `pnpm test:fault` | PASS — 310 |
| `pnpm test:contract` | PASS — 756 |
| `pnpm test:integration` | PASS — 935 |
| `pnpm qualify:claude` | PASS — 56 |
| `pnpm qualify:codex` | PASS — 23 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 24 |
| `pnpm test:mutation` | PASS — 8 |
| `pnpm agent:check` | PASS |

No test was skipped in any stage. No provider session was started and no login
was needed. `qualify:keychain` was not run. After the suites no process they
started was left running.

### Not verified here

- **The platform matrix.** Every result above is from macOS arm64. This range
  is platform-specific: process groups, `setsid()`, `ps`, and `taskkill` on
  Windows. The first matrix run on the branch and what it found are in the
  continuation of this section; a run on the tip that carries the fix, green
  on all five targets, is required before merge.
- **A real provider.** See "What was not observed" in the two reports.
- **The site's browser and Lighthouse stages.** `pnpm site:test` could not
  start its preview server on this machine because another workspace held its
  port. Its unit stage (50 cases), `astro check`, the build and the built-site
  check passed through `pnpm site:check`.

### Open points for the reviewer

- **A tree that could not be confirmed gone** and **the terminal's hang-up**
  were open here. Both are settled in the continuation of this section.
- **The verifier is stopped at once.** See C4-2.
- **`detached` also gives the provider a session of its own.** It has no
  controlling terminal. Neither provider reads one in the modes Verchestra
  uses, but that is a statement about the real CLIs that the fakes cannot
  make, and it is listed in the reports.

## The branch after its last rebase

After the measurements above the branch was rebased onto `1cb85d9`, which
changed two `.specs` files upstream, and the opening comment of three test
helpers gained its prefix. Nothing else changed. Every commit was then measured
again on a detached checkout of exactly that commit (Node 24.14.0, macOS
arm64). "Full set" is the set of the tables above: `pnpm gate:quick`,
`pnpm test:architecture`, `pnpm gate:build`, `pnpm gate:security`,
`pnpm test:fault`, `pnpm test:contract`, `pnpm test:integration`,
`pnpm qualify:claude`, `pnpm qualify:codex`, the two end-to-end suites and
`pnpm agent:check`.

| Task | Commit | Measured | Result |
| --- | --- | --- | --- |
| T4a | `59c18b6` the metering step | `gate:quick`, `test:architecture` | PASS — unit 2482, agent-readiness 323, census 13; architecture 76 |
| T4a | `d44df7d` the runner and its suites | `gate:quick`, `test:architecture` | PASS — unit 2482, agent-readiness 323, census 13; architecture 76 |
| T4a | `e098423` the adapter delegates | Full set | PASS — unit 2482, contract 756, integration 910, e2e 238, architecture 76, build 146, qualification 296, security 1339, fault 310, `qualify:claude` 53, `qualify:codex` 20, end-to-end suites 23 |
| T4a | `ecd1a6c` evidence and decision | `gate:quick`, `test:architecture`, `agent:check` | PASS — unit 2482, agent-readiness 323, census 13; architecture 76 |
| T4b | `8c8ef65` the verifier adopts the runner | Full set | PASS — unit 2482, contract 756, integration 919, e2e 238, architecture 76, build 146, qualification 296, security 1339, fault 310, `qualify:claude` 53, `qualify:codex` 20, end-to-end suites 23 |
| T4b | `cea4975` evidence | `gate:quick`, `test:architecture`, `agent:check` | PASS — unit 2482, agent-readiness 323, census 13; architecture 76 |
| T4c | `2f28bef` the typed observer | `gate:quick`, `test:architecture` | PASS — unit 2482, agent-readiness 323, census 13; architecture 76 |
| T4c | `38ab983` the two scenarios | `gate:quick`, `test:architecture` | PASS — unit 2482, agent-readiness 323, census 13; architecture 76 |
| T4c | `39e8dda` the locality test | Full set | PASS — unit 2482, contract 756, integration 924, e2e 238, architecture 80, build 146, qualification 296, security 1339, fault 310, `qualify:claude` 53, `qualify:codex` 20, end-to-end suites 23 |
| T4c | `da21d40` evidence | `gate:quick`, `test:architecture`, `agent:check` | PASS — unit 2482, agent-readiness 323, census 13; architecture 80 |
| T4d | `d1d234d` the tree routine | `gate:quick`, `test:architecture` | PASS — unit 2482, agent-readiness 323, census 13; architecture 80 |
| T4d | `2a17924` the drivers' process group | `gate:quick`, `test:architecture` | PASS — unit 2482, agent-readiness 323, census 13; architecture 80 |
| T4d | `7790868` the task composition | `gate:quick`, `test:architecture` | PASS — unit 2482, agent-readiness 323, census 13; architecture 85 |
| T4d | `982c74e` the two reports | Full set | PASS — unit 2482, contract 756, integration 935, e2e 239, architecture 85, build 146, qualification 302, security 1339, fault 310, `qualify:claude` 56, `qualify:codex` 23, end-to-end suites 24 |

No test was skipped in any stage.

A first attempt ran three of the full sets at once, and two of them failed in
the end-to-end stage while the machine's disk, which had under 8 GB free, was
full. Three cases reported `ENOSPC` directly. In the same runs a launcher
rollback case failed twice and one task start found its run still active; no
cause other than the full disk was established for those three. The runs were
stopped and repeated one at a time, which is the table above, and every one of
those cases passed in each of them.

## C4-4, continued — interrupts, the unconfirmed tree, and the Windows matrix failure

Three commits on top of the range, added after its first review and its first
platform matrix run. The decisions were numbered and the branch rewritten in
between, so the commits of this continuation are named by their identifiers on
the rewritten branch. `I` is `tests/integration/task-provider-interrupt.test.mjs`
and its stand-in command is `tests/helpers/provider-interrupt-child.mjs`; `K`,
`P`, `X`, `Q`, `V` and `E` are the suites named above, at their current lines.

### What the review found

Starting a provider in a process group of its own took it out of reach of the
terminal's signals. A closed terminal used to deliver the hang-up to the
provider as well, and both died. After the first three commits of this range
the provider survived a hang-up with no command left to act for, and kept
spending until it gave up. That is the orphan this task exists to remove.

### Requirement evidence

| Clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| SIGHUP or SIGTERM while a provider runs stops every provider tree the command started | `ProviderProcesses#interrupt` → the tree terminator | A real child command, both signals, both drivers, three processes of which one left the group: `I:66-96`. Through the `vestra` binary on macOS, during the implementer and during the verifier: `E:812-856` |
| The command then ends as the signal would have ended it | `endBySignal` | Exit by that signal, no exit code: `I:66-96`, `E:812-856` |
| No abort and no cancel marker is recorded; the run stays resumable | `ProviderSession#end`, `ProviderSession#unlessInterrupted`, `implementerAdapter`, `runCodexVerifier` | Neither the effect nor the continuation of the stand-in command is reached: `I:66-96`. The state is still `IMPLEMENTING` or `VERIFYING`, the command printed no outcome, no `cancel.json` and no `outcome.json` exist, `start` is refused, and `task resume` reaches `HUMAN_REVIEW` with the task's change: `E:812-856` |
| SIGINT keeps its cancel | `watchCancellation` | The tree is stopped and the run is `ABORTED`: `E:860-881`. The provider processes never listen to it: `K:81-112`, `I:66-96` (handler counts), `X:88-99` |
| Nothing else changes its signal behaviour | `ProviderProcesses#track`, `#untrack`, `watchCancellation` | The handlers exist only while a provider is tracked, one per signal however many providers run, and are gone with the last: `K:81-112`. A session that ends by itself leaves none and is not held back: `I:123-135`. SIGTERM while a gate runs still cancels: the command is not ended, the gate passes, the run is `ABORTED`, the verifier never starts: `E:887-907` |
| The wait is bounded | `INTERRUPT_BACKSTOP_MS` | A tree routine that never returns: the command still ends by the signal, after the backstop and well within it: `I:101-121` |
| Implementer and verifier are both covered | `implementerAdapter`, `runCodexVerifier` | Each builds its driver with the session's terminator and spawn observer and ends its session: `X:47-68`; behaviour: `E:812-856` for both |
| A tree not confirmed stopped is named on stderr, once, and the terminator still never rejects | `ProviderProcesses#terminate` | The final check still sees a member alive: one line per process group, exact text, naming the provider and the group id and giving the command that stops it, and every request resolves: `K:51-69`. A kill the runtime refuses: `K:71-79`. A tree that was stopped produces no line: `K:37-49`, `Q:118-139`, `Q:141-154`, `I:66-96`, `E:812-856` |
| On Windows the task path stays refused | the task command | Every case of `I` asserts that refusal there; off macOS every new case of `E` asserts that the task path reports not configured |

### The Windows matrix failure

The matrix ran on the rewritten branch before this continuation. The security
gate passed on all five targets (run 37035214438). The build gate passed on
four and failed one case on Windows x64 (run 37035210650): `D:127-147`, row
`claude-code`, where the one terminal event had the outcome `cancelled` and no
reason. The Codex and Pi rows passed there, and every other target passed the
Claude Code row.

Cause, read from the sources and not observed on Windows here: a stop reaches a
driver twice, through its start signal and through `cancel`, and the Claude
Code driver asked its terminator on both paths. On POSIX a second signal to a
process that has not been reaped is accepted. On Windows a kill of a process
that has exited is an error. The test's terminator does not contain that
error, so the second request rejected, the cancel failed before the session
ledger emitted its terminal event, the runner contained the failure as it is
specified to (`R:239-250`), and the terminal event then came from the close,
with the outcome and without the reason. Codex did not fail because its abort
path waits out a grace period and asks only for a provider that is still
running.

It is a driver defect and not a test that assumed POSIX timing: any
terminator that fails on a second request loses the reason of a stop, on any
platform. The fallback the drivers had before this task was such a terminator
on Windows; the fallback of this task and the tree terminator are not. The
case the matrix failed is unchanged.

| Clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| A child is terminated once, whoever asks | `singleTermination` | Overlapping requests share one termination, and one that failed is tried again: `P:77-91`. A stream that keeps failing: `P:64-75` |
| A stop keeps its reason although the terminator fails on a second request | `ClaudeCodeDriver#start`, `CodexDriver#start` | The failure reproduced on every platform, for both drivers: one request, one terminal event with `cancelled` and the runner's reason: `P:103-141` |

### Behaviour changes

1. A closed terminal, or a `kill` of the `vestra` process, while a provider is
   running stops everything the provider started and ends `vestra`. The run is
   not aborted and `task resume` continues it. Before this range a hang-up
   killed `vestra` and the provider together and left the same resumable run.
2. **SIGTERM while a provider runs no longer cancels the run.** It used to
   abort it, recorded as a human abort. It still cancels at any moment when no
   provider is running, a gate for example. SIGINT is unchanged.
3. Under `nohup` a hang-up used to be ignored by `vestra` and by the provider.
   `vestra` now answers it while a provider runs, so it ends both; the run can
   be resumed. The runtime gives no way to see that a signal was being ignored.
4. A provider tree that was not confirmed stopped is named on stderr with the
   command that stops it.
5. An interrupted command prints no outcome and exits by the signal.

### Residual risk

`SIGKILL` of the `vestra` process cannot be handled in the process, and no
watchdog is built for it. The provider then runs until its closed pipes make
it exit. What a user does: the provider's process group id is the process id
of the `claude` or `codex` process, so `kill -KILL -- -<pid>` stops the whole
group; `task status` then shows the run as not active with `resume` and
`cancel` as its next actions, and either continues or ends it. This is in
`docs/quick-start.md`, in the decision entry and in the two reports.

A provider that is killed while a tool effect of its session is in flight
leaves that effect as a killed command leaves it; effects asked for after the
signal are not made.

### Tests changed

No case was deleted. Changed, each in a commit of this continuation:

| Suite | Change | Why |
| --- | --- | --- |
| `K` | Rewritten for `ProviderProcesses`: 2 cases became 5 | The function it tested, `terminateProviderTree`, is now a method of the provider processes. Its two assertions are kept (`K:37-49`, `K:71-79`); the second now also requires the line on stderr |
| `X` | The case on the injected terminator asserts the session's terminator and spawn observer instead of the function's name; the case on signals allows the one signal the command sends to itself; one case added | The wiring it pins changed with the provider processes |
| `Q` and the two qualification suites | Take the terminator from a provider session, and assert that it reported nothing | Same reason |
| `E` | Its cancel journey asserts the off-macOS refusal instead of returning; 6 cases appended | No case may pass without asserting |

Added: `I` (6 cases) with its stand-in command, 3 cases in `P`, a pause for the
gate script of the task fixture, and a flag file by which a test steers the
labeled fakes between two runs of one request.

### Discrimination (disposable copy)

Same method. Interrupts and the report, on a copy of the tree at `99ea171`;
suites run: `I`, `K`, `X`, `V` and the two qualification suites. Unmutated
copy: 33 passed, 0 failed.

| Mutation in the copy | Failing cases |
| --- | --- |
| **No interrupt handler is installed** | 6: the four signal cases of `I`, its backstop case, `K:81-112`. Through the binary, run separately: both SIGHUP journeys of `E` fail with "provider outlived the command" |
| **The command ends by the signal without stopping its providers** | 5: the four signal cases of `I` and its backstop case |
| The command stops its providers and does not end | 5: the same |
| The command ends with an exit code instead of the signal | 6: the same and `X:70-84` |
| **A session that ended is not held when the command is being interrupted** | 4: the four signal cases of `I` |
| An effect of the session still runs after the signal | 4: the same |
| The handlers stay installed after the last provider ended | 2: `K:81-112`, `I:123-135` |
| There is no backstop for a tree routine that never returns | 1: `I:101-121` |
| SIGINT is answered like a hang-up | 5: the four signal cases of `I` and `X:88-99` |
| **A tree that was not confirmed stopped is not reported** | 2: `K:51-69`, `K:71-79` |
| It is reported on every request | 1: `K:51-69` |
| The terminator rejects when the tree was not confirmed stopped | 2: `K:51-69`, `K:71-79` |
| The report does not name the provider | 2: the same |
| The report does not name the process group | 1: `K:51-69` |
| A termination request cancels the run even while a provider runs | 1: `X:88-99` |
| The implementer driver is built without the spawn observer | 1: `X:47-68` |
| The verifier driver is built without the spawn observer | 1: `X:47-68` |
| The verifier's session is never ended | 1: `X:47-68` |
| The implementer's session is never ended | 1: `X:47-68` |

All 19 mutations failed at least one case. The last five are caught by `X`
alone among these suites. Their behaviour is asserted by `E`, which is not in
the mutation run because a mutation that removes a stop makes its journeys run
into a five-minute limit; the first row shows `E` failing for the one mutation
it was run with.

The single termination, on a copy of the tree at `0331c94`; suites run: `P`,
`D`, the lifecycle matrix, the Claude Code and Codex contract and lifecycle
suites, `X` and the two qualification suites. Unmutated copy: 131 passed,
0 failed.

| Mutation in the copy | Failing cases |
| --- | --- |
| **The Claude Code driver of the previous commit** (the abort path and the cancel each ask the terminator) | 1: the `claude-code` row of `P:103-141`, with the terminal event the matrix saw |
| **The Codex driver of the previous commit** | 1: the `codex` row of `P:103-141` |
| A child is terminated once per request | 4: `P:64-75`, `P:77-91`, both rows of `P:103-141` |
| A termination that failed is remembered | 1: `P:77-91` |
| The Claude Code cancel does not stop the provider | 7 across `P`, `D`, `Q` and the lifecycle matrix |
| The Codex cancel does not stop the provider | 6 across the same |
| The Codex abort timer does not escalate to the terminator | 2: the Codex abort case of `Q` and of its lifecycle suite |
| The Claude Code abort path does not stop the provider | 3: `P:64-75`, the abort case of `Q` and of its lifecycle suite |

All 8 mutations failed at least one case.

### Guardrails

- Complexity baseline: no entry changed, no key added or moved. The two
  `start` methods keep 24 and 27.
- Census: no file gained or lost `JSON.stringify` or `createHash`.
- Citations fixed: `.specs/features/live-task-pilot/validation.md` (the cancel
  poll, the signals, the resume shortcut and the start and resume states of
  `task-run.ts`; the two driver minimums) and
  `.specs/features/platform-qualification-matrix/matrix.md` (the two driver
  minimums), and `validation-c5.md` (the verification ports of
  `task-verifier.ts`). The citations of `Q`, `K`, `P` and `X` in the section
  above are at their current lines.
- Qualification reports: the two reports of this range are corrected in
  place, as they are not merged; no third report is added and no report from
  before this range is edited. The digest-bound reports keep their digests.
- Migration count (12) and runtime error catalog count (19) unchanged. No
  public error code was added, removed or changed. One line of text on stderr
  is new.
- `tests/mutation/*` and the fault-injection suites pass unmodified.
- The pilot's pre-registration is still true: its interruption is a `SIGKILL`
  while a gate runs, and a `SIGTERM` at that moment still cancels the run.

### Gates (Node 24.14.0, macOS arm64)

Each row was measured on a detached checkout of exactly that commit, one
command at a time.

| Commit | `pnpm gate:quick` | `pnpm test:architecture` | Focused suites |
| --- | --- | --- | --- |
| `99ea171` interrupts and the report | PASS — unit 2482, agent-readiness 323, census 13 | PASS — 86 | `I`, `K`, `X`: PASS — 17 |
| `0331c94` the single termination | PASS — 2482, 323, 13 | PASS — 86 | `I`, `K`, `P`, `D`, `V`, `X`, the two qualification suites: PASS — 54 |

| Command (at `0331c94`) | Result |
| --- | --- |
| `pnpm gate:build` | PASS — unit 2482, contract 756, integration 947, e2e 245, architecture 86, build 146, qualification 302 |
| `pnpm gate:security` | PASS — unit 2482, contract 756, e2e 245, architecture 86, qualification 302, security 1339, fault 310 |
| `pnpm test:fault` | PASS — 310 |
| `pnpm test:contract` | PASS — 756 |
| `pnpm test:integration` | PASS — 947 |
| `pnpm qualify:claude` | PASS — 56 |
| `pnpm qualify:codex` | PASS — 23 |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS — 30 |
| `pnpm agent:check` | PASS |

No test was skipped in any stage. No provider session was started and no login
was needed. `qualify:keychain` was not run. After the suites no process they
started was left running.

### Not verified here

- **Windows.** The single termination and every Windows branch of the new
  suites were written without a Windows machine. The diagnosis above explains
  each observation of the failed run, and it is reproduced on POSIX by a
  terminator that behaves as a Windows kill does; that it is the whole cause
  is shown only by the matrix run on this tip.
- **A real provider** and **the site's browser stages**, as above.
