# Pi Driver Requalification: The Usage Rule

**Task:** T6 (ADR2-6) of `.specs/features/architecture-deepening-2/`
**Status:** Candidate pending independent verification, human review, and a
platform matrix run on the branch
**Qualified packages:** unchanged, `@earendil-works/pi-agent-core@0.87.1` and
`@earendil-works/pi-ai@0.87.1`. No provider was contacted and no model was
invoked. What changed is how the driver reads the token counts its runtime
relays.
**Supersedes:** nothing. `docs/qualification/pi-runtime.md` and
`docs/qualification/pi-runtime-0.87.1.md` remain the evidence for the Pi
runtime and for the qualified package versions, and
`docs/qualification/pi-driver-cancel-order.md` for what a stopped session
emits. The exact version pin, the agent options, and every error code and
message are unchanged.

## Why the driver is requalified

A Driver event is now a declared, closed type, stated once in
`packages/domain/src/driver-event/driver-event.ts` with the one rule every
driver reads its provider's token counts through: a count is read as a
number, an absent count is 0, and a count that is then not a non-negative
safe integer is refused. The Claude Code, Codex and OpenCode drivers each
wrote that rule before, and moved onto it with no change to what they emit.

The Pi driver had no check. It emitted the counts of the agent's last
assistant message as the runtime relayed them: a count given as text stayed
text, an absent count was emitted as `undefined`, and a negative, fractional
or unsafe count was emitted as it was and reached whatever metered it.

## What changed

- **The counts go through the usage rule.** A count the rule reads is
  emitted as the number it reads: text, `null`, an absent count, a boolean
  and a one-element array, as for the other three drivers.
- **A refused count is a runtime failure.** The run reports
  `VES_PI_RUNTIME_FAILED`, as a run with no assistant message already does,
  emits no usage event, and its close answers `failed`. That holds for a
  provider error with such a count as well, where the run reported
  `VES_PI_PROVIDER_ERROR`: a count that is not a count outranks the
  provider's own report, as it does for Claude Code and Codex.
- **A stop comes first.** A run whose agent reports the stop reason
  `aborted` still reports `VES_PI_ABORTED` and closes as `cancelled`, with no
  usage event when its count is refused. The first end of a run decides how
  it is reported, as for every driver (AD-053, AD-060).
- A message with no usage at all still ends in the run's error handler, as
  `VES_PI_RUNTIME_FAILED`, or `VES_PI_ABORTED` when the start signal was
  aborted, as before.

## The sequences

Each row is a session through its close, against a stream that ends with one
message carrying the given usage.

| Run | Before (`main` at `6fae651`) | Now |
| --- | --- | --- |
| Counts as text, `"12"` and `"3"` | `session.started`, `model.resolved`, `usage.updated` (`"12"`, `"3"`), `session.closed` (`completed`) | the same, with `usage.updated` (`12`, `3`) |
| No input count | `usage.updated` with `inputTokens: undefined`, `completed` | `usage.updated` (`0`, `3`), `completed` |
| Input count `null` | `usage.updated` (`null`, `3`), `completed` | `usage.updated` (`0`, `3`), `completed` |
| Counts `true` and `[3]` | `usage.updated` (`true`, `[3]`), `completed` | `usage.updated` (`1`, `3`), `completed` |
| A count of `-1`, `1.5` or `2^53` | `usage.updated` with that count, `session.closed` (`completed`) | `session.started`, `model.resolved`, `error` (`VES_PI_RUNTIME_FAILED`), `session.closed` (`failed`) |
| Stop reason `error`, a count of `-1` | `usage.updated` (`-1`, `0`), `error` (`VES_PI_PROVIDER_ERROR`), `failed` | `error` (`VES_PI_RUNTIME_FAILED`), `failed` |
| Stop reason `aborted`, a count of `-1` | `usage.updated` (`-1`, `0`), `error` (`VES_PI_ABORTED`), `cancelled` | `error` (`VES_PI_ABORTED`), `cancelled` |

Every run whose counts are non-negative safe integers emits the same bytes as
before, a `-0` included.

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`PiDriver` runs the installed Pi agent with a stream that ends with one
message carrying the given usage and stop reason
(`piUsageFixture` in `tests/helpers/pi-driver-fixture.mjs`).

`pnpm qualify:pi` runs `spikes/pi-runtime/test/pi-driver-usage.test.mjs`,
which pins the nine runs of the table whole: the event sequence through the
close, the counts of the usage event where there is one, and the outcome the
close answers. Against the driver of `main` all nine fail.

Also covered:

- `tests/unit/driver-event.test.mjs` asserts the usage rule value by value.
- The usage axis of `tests/contract/driver-lifecycle-matrix.test.mjs` runs
  the same two cases against the four drivers: a count given as text is read
  as that count and an absent one as 0, and a refused count fails the run
  with the driver's own code (`VES_PI_RUNTIME_FAILED` for Pi). Against the
  driver of `main` both Pi cases fail.
- `tests/architecture/driver-event-locality.test.mjs` fails when a driver
  builds a usage event or checks a count outside the event module.
- **Transcripts.** 26 recorded Pi scenarios, each run against the driver of
  `main` and of the branch
  (`.specs/features/architecture-deepening-2/validation-t6.md`): 17 are
  byte-identical, among them every completed run, tool request, provider
  error, output limit, empty response, follow-up and stop, and the nine that
  differ are the rows of this table.
- The Pi cancel order suite, the agent release suite and the T34 contract
  pass unmodified.

## What a caller can notice

- A Pi session whose runtime relays a count as text, `null`, a boolean or a
  one-element array, or leaves it out, emits the number the usage rule reads.
- A Pi session whose runtime relays a negative, fractional or unsafe count
  fails with `VES_PI_RUNTIME_FAILED` and emits no usage event, where it
  emitted the count and could close as `completed`. A provider error with
  such a count is `VES_PI_RUNTIME_FAILED`, where it was
  `VES_PI_PROVIDER_ERROR`.
- No composition runs the Pi driver; the sealed launcher names it only.

## What was not observed

| To observe with a real provider | Why the faux machinery cannot show it |
| --- | --- |
| That a real provider never relays a count the usage rule refuses | The stream reports what the case gives it |

## Limits

- Qualification uses Pi's faux machinery. Live behaviour is listed above and
  is not claimed.
- Nothing here was run on Windows. The change has no platform-specific code,
  and this driver starts no process.
