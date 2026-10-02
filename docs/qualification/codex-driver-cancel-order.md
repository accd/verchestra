# Codex Driver Requalification: Cancel Order

**Task:** the cancel order defect recorded by ADP-3 and ADP-4 of
`.specs/features/architecture-deepening/`
**Status:** Candidate pending independent verification, human review, and a
platform matrix run on the branch
**Installed Codex CLI observed:** none for this change. Nothing here ran a real
Codex process, and no model was invoked. What changed is what the driver emits
when a running session is stopped, not what it asks of Codex.
**Supersedes:** nothing. `docs/qualification/codex-driver.md` remains the
evidence for the T04 qualification and
`docs/qualification/codex-driver-process-tree.md` for how the provider is
started and stopped. The App Server protocol, the read-only sandbox, the
approval policy, the environment, the working directory, and every error code
and message are unchanged.

## Why the driver is requalified

Cancelling a running session through `cancel()` emitted the terminal event
`session.closed` with the outcome `cancelled`, then an error event, and
`close` answered `failed`. ADP-3 recorded that and kept it, and ADP-4 made the
session runner classify a stop as `cancelled` whatever the driver said
afterwards.

The cause in this driver: the cancel terminated the `codex app-server` process
through the session ledger's stop hook, and the run was not told. The ledger
emitted the terminal event as soon as the terminator had resolved. The run
noticed only when the child's exit handler ran, afterwards, and what it saw
was a process that had ended by a signal before its turn completed. It
reported that as `VES_CODEX_PROCESS_FAILED` and recorded `failed`.

## What changed

- **The cancel marks the run as stopped.** A cancel marks the run before it
  terminates the provider, as an aborted start signal does, so the run ends as
  `VES_CODEX_ABORTED`. The cancel still terminates the provider at once, with
  no `turn/interrupt` and no grace period; the start signal still interrupts
  first. The one termination per child of the process-tree requalification is
  unchanged.
- **A stream that had already failed keeps its own report.** A stop, by
  `cancel()` or by the start signal, no longer marks a run whose stream had
  failed before the stop. That run is reported under the code of its failure.
  It used to be reported as `VES_CODEX_ABORTED` when the start signal was
  aborted after the failure.
- **The run reports before the terminal event.** The driver tells its session
  ledger when the run has reported how it ended, and a cancel that stopped the
  provider waits for that before it emits the terminal event.
- **Nothing follows the terminal event.** The session ledger delivers no event
  after it and numbers none.
- **The outcome is recorded once.** The first `failed` or `cancelled` stands,
  and `close` answers what the terminal event said.

## The sequences

Event sequences of a session whose turn never completes (the fake's `hang`
mode), by how it was stopped. `reason` is the reason the caller gave.

| Stop | Before | Now |
| --- | --- | --- |
| `cancel()` alone | `session.started`, `model.resolved`, `session.closed` (`cancelled`, reason), `error` (`VES_CODEX_PROCESS_FAILED`); `close` answers `failed` | `session.started`, `model.resolved`, `error` (`VES_CODEX_ABORTED`), `session.closed` (`cancelled`, reason); `close` answers `cancelled` |
| The start signal, then `cancel()` (the session runner's stop) | `session.started`, `model.resolved`, `session.closed` (`cancelled`, reason), `error` (`VES_CODEX_ABORTED`); `close` answers `cancelled` | `session.started`, `model.resolved`, `error` (`VES_CODEX_ABORTED`), `session.closed` (`cancelled`, reason); `close` answers `cancelled` |
| The start signal alone | `session.started`, `model.resolved`, `error` (`VES_CODEX_ABORTED`); `close` emits `session.closed` (`cancelled`) and answers `cancelled` | unchanged |

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`CodexDriver` runs against the labeled deterministic fake
`spikes/codex-driver/test/fake-codex-app-server.mjs`.

`pnpm qualify:codex` runs
`spikes/codex-driver/test/codex-driver-cancel-order.test.mjs`, which runs the
contract the four drivers share
(`tests/helpers/driver-cancel-order-fixture.mjs`) and pins each sequence
whole:

- A cancel of a running session, and the session runner's stop, each end in
  the sequence of the table. The provider is stopped once. After the close
  nothing more reaches the sink, the sequence numbers have no gap, and the
  close answers the outcome of the terminal event.
- An aborted start signal alone ends as it did.
- A session whose run had failed (`error` mode: `error`
  (`VES_CODEX_EXECUTION_FAILED`), `usage.updated`) and is then cancelled ends
  with `session.closed` (`failed`, reason), and its close answers `failed`.
- A stream that failed before the stop keeps its own report. In the fake's
  `garbled` mode the provider writes a line that is not JSON, says one more
  thing, and never answers; the stop is asked for when that last thing
  arrives. The session ends `content.delta`, `error`
  (`VES_CODEX_STREAM_INVALID`), `session.closed` (`failed`, reason), for a
  cancel and for the session runner's stop.

Also covered:

- `tests/contract/driver-session-ledger.test.mjs` asserts the order at the
  session ledger's interface.
- `tests/contract/driver-lifecycle-matrix.test.mjs` asserts the contract for
  all four drivers: one terminal event that nothing follows, a failure before
  the stop that stays a failure, and a stop after the session completed and
  closed that changes nothing.
- `tests/integration/driver-session-runner-drivers.test.mjs` pins what the
  session runner answers for a session cancelled behind its back: `cancelled`,
  with `VES_CODEX_ABORTED` as the one error code.
- `tests/integration/codex-verifier-session.test.mjs`, the T04 suite and the
  process-tree suite pass unmodified.

## What a caller can notice

- A session cancelled through `cancel()` alone reports `VES_CODEX_ABORTED`
  where it reported `VES_CODEX_PROCESS_FAILED`, and its close answers
  `cancelled` where it answered `failed`.
- The error event of a stopped run comes before the terminal event, never
  after it.
- `cancel()` of a running session resolves once the run has reported how it
  ended and the terminal event is out. It used to resolve as soon as the
  provider had been told to stop.
- A session whose stream had failed, or that had reported a failure, before it
  was stopped closes as `failed` under the code of that failure. It used to
  close as `cancelled`.
- Through the session runner nothing changes in the outcome: a stop is still
  `cancelled`. The error code it reports for a stop is the same,
  `VES_CODEX_ABORTED`; for a stream that had failed before the stop it is now
  the code of that failure.

## What was not observed

None of the following was observed. Each is a statement about a real Codex
process that the fake cannot make.

| To observe in the first supervised run | Why the fake cannot show it |
| --- | --- |
| A real App Server that is terminated during a turn writes nothing the driver reads as a stream failure before it dies | The fake's `hang` mode writes nothing after the turn started |
| The time between the termination and the end of the run, which is now also the time `cancel()` takes | The fake dies at once and holds no pipe open |

## Limits

- Qualification uses a deterministic fake executable. Live behaviour is listed
  above and is not claimed.
- A cancel waits for the run, and the run waits for the provider's output to
  close. Where the terminator cannot reach a process that holds that output
  open, the cancel waits as long as the run does.
- A session that is closed while its run is still in flight is terminal at
  once. What the run reports afterwards is dropped, including an error. The
  session runner never closes a session before its run has ended.
- A terminator that fails leaves the session open and cancellable, as before.
  The run is then already marked as stopped and ends as `VES_CODEX_ABORTED`
  whenever the provider exits.
- Nothing here was run on Windows. The change adds no platform-specific code.
  On Windows the exit of a terminated process is reported differently than on
  POSIX; the run no longer reads the exit to classify a stop, because the stop
  marks it first.
