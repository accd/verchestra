# OpenCode Driver Requalification: Cancel Order

**Task:** the cancel order defect recorded by ADP-3 and ADP-4 of
`.specs/features/architecture-deepening/`
**Status:** Candidate pending independent verification, human review, and a
platform matrix run on the branch
**Installed OpenCode observed:** none for this change. Nothing here ran a real
OpenCode server, and no model was invoked. What changed is what a cancel does
and what the driver emits when a running session is stopped.
**Supersedes:** nothing. `docs/qualification/opencode-driver.md` (T05) and
`docs/qualification/opencode-driver-1.18.33.md` remain the evidence for the
protocol and for the qualified package versions. The server options, the
permission configuration, the environment, the supported floor, and every
error code and message are unchanged.

## Why the driver is requalified

Two things were wrong when a running session was cancelled through `cancel()`.

- **The provider was not stopped.** The cancel recorded the terminal state and
  nothing else. The SDK session was aborted only through the start signal, so
  after a cancel alone the provider kept working, and its content, usage and
  tool requests followed the terminal event `session.closed`.
- **The abort was reported after the terminal event.** When the start signal
  was aborted and the session cancelled, as the session runner does, the
  terminal event came first and `VES_OPENCODE_ABORTED` after it.

ADP-3 recorded the second and kept it, and ADP-4 made the session runner
classify a stop as `cancelled` whatever the driver said afterwards. The first
was found while the sequences were recorded for this change.

## What changed

- **A cancel stops the provider.** The driver gives its session ledger a stop
  hook, as the other three drivers do. A cancel aborts the SDK session and
  closes the isolated server through the same path as an aborted start signal.
- **The run reports before the terminal event.** The driver tells its session
  ledger when the run has reported how it ended, and a cancel that stopped the
  provider waits for that before it emits the terminal event.
- **Nothing follows the terminal event.** The session ledger delivers no event
  after it and numbers none.
- **The outcome is recorded once.** The first `failed` or `cancelled` stands,
  and `close` answers what the terminal event said.

## The sequences

Event sequences of a session whose provider stream never ends (the fake
client's `hang` mode), by how it was stopped. `reason` is the reason the caller
gave.

| Stop | Before | Now |
| --- | --- | --- |
| `cancel()` alone | `session.started`, `model.resolved`, `session.closed` (`cancelled`, reason); the provider is not stopped, the run does not end, and whatever the provider still sends follows the terminal event | `session.started`, `model.resolved`, `error` (`VES_OPENCODE_ABORTED`), `session.closed` (`cancelled`, reason); the SDK session is aborted and the server closed; `close` answers `cancelled` |
| The start signal, then `cancel()` (the session runner's stop) | `session.started`, `model.resolved`, `session.closed` (`cancelled`, reason), `error` (`VES_OPENCODE_ABORTED`); `close` answers `cancelled` | `session.started`, `model.resolved`, `error` (`VES_OPENCODE_ABORTED`), `session.closed` (`cancelled`, reason); `close` answers `cancelled` |
| The start signal alone | `session.started`, `model.resolved`, `error` (`VES_OPENCODE_ABORTED`); `close` emits `session.closed` (`cancelled`) and answers `cancelled` | unchanged |

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`OpenCodeDriver` runs against the labeled deterministic fake SDK client of
`tests/helpers/opencode-driver-fixture.mjs`; the fake executable
`spikes/opencode-driver/test/fake-opencode.mjs` answers the version probe. No
server process is started.

`pnpm qualify:opencode` runs
`spikes/opencode-driver/test/opencode-driver-cancel-order.test.mjs`, which runs
the contract the four drivers share
(`tests/helpers/driver-cancel-order-fixture.mjs`) and pins each sequence
whole:

- A cancel of a running session, and the session runner's stop, each end in
  the sequence of the table. The SDK session is aborted once. After the close
  nothing more reaches the sink, the sequence numbers have no gap, and the
  close answers the outcome of the terminal event.
- An aborted start signal alone ends as it did.
- A session whose run had failed (`error` mode: `error`
  (`VES_OPENCODE_EXECUTION_FAILED`), `usage.updated`) and is then cancelled
  ends with `session.closed` (`failed`, reason), and its close answers
  `failed`.
- A cancel waits for a run that reports late. The fake client is stopped
  while it is still creating its session and answers only when the case lets
  it; until then no terminal event is emitted, and afterwards the sequence is
  that of the table.

Also covered:

- `tests/contract/driver-session-ledger.test.mjs` asserts the order at the
  session ledger's interface.
- `tests/contract/driver-lifecycle-matrix.test.mjs` asserts the contract for
  all four drivers, and that a cancel stops the running provider before the
  terminal event. OpenCode had no row for a running session before.
- `tests/integration/driver-session-runner-drivers.test.mjs` runs the session
  runner against this driver, which it did not before, and pins what it
  answers for a session cancelled behind its back: `cancelled`, with
  `VES_OPENCODE_ABORTED` as the one error code.
- The T05 suite, the lifecycle suite and the security suite pass unmodified.

## What a caller can notice

- `cancel()` of a running session stops the provider. It used to leave it
  running.
- A session cancelled through `cancel()` alone reports `VES_OPENCODE_ABORTED`
  before its terminal event, and its run ends. It used to report nothing and
  to run on.
- The error event of a stopped run comes before the terminal event, never
  after it. Nothing the provider still sends after the terminal event reaches
  the sink.
- A session that had failed and is then stopped closes as `failed`. It used to
  close as `cancelled`.
- Through the session runner nothing changes in the outcome or in the error
  code of a stop.

## What was not observed

None of the following was observed. Each is a statement about a real OpenCode
server that the fake cannot make.

| To observe with a real server | Why the fake cannot show it |
| --- | --- |
| What a real server still sends on its event stream between the abort and its own exit | The fake stream sends nothing after the abort |
| Whether a real server reports the abort as a `session.error` on that stream | The fake does not react to the abort |

## Limits

- Qualification uses a deterministic fake SDK client. Live behaviour is listed
  above and is not claimed.
- The driver keeps reading the provider's event stream after a stop until the
  server's exit ends it. An event that still arrives before the terminal event
  is delivered; one that arrives after it is dropped. A permission request
  among them is still put to the controller, as it was after an aborted start
  signal. A failure the provider reports after the stop does not change the
  outcome, which is recorded once.
- A session that is closed while its run is still in flight is terminal at
  once. What the run reports afterwards is dropped, including an error. The
  session runner never closes a session before its run has ended.
- No composition of this repository runs the driver's own server factory; the
  Self-Test scenario injects one. How the isolated server process itself is
  ended is not part of this change.
- Nothing here was run on Windows. The change has no platform-specific code.
