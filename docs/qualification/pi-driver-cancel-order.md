# Pi Driver Requalification: Cancel Order

**Task:** the cancel order defect recorded by ADP-3 and ADP-4 of
`.specs/features/architecture-deepening/`
**Status:** Candidate pending independent verification, human review, and a
platform matrix run on the branch
**Qualified packages:** unchanged, `@earendil-works/pi-agent-core@0.87.1` and
`@earendil-works/pi-ai@0.87.1`. No provider was contacted and no model was
invoked. What changed is what the driver emits when a running session is
stopped.
**Supersedes:** nothing. `docs/qualification/pi-runtime.md` and
`docs/qualification/pi-runtime-0.87.1.md` remain the evidence for the Pi
runtime and for the qualified package versions. The exact version pin, the
agent options, and every error code and message are unchanged.

## Why the driver is requalified

Cancelling a running session through `cancel()` emitted the terminal event
`session.closed` with the outcome `cancelled`, then an error event, and
`close` answered `failed`. ADP-3 recorded that and kept it, and ADP-4 made the
session runner classify a stop as `cancelled` whatever the driver said
afterwards.

The cause in this driver is an order, not a missing mark. A cancel aborts the
agent, waits until it is idle, emits the terminal event, and releases the
agent, which resets its transcript. The agent is idle before the run has read
how it ended, and the run reads that from the transcript. So the run looked
for its final message in a transcript the cancel had just reset, found none,
and reported `VES_PI_RUNTIME_FAILED`. It did so for the session runner's stop
as well, where the start signal is aborted first.

## What changed

- **The run reports before the terminal event.** The driver tells its session
  ledger when the run has reported how it ended, and a cancel that stopped the
  agent waits for that before it emits the terminal event and releases the
  agent. The run then finds the aborted message it was looking for and ends as
  `VES_PI_ABORTED`, as it always did for an aborted start signal alone.
- **Nothing follows the terminal event.** The session ledger delivers no event
  after it and numbers none.
- **The outcome is recorded once.** The first `failed` or `cancelled` stands,
  and `close` answers what the terminal event said.

The stop hook and the release hook themselves are unchanged: a cancel still
aborts the agent and waits for it, and a cancel and the first close still
unsubscribe from the agent and reset it.

## The sequences

Event sequences of a session whose provider stream ends only when it is
aborted, by how it was stopped. `reason` is the reason the caller gave.

| Stop | Before | Now |
| --- | --- | --- |
| `cancel()` alone | `session.started`, `model.resolved`, `session.closed` (`cancelled`, reason), `error` (`VES_PI_RUNTIME_FAILED`); `close` answers `failed` | `session.started`, `model.resolved`, `usage.updated`, `error` (`VES_PI_ABORTED`), `session.closed` (`cancelled`, reason); `close` answers `cancelled` |
| The start signal, then `cancel()` (the session runner's stop) | `session.started`, `model.resolved`, `session.closed` (`cancelled`, reason), `error` (`VES_PI_RUNTIME_FAILED`); `close` answers `failed` | `session.started`, `model.resolved`, `usage.updated`, `error` (`VES_PI_ABORTED`), `session.closed` (`cancelled`, reason); `close` answers `cancelled` |
| The start signal alone | `session.started`, `model.resolved`, `usage.updated`, `error` (`VES_PI_ABORTED`); `close` emits `session.closed` (`cancelled`) and answers `cancelled` | unchanged |

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`PiDriver` runs the installed Pi agent against Pi's own faux provider, with a
stream that ends only when its signal is aborted
(`tests/helpers/pi-driver-fixture.mjs`).

`pnpm qualify:pi` runs `spikes/pi-runtime/test/pi-driver-cancel-order.test.mjs`,
which runs the contract the four drivers share
(`tests/helpers/driver-cancel-order-fixture.mjs`) and pins each sequence
whole:

- A cancel of a running session, and the session runner's stop, each end in
  the sequence of the table. The provider stream is aborted once. After the
  close nothing more reaches the sink, the sequence numbers have no gap, and
  the close answers the outcome of the terminal event.
- An aborted start signal alone ends as it did.
- A session whose run had failed (a provider response that fails:
  `content.delta`, `usage.updated`, `error` (`VES_PI_PROVIDER_ERROR`)) and is
  then cancelled ends with `session.closed` (`failed`, reason), and its close
  answers `failed`.

Also covered:

- `tests/contract/driver-session-ledger.test.mjs` asserts the order at the
  session ledger's interface.
- `tests/contract/driver-lifecycle-matrix.test.mjs` asserts the contract for
  all four drivers.
- `tests/integration/driver-session-runner-drivers.test.mjs` pins what the
  session runner answers for a session cancelled behind its back: `cancelled`,
  with `VES_PI_ABORTED` as the one error code.
- `tests/integration/pi-driver-agent-release.test.mjs` passes unmodified: a
  cancel of a running session still releases the agent before any close.

## What a caller can notice

- A stopped session reports `usage.updated` and `VES_PI_ABORTED` where it
  reported `VES_PI_RUNTIME_FAILED`, and its close answers `cancelled` where it
  answered `failed`. That holds for `cancel()` alone and for the session
  runner's stop.
- The error event of a stopped run comes before the terminal event, never
  after it.
- `cancel()` of a running session resolves once the run has reported how it
  ended and the terminal event is out.
- A session that had failed and is then cancelled closes as `failed`. It used
  to close as `cancelled`.
- Through the session runner the outcome of a stop is `cancelled`, as before.
  The error code it reports for a stop is `VES_PI_ABORTED`, where it was
  `VES_PI_RUNTIME_FAILED`.

## What was not observed

| To observe with a real provider | Why the faux provider cannot show it |
| --- | --- |
| A real provider stream that is aborted ends the agent's run with an aborted message, as the faux stream does | The faux stream is written to end that way |

## Limits

- Qualification uses Pi's faux provider. Live behaviour is listed above and is
  not claimed.
- A cancel during a follow-up sent with `send` aborts the agent and waits for
  it, as before. A follow-up reports no end of its own, so the cancel waits
  for nothing more.
- A start whose sink throws rejects, as before; a run that ends that way has
  still told the session ledger that it ended.
- A session that is closed while its run is still in flight is terminal at
  once. What the run reports afterwards is dropped, including an error. The
  session runner never closes a session before its run has ended.
- Nothing here was run on Windows. The change has no platform-specific code,
  and this driver starts no process.
