# Codex Driver Requalification: One Provider Child Run

**Task:** T3 (ADR2-3) of `.specs/features/architecture-deepening-2/`
**Status:** Candidate pending independent verification, human review, and a
platform matrix run on the branch
**Installed Codex CLI observed:** none for this change. Nothing here ran a
real Codex process, and no model was invoked. What changed is how the driver
reads the lines of its child and what happens when the child cannot be
started, not what it asks of the App Server.
**Supersedes:** nothing. `docs/qualification/codex-driver.md` remains the
evidence for the T04 qualification, and
`docs/qualification/codex-driver-process-tree.md`,
`docs/qualification/codex-driver-cancel-order.md` and
`docs/qualification/codex-driver-provider-ends.md` for how the provider is
started and stopped, what a stopped session emits, and how a provider ends.
The App Server protocol, the read-only sandbox, the approval policy, the
environment, the working directory and every message are unchanged, and no
error code was added.

## Why the driver is requalified

The driver no longer writes its own child run. The spawn in a process group
of its own, the output limit, the line and JSON framing, the one termination
per child and the end-of-run rule now live in
`packages/drivers/src/provider-child-run.ts`, which the Claude Code driver
uses as well; the driver keeps its App Server translation. This driver's
rules became the shared ones: the first end of a run decides its report, a
run that ended before its turn completed is read by its exit, and the exit
after a completed turn is not read, because the driver ends the App Server
itself. Two things it shared with the Claude Code driver were wrong, and
their fixes change what this driver does in three runs no qualification
suite pinned. Every other run is unchanged.

## What changed

- **Every line is a JSON object** (H1). A line that parses to `null`, a
  string, a number, a boolean or an array is `VES_CODEX_STREAM_INVALID`, and
  the provider is ended through its one termination. A `null` line used to
  throw inside the line listener, an uncaught exception that ended the host
  process. A number, string, boolean or array line used to be ignored, so a
  turn that completed after one closed as `completed`.
- **A spawn that fails ends the run** (H2). The child's `error` event used to
  go unheard, which ended the host process. The close that follows now
  rejects the pending `initialize` request, so the run reports
  `VES_CODEX_PROTOCOL_FAILED`, as for an App Server that exits before it
  answers.
- **A start signal's stop whose termination fails is contained.** The grace
  period's timer used to leave the rejection unhandled; no composition injects
  a terminator that rejects.

## The sequences

Each row is a session through its close.

| Run | Before (`main` at `7e10272`) | Now |
| --- | --- | --- |
| After `turn/start`, a line `null`, then a string line (`not-an-object`) | the host process ends: `TypeError: Cannot read properties of null (reading 'id')` | `session.started`, `model.resolved`, `error` (`VES_CODEX_STREAM_INVALID`), `session.closed` (`failed`); the provider is ended once |
| After `turn/start`, the lines `5`, `true` and `[1]`, then `turn/completed` (`primitive-lines`) | `session.started`, `model.resolved`, `usage.updated`, `session.closed` (`completed`) | `session.started`, `model.resolved`, `usage.updated`, `error` (`VES_CODEX_STREAM_INVALID`), `session.closed` (`failed`); the provider is ended once |
| The executable is gone when it is spawned | the host process ends: uncaught `spawn … ENOENT` | `error` (`VES_CODEX_PROTOCOL_FAILED`), `session.closed` (`failed`); nothing is observed or terminated |

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`CodexDriver` runs against the labeled deterministic fake
`spikes/codex-driver/test/fake-codex-app-server.mjs`, which gains the modes
`not-an-object`, `primitive-lines`, `crash` and `exit-after-result`; no
existing mode changed.

`pnpm qualify:codex` runs
`spikes/codex-driver/test/codex-driver-child-run.test.mjs`, which runs the
shared contract `tests/helpers/driver-child-run-fixture.mjs` and pins the
first two rows of the table whole, through the close: the event sequence,
what `close` answers, and that the injected terminator was asked once.
Against the driver of `main` both fail: the first with the uncaught
`TypeError`, the second closing `completed`.

Also covered:

- **A spawn that fails** cannot be produced through this driver by the
  labeled fake on every platform: it needs the executable to go between the
  probe and the spawn. The module's own suite
  (`tests/integration/provider-child-run.test.mjs`, the last two cases) runs
  it on every platform, and the transcripts below run it through this driver
  on macOS.
- `tests/contract/driver-lifecycle-matrix.test.mjs`, its child run axis,
  asserts this driver's codes and terminations for each way its provider
  ends, a turn that completes and exits with a failure included: it still
  closes as `completed`.
- **Transcripts.** 43 recorded Codex scenarios, each run against the driver
  of `main` and of the branch, on macOS and again with Windows forced
  (`.specs/features/architecture-deepening-2/validation-t3.md`, section 5):
  40 are byte-identical, among them every normal end, stream failure,
  protocol failure, output limit and cancel, and the three that differ are
  the rows of this table.
- The T04, process-tree, cancel order and provider-ends suites pass
  unmodified.

## What a caller can notice

- A session whose App Server writes a line that is a JSON number, string,
  boolean or array fails with `VES_CODEX_STREAM_INVALID`, where it went on
  and could close as `completed`.
- A line `null` fails the session where it ended the host process.
- A provider that cannot be spawned fails its session with
  `VES_CODEX_PROTOCOL_FAILED` where it ended the host process.

## What was not observed

| To observe in the first supervised run | Why the fake cannot show it |
| --- | --- |
| That a real App Server writes no line that is not a JSON object | The fake writes what its mode says |

## Limits

- Qualification uses a deterministic fake executable. Live behaviour is listed
  above and is not claimed.
- A spawn that fails is proven through this driver on macOS only; on every
  platform it is proven at the module's interface.
- Nothing here was run on Windows. The transcripts with Windows forced agree
  with those of macOS.
