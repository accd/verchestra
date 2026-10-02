# Validation — the cancel order, and how a provider child ends (ADP-3 and ADP-4, follow-up)

Two ranges on one branch, `fix/driver-cancel-terminal-event`, each its own pull
request. The first settles the defect ADP-3 recorded and ADP-4 tolerated: what
a driver emits when a running session is cancelled. The second, under its own
heading below, makes every end of a Claude Code or Codex provider go through
the one tree termination per child.

Base revision `77c7b8e`. Sources are named by symbol. Assertions are cited by
test file and line: `L` is `tests/contract/driver-session-ledger.test.mjs`, `M`
is `tests/contract/driver-lifecycle-matrix.test.mjs`, `R` is
`tests/contract/driver-session-runner.test.mjs`, `D` is
`tests/integration/driver-session-runner-drivers.test.mjs`, and `F` is
`tests/helpers/driver-cancel-order-fixture.mjs`, whose `cancelOrderSuite` holds
the cases the four qualification suites run:
`spikes/claude-code-driver/test/claude-driver-cancel-order.test.mjs`,
`spikes/codex-driver/test/codex-driver-cancel-order.test.mjs`,
`spikes/opencode-driver/test/opencode-driver-cancel-order.test.mjs` and
`spikes/pi-runtime/test/pi-driver-cancel-order.test.mjs`.

Nothing here was observed against a real provider session. Claude Code and
Codex run the repository's labeled fake executables, OpenCode its labeled fake
SDK client, and Pi its faux provider.

## Range 1 — the cancel order

The defect: cancelling a running session made a driver emit `session.closed`
with the outcome `cancelled`, then an error event, and `close` then answered
`failed`. The recommendation on record: `cancel()` marks the run cancelled,
nothing follows the terminal event, and `close` answers `cancelled`.

### The four sequences before the change

Recorded before any source changed, and measured again on the sources of
`77c7b8e` in a disposable copy. A session whose provider never answers is
stopped three ways: through `cancel()` alone, through the start signal alone,
and through the start signal followed by `cancel()` in one turn, which is what
the session runner does. `reason` stands for the reason the caller gave.

| Driver | `cancel()` alone | Start signal, then `cancel()` | Start signal alone |
| --- | --- | --- | --- |
| Claude Code | `session.started`, `model.resolved`, `session.closed` (`cancelled`, reason), `error` (`VES_CLAUDE_STREAM_INCOMPLETE`); close `failed` | …, `session.closed` (`cancelled`, reason), `error` (`VES_CLAUDE_ABORTED`); close `cancelled` | …, `error` (`VES_CLAUDE_ABORTED`); the close emits `session.closed` (`cancelled`) |
| Codex | …, `session.closed` (`cancelled`, reason), `error` (`VES_CODEX_PROCESS_FAILED`); close `failed` | …, `session.closed` (`cancelled`, reason), `error` (`VES_CODEX_ABORTED`); close `cancelled` | …, `error` (`VES_CODEX_ABORTED`); the close emits `session.closed` (`cancelled`) |
| OpenCode | …, `session.closed` (`cancelled`, reason); the SDK session is not aborted and the run does not end; a provider that goes on sends `content.delta` and `usage.updated` after the terminal event | …, `session.closed` (`cancelled`, reason), `error` (`VES_OPENCODE_ABORTED`); close `cancelled` | …, `error` (`VES_OPENCODE_ABORTED`); the close emits `session.closed` (`cancelled`) |
| Pi | …, `session.closed` (`cancelled`, reason), `error` (`VES_PI_RUNTIME_FAILED`); close `failed` | …, `session.closed` (`cancelled`, reason), `error` (`VES_PI_RUNTIME_FAILED`); close `failed` | …, `usage.updated`, `error` (`VES_PI_ABORTED`); the close emits `session.closed` (`cancelled`) |

Why, per driver:

- **Claude Code — the child's exit handler.** The cancel terminated the
  provider through the ledger's stop hook, which did not mark the run. The
  ledger emitted the terminal event when the terminator resolved. The run's
  continuation runs on the child's `close` event, afterwards; it saw no abort
  and no result, reported `VES_CLAUDE_STREAM_INCOMPLETE`, and recorded
  `failed` over the ledger's `cancelled`. With the start signal aborted first
  the run was marked, so the late event was `VES_CLAUDE_ABORTED`.
- **Codex — the child's exit handler.** The same, with a process that ended by
  a signal before its turn completed: `VES_CODEX_PROCESS_FAILED`. A cancel
  that arrived while `turn/start` was still unanswered gave the same sequence.
- **OpenCode — nothing was stopped.** The driver gave the ledger no stop hook.
  A cancel recorded the terminal state and the provider went on. With the
  start signal aborted first, the run's own abort report came after the
  terminal event because the cancel emitted that event in the caller's turn.
- **Pi — the cancel's own release.** A cancel aborts the agent, waits until it
  is idle, emits the terminal event, and releases the agent, which resets its
  transcript. The agent is idle before the run's continuation has run, and
  that continuation reads the final message from the transcript. It found none
  and reported `VES_PI_RUNTIME_FAILED`. The start signal changes nothing in
  that, so the session runner's stop ended the same way.

ADP-3 recorded this for Claude Code and Pi. Codex ends the same way, and
OpenCode differently; both are recorded here for the first time.

### The four sequences now

| Driver | `cancel()` alone, and start signal then `cancel()` | Start signal alone |
| --- | --- | --- |
| Claude Code | `session.started`, `model.resolved`, `error` (`VES_CLAUDE_ABORTED`), `session.closed` (`cancelled`, reason); close `cancelled` | unchanged |
| Codex | …, `error` (`VES_CODEX_ABORTED`), `session.closed` (`cancelled`, reason); close `cancelled` | unchanged |
| OpenCode | …, `error` (`VES_OPENCODE_ABORTED`), `session.closed` (`cancelled`, reason); the SDK session is aborted and the server closed; close `cancelled` | unchanged |
| Pi | …, `usage.updated`, `error` (`VES_PI_ABORTED`), `session.closed` (`cancelled`, reason); close `cancelled` | unchanged |

A stop now ends in the sequence an aborted start signal always produced,
followed by the terminal event with the reason of the cancel.

### What moved where

| Knowledge | Before | Now |
| --- | --- | --- |
| The order of a cancel-initiated end | Nowhere: the terminal event was emitted when the stop hook resolved, and each run reported when it could | `DriverSessionLedger#cancel`: stop, wait for the run in flight, terminal event, release |
| That a terminal session is final | Nowhere: `emit` was not gated, and a driver could overwrite the outcome | `LedgerSession#emit` and the `outcome` accessor of the session |
| That a run was stopped by a cancel | Known only for the start signal | The Claude Code and Codex stop request marks the run, for a cancel and for the signal alike |
| How an OpenCode provider is stopped by a cancel | Not at all | The driver's stop hook, the same path as its aborted start signal |

### Requirement evidence

| Clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| A terminal session accepts no further event | `LedgerSession#emit` | After a cancel and after its close nothing is delivered and nothing numbered: `L:180-191`. After a close of a session whose run is in flight: `L:471-479`. Per driver, a turn of the event loop after the close: `assertEndedOnce`, `F:143-157`, in every case of `F` and of the cancel order axis of `M` |
| A cancel waits for the run it stopped | `DriverSessionLedger#cancel`, `DriverSession#runStarted` | The stop resolves and no terminal event is emitted until the run has reported: `L:360-379`. A run that reports only when the case lets it, on a driver: `F:220-239` (OpenCode) |
| The run's own report decides the outcome | `cancel`, the `outcome` accessor | The run reports a failure the stop did not cause; the terminal event and the close say `failed`: `L:381-391` |
| A cancel with nothing to wait for stays in the caller's turn | `cancel` | `L:268-273` (unmodified); it does not wait for a run either: `L:430-438`. A cancel after the run reported waits for the stop alone: `L:440-446` |
| A stop hook that fails leaves the session open | `cancel` | `L:275-289` (unmodified); with a run in flight, whose later report is still delivered: `L:448-469` |
| An outcome is recorded once | the `outcome` accessor | The first `failed` or `cancelled` stands: `L:403-416`. A failure before a cancel stands, and the terminal event keeps the reason: `L:393-401`. Nothing changes it after the terminal event, so `close` answers what that event said: `L:418-428` |
| Two cancels end a session once | `cancel` | The reason of the first: `L:481-490` |
| Cancel of a running session, all four drivers | the ledger and each driver's wiring | One terminal event, `cancelled` with the reason, the last event, the provider stopped once, nothing after the close, and the close answers `cancelled`: `M:444-463`. The exact sequence, for a cancel and for the session runner's stop: `F:183-194` |
| An error before the stop is still `failed`, all four drivers | the `outcome` accessor | The run failed, the session is cancelled, the terminal event says `failed` with the reason and the close answers `failed`: `M:465-481`. The exact sequence: `F:210-217` |
| A stop after completion changes nothing, all four drivers | `cancel`, `close` | The start signal is aborted and the session cancelled after it completed and closed: no event, the terminal event still says `completed`, a second close answers `alreadyClosed`: `M:485-499`. A cancel after the run and before the close keeps the meaning it had, a cancelled session: `M:312-327` (unmodified) |
| A failure the stop did not cause is not lost | `ClaudeCodeDriver#start`, `CodexDriver#start` | A stream that broke before the stop: `content.delta`, the stream's own error, `session.closed` (`failed`, reason), for a cancel and for the session runner's stop: `F:242-266` |
| An aborted start signal alone is unchanged | the four drivers | `F:196-208` |
| An OpenCode cancel stops its provider | `OpenCodeDriver#start`, the driver's stop hook | The SDK session is aborted once, before the terminal event: `M:338-377`, row `opencode` (the row is new; the case is unmodified). Through the session runner: `D:127-147`, `D:152-172`, row `opencode` |
| The session runner's answer for a session cancelled behind its back | `runDriverSession` | `cancelled`, with the driver's `…_ABORTED` as the one error code, and the error before the terminal event, for the four drivers: `D:186-205` |
| The session runner is not weakened | `ObservedSession#classify` | Its source changes in a comment. `R` passes with one comment changed, and `tests/integration/driver-execution-adapter.test.mjs` unmodified |
| Error codes and messages unchanged | the four drivers | No code or message was added, removed or changed. Every code named above existed |

### The decision on a late event

A late event is dropped and not counted. Two things had to hold for that to be
safe, and both are asserted.

1. An error that explains a failure the stop did not cause is never late. A
   cancel waits for the run's own report (`L:360-379`), so that error is
   delivered before the terminal event, and the terminal event carries
   `failed` (`L:381-391`, `F:242-266`). Dropping late events without this wait
   would have lost it: the mutation "a cancel does not wait for the run to
   report" below fails the stream-failure cases of both drivers.
2. What remains after a terminal event has no reader. It is the output of a
   run whose session was closed while it ran (`L:471-479`). The close that
   could have reported a count has already answered.

The alternatives are in the decision entry of `.specs/STATE.md`.

### The session runner's rule

AD-048 item 4, "a stop always ends as `cancelled`", exists because of this
defect. After this range the four drivers end a stopped session as `cancelled`
themselves. The rule is kept, because it is still reachable:

| Case | What the driver now answers | What the runner answers |
| --- | --- | --- |
| A session that had failed before the stop | Terminal event and close `failed` (`M:465-481`) | `cancelled`, with the failure's code (`R:187-201`) |
| A cancel that fails | The session stays open; the close says how the run ended | `cancelled` (`R:239-250`) |
| A start that rejects after the stop | Nothing | `cancelled` (`R:351-364`) |
| A driver that keeps no session ledger | Whatever it emits, an error after the terminal event included | `cancelled` (`R:149-166`, `R:168-180`) |

Only the comment above `classify` changes. The clause that reads the terminal
event's outcome is now redundant for the four drivers, whose close agrees with
that event; it is kept for the last row.

### Behaviour changes a caller of a driver can notice

1. The error event of a stopped run is the driver's `…_ABORTED`, and it comes
   before the terminal event. For a cancel alone it was
   `VES_CLAUDE_STREAM_INCOMPLETE`, `VES_CODEX_PROCESS_FAILED` or
   `VES_PI_RUNTIME_FAILED`, after it.
2. `close` answers `cancelled` for a session cancelled while it ran. It
   answered `failed` for Claude Code, Codex and Pi.
3. Nothing is emitted after the terminal event. `finalSequence` is the number
   of the events delivered, as before.
4. `cancel()` of a running session resolves once the run has reported how it
   ended and the terminal event is out. It resolved as soon as the provider
   had been told to stop.
5. A session that had failed before it was stopped closes as `failed`, and its
   terminal event says `failed` with the reason of the cancel. It closed as
   `cancelled`. That holds for a stop by the start signal as well.
6. A Codex run whose stream had failed before the stop reports that failure's
   code. It reported `VES_CODEX_ABORTED` when the start signal was aborted
   after the failure.
7. An OpenCode `cancel()` stops the provider: the SDK session is aborted and
   the isolated server closed. It stopped nothing.
8. A Pi session stopped through the session runner reports `VES_PI_ABORTED`
   in the runner's error codes, where it reported `VES_PI_RUNTIME_FAILED`. The
   outcome was and is `cancelled`.
9. A session closed while its run is in flight emits nothing more. Its run's
   later events used to be delivered after the terminal event.

Through the session runner the outcome of every case above is what it was.

### Tests changed

| Former case | Assertion | Replacement |
| --- | --- | --- |
| `L:180-191` "an event emitted after the terminal event is still delivered and numbered" | An event emitted after a cancel, and one after the close, are delivered and numbered | `L:180-191` "a terminal session accepts no further event, after a cancel and after its close", at the same lines: the same two emissions, neither delivered nor numbered |
| `D:175-195` "claude-code: the run a cancel interrupts still reports how its process ended, after the terminal event" | The last two events are `session.closed`, `error`; the runner answers `cancelled` with `VES_CLAUDE_STREAM_INCOMPLETE` | `D:186-205`, one case per driver: the last two events are `error`, `session.closed`; the runner answers `cancelled` with the driver's `…_ABORTED` |

No other case was deleted or modified. Two comments changed: above `R:149` and
above `D:152`, which described the former end.

Added: 12 cases in `L` (appended), the cancel order axis of `M` (13 cases,
appended), four cases in `D` in place of one, the OpenCode row of `M` and `D`
(5 cases), and the four qualification suites (21 cases: six each for Claude
Code and Codex, five for OpenCode, four for Pi). The labeled fakes of Claude
Code and Codex gain a `garbled` mode, and the OpenCode fixture a provider that
answers only when the case lets it.

The OpenCode rows and the imports they need are declared after the cases in
`M` and `D`, so the lines earlier evidence cites (`M:132-142`, `M:267-415`,
`D:92-172`, `L:37-332`) are where they were.

### Discrimination (disposable copy)

A copy of `packages`, `tests`, `spikes` and the sources of the composition
root at the tip of this range, in an ignored scratch directory, was mutated
one change at a time and restored from the tracked sources after each run. The
tracked sources were never mutated. Suites run: `L`, `M`, `R`, `D`, the four
qualification suites of this range, the two process-tree qualification suites,
`tests/integration/driver-process-tree.test.mjs`,
`tests/integration/pi-driver-agent-release.test.mjs`, and the contract and
lifecycle suites of the four drivers. Unmutated copy: 282 passed, 0 failed.

| Mutation in the copy of the ledger | Failing cases |
| --- | --- |
| **The ledger and the four drivers as they were before this range** | 45: 17 of the qualification suites, 9 in `M`, 13 in `L`, 6 in `D` |
| **Events after the terminal event are delivered (the former behaviour)** | 4 in `L`, among them `L:180-191` and `L:471-479`. No driver case fails: with the wait in place no driver emits after its terminal event, which is the evidence that the refusal is a backstop for a cancel |
| Events after the terminal event are dropped but still numbered | 2 in `L` |
| The outcome can change after the terminal event | 1: `L:418-428` |
| **The last outcome recorded stands (a stop relabels a failure)** | 17: the failed-before-the-stop case of all four drivers in `M` and in their qualification suites, the stream-failure cases of Claude Code and Codex, 5 in `L` |
| `failed` outranks `cancelled` instead of the first standing | 1 in `L`: "an outcome is recorded once: cancelled is not replaced by failed" |
| **A cancel does not wait for the run to report** | 18: the cancel and runner-stop cases of all four qualification suites, the stream-failure cases of Claude Code and Codex, the OpenCode late-report case, `L:360-379`, and `D:186-205` for all four drivers |
| A cancel waits for the run even when the stop hook had nothing to wait for | 2 in `L`: `L:268-273`, `L:430-438` |
| A cancel waits for the run before it asks the provider to stop | 1: `L:448-469` |
| A cancel always records `cancelled`, whatever was recorded | 14: the failed-before-the-stop and stream-failure cases across `M` and the qualification suites, 2 in `L` |

| Mutation in the copy of a driver | Failing cases |
| --- | --- |
| **Claude Code: a cancel terminates the child and does not mark the run** | 6: its cancel case in its qualification suite, in `M` (two rows) and in the process-tree suite, and two in `D` |
| Claude Code: the run never says that it has reported | 12: every case that cancels a running Claude Code session; each runs into its time limit |
| Claude Code: the run is not bracketed | 5: its cancel, runner-stop and stream-failure cases, and its row of `D:186-205` |
| Claude Code: an abort outranks a stream failure | 7: its two stream-failure cases, four cases of its contract suite, and "a Claude Code stream that keeps failing starts one termination of its child" |
| **Codex: a cancel terminates the child and does not mark the run** | 6: the same cases as for Claude Code |
| **Codex: a stop marks the run as aborted even after its stream failed (the former rule)** | 2: its two stream-failure cases |
| Codex: the run is not bracketed | 5: as for Claude Code |
| **OpenCode: a cancel does not stop the provider (as before this range)** | 8: its cancel, runner-stop and late-report cases, its two rows of `M`, three in `D` |
| OpenCode: the run is not bracketed | 1: "a cancel waits for a run that reports late, and its terminal event still comes last" |
| **Pi: the run is not bracketed (the cancel releases the agent before the run has reported)** | 3: its cancel and runner-stop cases, and its row of `D:186-205` |
| Pi: the run never says that it has reported | 12: every case that cancels a Pi session, a session cancelled after its run included |

All 21 mutations failed at least one case. A mutation that removes the end of
a bracket makes its cases run into their time limit; whatever still ran from
the copy was killed by its process id after each run.

One row needed a case of its own. With the plain hanging fixture, an OpenCode
run reports its abort within the same turn as the stop, so the bracket made no
observable difference and the mutation survived. `F:220-239` stops a provider
that is still creating its session and answers only when the case lets it.

### Windows

Nothing in this range was run on Windows. What executes there, by branch:

- **The session ledger** has no platform branch.
- **Claude Code (T03 profile; the mediated profiles are refused there).** A
  cancel reaches the terminator only through the single termination per child
  that ADP-4 introduced for the Windows failure (a second kill of a process
  that has exited is an error there). The cancel and the start signal call one
  closure, `terminate`, which marks the run and awaits that single
  termination; no path in this range calls the terminator directly. After the
  termination the cancel waits for the child's `close` event, which `start`
  already waited for.
- **Codex.** The same single termination. The run no longer reads how the
  process exited to classify a stop: the stop marks it first. Before, a cancel
  alone was classified from the exit code and signal, which Windows reports
  differently from POSIX.
- **The fakes.** The `garbled` mode writes its two lines in one write before
  anything is terminated, so both are in the pipe whatever the platform does
  with a terminated writer. Its cases inject no terminator, so the stop is the
  driver's fallback, which contains the error of a kill that finds the
  process gone.
- **OpenCode and Pi** start no process in this range's paths.

What could differ on Windows and is asserted by the new cases: that a cancel
asks for exactly one termination (`F:183-194`, `M:444-463`), and that the run
ends after it. Confidence is high for the ledger and for OpenCode and Pi, and
moderate for the two child-process drivers, for one reason: the cancel now
waits for the run, so a provider process that a Windows terminator does not
end keeps the cancel waiting where it used to return. A platform matrix run on
the branch is required before merge.

### Guardrails

- Complexity baseline: no entry changed, no key added or moved
  (`pnpm complexity:update` rewrites `complexity-baseline.json` to the same
  bytes). `claude-code-driver.ts :: Async method 'start'` stays 24,
  `codex-driver.ts :: Async method 'start'` 27, `opencode-driver.ts :: Async
  method 'start'` 22 and `pi-driver.ts :: Async method 'start'` 12.
- Census: `pnpm census:refresh` changes nothing; no product source gained or
  lost `JSON.stringify` or `createHash`.
- Citations fixed: the OpenCode floor, now `opencode-driver.ts:232`, in
  `.specs/features/platform-qualification-matrix/matrix.md` and
  `.specs/features/dependency-refresh-2026-07/validation.md`. The other cited
  lines of the four drivers lie above the changed code and did not move.
- Qualification reports: four new files under `docs/qualification/`; no
  existing report is edited. The digest-bound reports of `credential-store.ts`
  keep their digests (`tests/security/os-secret-backend-security.test.mjs`,
  unmodified, recomputes them under `gate:security`).
- Migration count (12) and runtime error catalog count (19) unchanged. No
  public error code or message was added, removed or changed.
- `tests/mutation/*` and the fault-injection suites pass unmodified.

### Gates (Node 24.14.0, macOS arm64)

Each row was measured on a detached checkout of exactly that commit, one
command at a time.

| Commit | `pnpm gate:quick` | `pnpm test:architecture` | Focused suites |
| --- | --- | --- | --- |
| `83f6923` an OpenCode cancel stops its provider | PASS — unit 2484, agent-readiness 323, census 13 | PASS — 86 | `M`, `D`, the OpenCode contract, lifecycle, security and qualification suites: PASS — 117 |
| `3df0d1b` the cancel order | PASS — 2484, 323, 13 | PASS — 86 | The driver contract and integration suites, the OpenCode security suite, and the four `qualify:*` suite sets: PASS — 462 |
| `c732c96` the four reports | PASS — 2484, 323, 13 | PASS — 86 | — |

At the last commit of the range outside `.specs`:

| Command (at `c732c96`) | Result |
| --- | --- |
| `pnpm gate:build` | PASS — unit 2484, contract 782, integration 954, e2e 245, architecture 86, build 146, qualification 323 |
| `pnpm gate:security` | PASS — unit 2484, contract 782, e2e 245, architecture 86, qualification 323, security 1339, fault 310 |
| `pnpm test:contract` | PASS — 782 |
| `pnpm test:integration` | PASS — 954 |
| `pnpm test:fault` | PASS — 310 |
| `pnpm test:qualification` | PASS — 323 |
| `pnpm qualify:claude` | PASS — 62 |
| `pnpm qualify:codex` | PASS — 29 |
| `pnpm qualify:opencode` | PASS — 23 |
| `pnpm qualify:pi` | PASS — 16 |
| `pnpm agent:check` | PASS |

The commit that adds this section and the decision entry changes nothing
outside `.specs`; `pnpm gate:quick` (unit 2484, agent-readiness 323, census
13), `pnpm test:architecture` (86) and `pnpm agent:check` pass on it.

No test was skipped in any stage. The `qualify:*` scripts start no provider
session and need no login. `qualify:keychain` was not run.

### Not verified here

- **The platform matrix.** Every result above is from macOS arm64. See the
  Windows section.
- **A real provider.** See "What was not observed" in the four reports.

### Open points for the reviewer

- **A session closed while its run is in flight.** `close` makes it terminal
  at once and answers the outcome recorded so far, which for a run that has
  not ended is `completed`. What the run reports afterwards used to be
  delivered after the terminal event and is now dropped (`L:471-479`). No
  composition closes a session before its run has ended. Whether such a close
  should stop the provider, or be refused, is not decided here.
- **"A stop after completion changes nothing" was read two ways, and both
  hold.** After the session completed and closed, a stop changes nothing
  (`M:485-499`). After the run ended and before the close, a cancel still
  makes the session `cancelled` with its reason, as the lifecycle matrix
  pinned before this range (`M:312-327`, unmodified).
- **The OpenCode event loop after a stop.** The driver keeps reading the
  provider's stream until the server's exit ends it. A permission request that
  still arrives is put to the controller, as it was after an aborted start
  signal. Stopping the loop at the stop would add a branch to a function that
  is a complexity hotspot, and is not part of this defect.
- **A terminator that fails.** The session stays open and cancellable, as
  before, but the Claude Code and Codex run is already marked as stopped, so
  it ends as `…_ABORTED` whenever the provider exits. An aborted start signal
  always behaved so.

## Range 2 — how a provider child ends

A second range on the same branch and its own pull request, on top of range 1.
An architecture review of `main` found that the Codex driver, whose provider
leads its own process group since ADP-4, still signalled the one process with
`child.kill()` on two paths. This range makes every end of a Claude Code or
Codex provider go through the single tree termination per child that ADP-4
introduced.

`Q` is `tests/helpers/process-tree-fixture.mjs`, whose `providerEndSuite` holds
the cases the two qualification suites run:
`spikes/claude-code-driver/test/claude-driver-provider-ends.test.mjs` under
`pnpm qualify:claude` and
`spikes/codex-driver/test/codex-driver-provider-ends.test.mjs` under
`pnpm qualify:codex`. `P` is `tests/integration/driver-process-tree.test.mjs`
and `X` is `tests/architecture/provider-process-tree-termination.test.mjs`.
Every process these suites start is a labeled fake or an idle Node process the
fake started; each is killed by its identifier when its case ends.

### What the review found, and what checking the four drivers found

Every way each driver ends a process it started, read from the sources of
`77c7b8e`:

| Driver | End | Before | Now |
| --- | --- | --- | --- |
| Codex | A stop (start signal after the grace period, cancel) | The single tree termination | unchanged |
| Codex | A stream that failed: a line that is not JSON, an invalid or undeclared tool call, invalid usage | `child.kill()` in `fail` | The single tree termination |
| Codex | An output limit, on the output or the error stream | `child.kill()` in `fail` | The single tree termination |
| Codex | A failed write to the provider's input | `child.kill()` in `fail` | The single tree termination |
| Codex | A run that ended with the provider still running: a completed turn, or a protocol failure | `child.kill()` after the run | The single tree termination |
| Codex | A provider that exited by itself | Nothing | unchanged |
| Claude Code | A stop (start signal, cancel) | The single tree termination | unchanged |
| Claude Code | A stream that failed: a line that is not JSON, a hook event on the bridge-only surface, an init event that does not match, an invalid tool request, invalid usage | The single tree termination, not awaited and not contained | The same, contained |
| Claude Code | An output limit, on the output or the error stream | as above | as above |
| Claude Code | A failed write to the provider's input | Nothing: the failure was recorded and the run waited for the provider to exit | The single tree termination. Proven on macOS and Linux only; see "The Windows matrix failure" |
| Claude Code | A run that ended normally | The provider exits by itself; the driver ends nothing | unchanged (below) |
| OpenCode | The isolated server its own factory starts: a start that timed out, exceeded its output limit or failed, an SDK that could not be loaded, and the end of every session and of every catalog discovery | `child.kill()` on each | unchanged (below) |
| Pi | — | Starts no process | — |

The review named the two Codex paths. The Claude Code input path and the
OpenCode server were found by checking.

**Claude Code has no end at which the provider is still running by design.**
In print mode the provider exits after its result and the driver reads the
exit code as part of it. A provider that reports its result and never exits
keeps its session waiting until a stop; ending it would need a grace period
and a rule for the exit code of a provider the driver killed. Not changed.

**The OpenCode server is not changed.** The driver owns that child, and a
descendant of `opencode serve` survives each of those ends. Terminating its
tree needs the server to lead its own process group, which takes it out of
reach of the terminal's signals; ADP-4's first review found exactly that for
the other two drivers, and the fix was in the composition (the interrupt
handling of `ProviderProcesses`). No composition runs the OpenCode server
factory: the Self-Test scenario injects its own, and no test starts it.
Changing the spawn alone would trade a descendant that survives a session for
a server that survives a closed terminal. It is recorded in the decision entry
for whoever first composes that factory.

### Requirement evidence

| Clause | Definition (symbol) | Assertion evidence |
| --- | --- | --- |
| A Codex stream failure ends the provider's tree | `CodexDriver#start` (`fail`, `endChild`) | A provider with a descendant that left its group writes a line that is not JSON and stays alive: the run ends by itself with `VES_CODEX_STREAM_INVALID`, and none of the three processes is alive: `Q:256-269`, end `garbled`. On every platform, one request to the injected terminator: `P:169-193` |
| A Codex output limit ends the provider's tree | the same | `Q:256-269`, end `large`; `P:169-193` |
| A Codex run that ends with the provider running ends its tree | `CodexDriver#start` | The turn completes and the provider does not exit: the run ends with no error, the session closes as `completed`, and none of the three processes is alive: `Q:256-269`, end `linger`; `P:169-193` |
| A Claude Code stream failure and output limit end the provider's tree | `ClaudeCodeDriver#start` (`endChild`) | `Q:256-269`, ends `garbled` and `flood`. The single termination for a stream that keeps failing: `P:64-75` (unmodified) |
| A Claude Code provider whose input write fails is ended, with its tree (macOS and Linux) | `ClaudeCodeDriver#start`, the input error handler | The provider closes its input before it has read a prompt larger than a pipe holds: the run ends with `VES_CLAUDE_STDIN_FAILED`, and none of the three processes is alive: `Q:256-269`, end `deaf`; one request to the terminator: `P:200-216`, the row off win32 |
| On win32 that write does not fail with the fake, and a stop still ends the session | `stoppedWithInputPending` | A second after the session was announced nothing has ended it and no failure is reported; a cancel then ends it as `cancelled` with `VES_CLAUDE_ABORTED`, through one request to the terminator, and the provider is gone: `Q:220-242`, reached from `Q:189-206` and from the win32 row of `P:200-216` |
| Neither driver signals its child itself | both drivers | `X:104-110` |
| An end no caller awaits contains a termination that fails | `unawaitedTermination` | Each call asks, and a failure produces no unhandled rejection: `P:228-243` |
| One termination per child, whoever asks | `singleTermination` (unchanged) | `P:77-91`, `P:103-141` (unmodified) |
| A stop is unchanged | both drivers | The process-tree and cancel order qualification suites, `M` and `D` pass unmodified |
| No event sequence changed | both drivers | The error codes and the outcome of every end above are what they were; the contract and lifecycle suites of both drivers pass unmodified |
| Windows | `endedOnWin32` | The cases of a stream failure, an output limit and a completed turn assert that the session ends as reported and that the provider, which the fake keeps alive until it is terminated, is gone: `Q:189-206`. `P:169-193` counts the request to the terminator on every platform. The input case asserts the row above |

### The cases asked for

A fake provider that leaves a `setsid` descendant alive, and then:

| | Claude Code | Codex |
| --- | --- | --- |
| (a) writes a malformed line | `garbled` with `FAKE_CLAUDE_FORK=1` | `garbled` with `FAKE_CODEX_FORK=1` |
| (b) exceeds the output limit | `flood`, limit 1024 bytes | `large`, limit 2048 bytes |
| (c) ends its turn without exiting | none: the driver has no such end (above) | `linger` |
| (d) closes its input (added; macOS and Linux) | `deaf`, with a prompt of 2 MiB | reached through `fail`, as (a) and (b); no case |

In each case the descendant in the provider's group, which holds its output
open, and the one that left the group are gone afterwards, and the run ended
by itself. The terminator is the one the task composition injects, as in the
process-tree suites.

### Behaviour changes

1. A Codex session that ends on a stream failure, an output limit, a failed
   input write, a protocol failure or a completed turn leaves nothing the
   provider started behind, and no longer waits for a descendant that holds
   the provider's output.
2. **Under `vestra task` the verifier's App Server is killed with `SIGKILL` at
   the end of every verification**, by the tree routine, with whatever it
   started. It received one `SIGTERM`. With no terminator injected the
   provider's group receives `SIGTERM` (the one process on Windows).
3. The injected terminator is asked at each of those ends. A composition that
   counts or reports its calls sees one per Codex session that ended with the
   provider running. The task composition's terminator names a tree it could
   not confirm stopped on stderr; that line can now follow a completed
   verification.
4. A Claude Code session whose input write fails ends, which is what happens
   on macOS and Linux when the provider closes its input. It waited for the
   provider to exit. On Windows this is not proven. A provider that keeps its
   input open and does not read it is not noticed on any platform, as before.
5. A termination that fails at an end no caller awaits is contained. In the
   Claude Code driver it was an unhandled rejection.
6. A Codex stream failure noticed after the provider has exited asks for the
   termination, which reaches what is left of its group. `child.kill()` did
   nothing at that point.

No event, error code, message or outcome changed.

### Tests changed

None deleted and none modified. Added: `providerEndSuite` in `Q` (appended)
and the two qualification suites that run it (6 cases), five cases in `P`
(appended), two in `X` (appended), a switch that makes any mode of the two
labeled fakes start its process tree first, and the modes `flood` and `deaf`
(Claude Code) and `linger` (Codex). The existing `fork` mode of both fakes is
unchanged in what it does.

After the platform matrix run, one commit on top changed the two input cases
of this range, which had not merged: each is now named for a provider that
closes its input, and asserts on win32 what holds there. No assertion of the
other platforms changed. See "The Windows matrix failure".

### Discrimination (disposable copy)

Same method as for range 1, on a copy of the tree at the tip of this range.
Suites run: the two qualification suites of this range, the process-tree and
cancel order qualification suites of both drivers, `P`, `X`, `M`, `D`, and the
contract and lifecycle suites of both drivers. Unmutated copy: 177 passed,
0 failed.

| Mutation in the copy | Failing cases |
| --- | --- |
| **Codex: a stream that failed signals the one process (`child.kill()` restored)** | 3: the malformed-line and output-limit cases of `Q`, and `X:104-110` |
| **Codex: a run that ended signals the one process (`child.kill()` restored)** | 4: the completed-turn case of `Q`, its case in `P:169-193`, `X:104-110`, and one of the two stream-failure cases of `Q`, a different one in different runs |
| **Codex: both ends as they were before this range** | 7: the three cases of `Q`, the three Codex cases of `P:169-193`, `X:104-110` |
| Codex: a run that ended with the provider still running does not end it | The completed-turn case of `Q`; the Codex contract suite then stops at "Codex Driver blocks a model absent from the app-server catalog", whose provider nothing ends, and the run was cut off at its time limit |
| **Claude Code: a provider whose input write failed is not ended (as before this range)** | 2: the input case of `Q` and its case in `P:169-193` |
| Claude Code: a stream that failed signals the one process | 6: the three cases of `Q`, `X:104-110`, `P:64-75`, and the input case of `P:169-193` |
| An unawaited end does not contain a termination that fails | 1: `P:228-243` |
| An unawaited end asks for nothing | 10 before the run was cut off at its time limit: the six cases of `Q` and four cases of the Codex contract suite |

All 8 mutations failed at least one case. With `child.kill()` restored a case
of `Q` fails in one of two ways: the descendant that holds the provider's
output keeps the run waiting until the case's time limit, or the run ends and
the descendant that left the group is still alive. Whatever still ran from the
copy was killed by its process id after each run.

The second row shows why the end of a run does not signal the provider
beside the tree termination: in some runs the provider was gone before the
tree routine had read its descendants.

The first row is caught by `Q` only where a provider has a tree, and by `X`
everywhere. Its case in `P` still passes, because the end of the run then asks
the terminator for the provider the signal has not yet ended. On Windows that
row rests on `X`.

### Windows

Nothing in this range was run on Windows. What executes there, by branch:

- **`unawaitedTermination`** has no platform branch. It is the reason the
  change is safe there: a kill of a process that has exited is an error on
  Windows, and these ends ask for the termination at moments when the provider
  may be exiting. `child.kill()` returned false in that case; the terminator
  rejects, and the rejection is contained (`P:228-243`).
- **The single termination per child** is unchanged, so a stop that follows
  one of these ends shares its request, and a request that failed is tried
  again.
- **The fallback** signals the one process on Windows, inside a `try`. The
  tree is reached there only through the terminator a composition injects.
- **The fakes.** `flood`, `garbled`, `linger` and `deaf` keep the provider
  alive until it is terminated, so "the provider is gone" is evidence on
  Windows too. `deaf` cannot close its input there; see the next section.
- **The qualification cases** take the `endedOnWin32` path (`Q:189-206`): no
  process group, no `setsid()`, one provider process, asserted gone.

Confidence is high for the Codex paths, which replace one call with another
under the same conditions; the matrix passed them on Windows. A platform
matrix run on the tip that carries the next section's commit is required
before merge.

### The Windows matrix failure

The matrix ran on `89cf445`. The security gate (run 37063709048) and the build
gate (run 37063705718) each passed on four targets and failed one case on
Windows x64, the same behaviour in two places: the `deaf` case of `Q`, which
ran into its 60 second limit, and the `deaf` row of `P`, which ran into its
30 second limit. Every other case passed on every target.

Cause, read from the runtime's behaviour and not observed on Windows here: the
`deaf` mode closes descriptor 0 so that the writer's prompt fails. On Windows
the runtime does not close the descriptors of the standard streams, so the
call does nothing there. The fake then never reads its input and never closes
it, the prompt stays pending in the pipe, no write fails, and the driver has
nothing to react to. It waited, as it did before this range.

What that says about the product, and what it does not:

- The driver reacts to a **failed write** to the provider's input. That code
  has no platform branch. This range proves it on macOS and Linux, where a
  provider that closes its input makes the pending write fail.
- **On Windows it is not proven.** The labeled fake is a Node process and
  cannot close its input there, so no case can produce the failed write.
  Whether a real provider that closes its input makes the write fail on
  Windows was not observed. The statement in the first version of this
  section and of the report, that the behaviour holds on every platform, was
  wrong and is corrected.
- A provider that keeps its input open and does not read it is not noticed on
  **any** platform. No write fails. The session waits until it is stopped, as
  before this range.

The driver does not bound that wait. Three reasons. A bound on the prompt
write sees only a prompt larger than the pipe holds; a smaller one is written
in full whether or not anyone reads it, so the bound would not cover the case
it is for. Any bound short enough to matter can cut a provider that starts
slowly and reads a large prompt late. And a provider that does not read is one
form of a provider that hangs, for which the compositions already hold the
bound, the budget's duration ceiling and the verifier's timer, and stop the
session through the tree termination.

The two cases now assert on win32 what holds there (`stoppedWithInputPending`,
`Q:220-242`), without skipping and in about a second: once the session is
announced the case waits one second, long enough for a write that was going to
fail to have failed; the run has not ended and no failure is reported; a
cancel then ends the session as `cancelled` with `VES_CLAUDE_ABORTED`, through
one request to the terminator, with the prompt still unread, and the provider
is gone. If the write does fail on some Windows host, the case fails with a
message that says so, and the case of the other platforms is the one that
applies there.

Checked on macOS in the disposable copy, with the win32 path forced:

| Condition in the copy | Result |
| --- | --- |
| The fake cannot close its input (the call that closes it removed), win32 path forced | Both cases pass, in about a second each |
| The fake closes its input, win32 path forced | Both cases fail: "the run ended by itself: the write to the provider's input failed on this platform" |

The second row shows that the win32 assertion is not one that passes whatever
the platform does.

### Guardrails

- Complexity baseline: one entry falls, none rises, no key added or moved.
  `packages/drivers/src/codex-driver.ts :: Async method 'start'` goes from 27
  to 26, because the end of a run no longer tests `child.killed`.
  `claude-code-driver.ts :: Async method 'start'` stays 24.
- Census: `pnpm census:refresh` changes nothing.
- Citations fixed: one import line moved the cited lines of both drivers. The
  Claude Code minimums are now `claude-code-driver.ts:74` and `:367`, the
  Codex minimum `codex-driver.ts:106`, in
  `.specs/features/live-task-pilot/validation.md` and
  `.specs/features/platform-qualification-matrix/matrix.md`. `Q`, `P` and `X`
  grew at their end, so the lines validation-c4 cites did not move.
- Qualification reports: two new files under `docs/qualification/`; no
  existing report is edited, the two process-tree reports included. The
  digest-bound reports keep their digests.
- Migration count (12) and runtime error catalog count (19) unchanged. No
  public error code or message was added, removed or changed.
- Documentation: `docs/quick-start.md` names the new behaviour.
  `pnpm site:check` passes.
- `tests/mutation/*` and the fault-injection suites pass unmodified.

### Gates (Node 24.14.0, macOS arm64)

Each row was measured on a detached checkout of exactly that commit, one
command at a time.

| Commit | `pnpm gate:quick` | `pnpm test:architecture` | Focused suites |
| --- | --- | --- | --- |
| `51df6bc` every end goes through the tree termination | PASS — unit 2484, agent-readiness 323, census 13 | PASS — 88 | The driver contract and integration suites, the verifier suite, the two task process suites, `X`, and the Claude Code and Codex qualification suites: PASS — 458 |
| `ca609dc` the two reports | PASS — 2484, 323, 13 | PASS — 88 | — |

At the last commit of the range outside `.specs`:

| Command (at `ca609dc`) | Result |
| --- | --- |
| `pnpm gate:build` | PASS — unit 2484, contract 782, integration 959, e2e 245, architecture 88, build 146, qualification 329 |
| `pnpm gate:security` | PASS — unit 2484, contract 782, e2e 245, architecture 88, qualification 329, security 1339, fault 310 |
| `pnpm test:contract` | PASS — 782 |
| `pnpm test:integration` | PASS — 959 |
| `pnpm test:fault` | PASS — 310 |
| `pnpm test:qualification` | PASS — 329 |
| `pnpm qualify:claude` | PASS — 65 |
| `pnpm qualify:codex` | PASS — 32 |
| `pnpm qualify:opencode` | PASS — 23 |
| `pnpm qualify:pi` | PASS — 16 |
| `pnpm agent:check` | PASS |
| `pnpm site:check` | PASS — 135 pages, internal links valid |

The commit that adds this section and the decision entry changes nothing
outside `.specs`; `pnpm gate:quick` (unit 2484, agent-readiness 323, census
13), `pnpm test:architecture` (88) and `pnpm agent:check` pass on it.

No test was skipped in any stage. No provider session was started and no login
was needed. `qualify:keychain` was not run. After the suites no process they
started was left running.

### Not verified here

- **The platform matrix.** Every result above is from macOS arm64. This range
  is platform-specific in what it calls, the terminator, and in its fakes. See
  the Windows section.
- **A real provider.** See "What was not observed" in the two reports. The
  one that matters most is the verifier's App Server, which is now killed at
  the end of every completed verification.

### Open points for the reviewer

- **The verifier's App Server is killed, not terminated, at a normal end.**
  That follows from sending a completed turn through the same termination as a
  stop, which under `vestra task` is the tree routine with `SIGKILL`. If a
  real App Server needs a gentler end after a completed turn, the place for it
  is the composition's terminator (a termination request first, then the
  kill), not a second signal in the driver.
- **A Claude Code provider that never exits after its result.** Not ended by
  the driver; see the decision entry.
- **The OpenCode server.** Not changed; see the decision entry. The finding is
  real and waits for the first composition that runs that factory.
- **A termination that fails at an unawaited end is silent in the driver.**
  The task composition's terminator reports a tree it could not confirm
  stopped. A composition that injects another terminator hears nothing.
- **Claude Code's stream-failure paths were changed in form only.** They
  already asked for the tree termination. They now contain its failure, which
  was an unhandled rejection before.
- **The input case on Windows.** Proven on macOS and Linux only, and the wait
  for a provider that does not read is not bounded by the driver; see "The
  Windows matrix failure". A fake that can close its input on Windows would
  have to be a native executable, which this repository does not carry.
