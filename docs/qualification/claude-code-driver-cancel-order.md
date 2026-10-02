# Claude Code Driver Requalification: Cancel Order

**Task:** the cancel order defect recorded by ADP-3 and ADP-4 of
`.specs/features/architecture-deepening/`
**Status:** Candidate pending independent verification, human review, and a
platform matrix run on the branch
**Installed Claude Code observed:** none for this change. Nothing here ran a
real Claude Code process, and no model was invoked. What changed is what the
driver emits when a running session is stopped, not what it asks of Claude
Code.
**Supersedes:** nothing. `docs/qualification/claude-code-driver.md` (T03
profile), `docs/qualification/claude-code-driver-mediated.md` (`mediated-mcp`),
`docs/qualification/claude-code-driver-subscription.md`
(`mediated-mcp-subscription`) and
`docs/qualification/claude-code-driver-process-tree.md` remain the evidence for
each profile's invocation and for how the provider is started and stopped. No
argument, environment variable, working directory, stream check, error code or
message changed.

## Why the driver is requalified

Cancelling a running session through `cancel()` emitted the terminal event
`session.closed` with the outcome `cancelled`, then an error event, and
`close` answered `failed`. ADP-3 recorded that and kept it, and ADP-4 made the
session runner classify a stop as `cancelled` whatever the driver said
afterwards.

The cause in this driver: the cancel terminated the `claude` process through
the session ledger's stop hook, and the run was not told. The ledger emitted
the terminal event as soon as the terminator had resolved. The run noticed
only when the child's exit handler ran, afterwards, and what it saw was a
process that had ended with no result. It reported that as
`VES_CLAUDE_STREAM_INCOMPLETE` and recorded `failed`.

## What changed

- **The cancel marks the run as stopped.** A cancel asks for the provider's
  termination through the same request as an aborted start signal, which
  marks the run before the provider is terminated. The run then ends as
  `VES_CLAUDE_ABORTED`, as it always did for an aborted start signal. The one
  termination per child of the process-tree requalification is unchanged: the
  start signal, a failing stream and a cancel still share one request.
- **The run reports before the terminal event.** The driver tells its session
  ledger when the run has reported how it ended, and a cancel that stopped the
  provider waits for that before it emits the terminal event.
- **Nothing follows the terminal event.** The session ledger delivers no event
  after it and numbers none.
- **The outcome is recorded once.** The first `failed` or `cancelled` stands,
  and `close` answers what the terminal event said. A stop therefore does not
  relabel a failure that preceded it: a stream that had failed before the stop
  is still reported under its own code, and the session ends `failed`.

## The sequences

Event sequences of a session whose provider never answers (the fake's `hang`
mode), by how it was stopped. `reason` is the reason the caller gave.

| Stop | Before | Now |
| --- | --- | --- |
| `cancel()` alone | `session.started`, `model.resolved`, `session.closed` (`cancelled`, reason), `error` (`VES_CLAUDE_STREAM_INCOMPLETE`); `close` answers `failed` | `session.started`, `model.resolved`, `error` (`VES_CLAUDE_ABORTED`), `session.closed` (`cancelled`, reason); `close` answers `cancelled` |
| The start signal, then `cancel()` (the session runner's stop) | `session.started`, `model.resolved`, `session.closed` (`cancelled`, reason), `error` (`VES_CLAUDE_ABORTED`); `close` answers `cancelled` | `session.started`, `model.resolved`, `error` (`VES_CLAUDE_ABORTED`), `session.closed` (`cancelled`, reason); `close` answers `cancelled` |
| The start signal alone | `session.started`, `model.resolved`, `error` (`VES_CLAUDE_ABORTED`); `close` emits `session.closed` (`cancelled`) and answers `cancelled` | unchanged |

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`ClaudeCodeDriver` runs against the labeled deterministic fake
`spikes/claude-code-driver/test/fake-claude.mjs`.

`pnpm qualify:claude` runs
`spikes/claude-code-driver/test/claude-driver-cancel-order.test.mjs`, which
runs the contract the four drivers share
(`tests/helpers/driver-cancel-order-fixture.mjs`) and pins each sequence
whole:

- A cancel of a running session, and the session runner's stop, each end in
  the sequence of the table. The provider is stopped once. After the close
  nothing more reaches the sink, the sequence numbers have no gap, and the
  close answers the outcome of the terminal event.
- An aborted start signal alone ends as it did.
- A session whose run had failed (`error` mode: `usage.updated`, `error`
  (`VES_CLAUDE_EXECUTION_FAILED`)) and is then cancelled ends with
  `session.closed` (`failed`, reason), and its close answers `failed`.
- A stream that failed before the stop keeps its own report. In the fake's
  `garbled` mode the provider writes a line that is not JSON, says one more
  thing, and never answers; the stop is asked for when that last thing
  arrives. The session ends `content.delta`, `error`
  (`VES_CLAUDE_STREAM_INVALID`), `session.closed` (`failed`, reason), for a
  cancel and for the session runner's stop.

Also covered:

- `tests/contract/driver-session-ledger.test.mjs` asserts the order at the
  session ledger's interface: the wait for the run, the terminal event as the
  last event, the outcome recorded once.
- `tests/contract/driver-lifecycle-matrix.test.mjs` asserts the contract for
  all four drivers: one terminal event that nothing follows, a failure before
  the stop that stays a failure, and a stop after the session completed and
  closed that changes nothing.
- `tests/integration/driver-session-runner-drivers.test.mjs` pins what the
  session runner answers for a session cancelled behind its back: `cancelled`,
  with `VES_CLAUDE_ABORTED` as the one error code.
- The suites of the three profiles and of the process-tree requalification
  pass unmodified.

## What a caller can notice

- A session cancelled through `cancel()` alone reports `VES_CLAUDE_ABORTED`
  where it reported `VES_CLAUDE_STREAM_INCOMPLETE`, and its close answers
  `cancelled` where it answered `failed`.
- The error event of a stopped run comes before the terminal event, never
  after it. A consumer that read an event after `session.closed` reads none.
- `cancel()` of a running session resolves once the run has reported how it
  ended and the terminal event is out. It used to resolve as soon as the
  provider had been told to stop.
- A session that had failed and is then cancelled, or whose start signal is
  then aborted, closes as `failed`. It used to close as `cancelled`. Its
  terminal event still carries the reason of the cancel.
- Through the session runner nothing changes in the outcome: a stop is still
  `cancelled`, and the error codes it reports for a stop are the same.

## What was not observed

None of the following was observed. Each is a statement about a real Claude
Code process that the fake cannot make.

| To observe in the first supervised run | Why the fake cannot show it |
| --- | --- |
| A real session that is cancelled writes nothing the driver reads as a stream failure before it dies | The fake's `hang` mode writes nothing after its first line |
| The time between the termination and the end of the run, which is now also the time `cancel()` takes | The fake dies at once and holds no pipe open |

## Limits

- Qualification uses a deterministic fake executable. Live behaviour is listed
  above and is not claimed.
- A cancel waits for the run, and the run waits for the provider's output to
  close. Where the terminator cannot reach a process that holds that output
  open, the cancel waits as long as the run does. The task composition
  injects the tree terminator, which reaches such a process on macOS and
  Linux.
- A session that is closed while its run is still in flight is terminal at
  once. What the run reports afterwards is dropped, including an error. The
  session runner never closes a session before its run has ended.
- A terminator that fails leaves the session open and cancellable, as before.
  The run is then already marked as stopped, as it is after an aborted start
  signal, and ends as `VES_CLAUDE_ABORTED` whenever the provider exits.
- Nothing here was run on Windows. The change adds no platform-specific code:
  the cancel uses the single termination per child that the process-tree
  requalification introduced for Windows.
