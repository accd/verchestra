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
