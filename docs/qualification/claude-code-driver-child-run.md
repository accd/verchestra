# Claude Code Driver Requalification: One Provider Child Run

**Task:** T3 (ADR2-3) of `.specs/features/architecture-deepening-2/`
**Status:** Candidate pending independent verification, human review, and a
platform matrix run on the branch
**Installed Claude Code observed:** none for this change. Nothing here ran a
real Claude Code process, and no model was invoked. What changed is how the
driver reads and reports the run of its child, not what it asks of Claude
Code.
**Supersedes:** nothing. `docs/qualification/claude-code-driver.md` (T03
profile), `docs/qualification/claude-code-driver-mediated.md` (`mediated-mcp`),
`docs/qualification/claude-code-driver-subscription.md`
(`mediated-mcp-subscription`), `docs/qualification/claude-code-driver-process-tree.md`,
`docs/qualification/claude-code-driver-cancel-order.md` and
`docs/qualification/claude-code-driver-provider-ends.md` remain the evidence
for each profile's invocation, for how the provider is started and stopped,
for what a stopped session emits, and for how a provider ends. No argument,
environment variable, working directory, stream-surface check or message
changed, and no error code was added.

## Why the driver is requalified

The driver no longer writes its own child run. The spawn in a process group
of its own, the output limit, the line and JSON framing, the one termination
per child and the end-of-run rule now live in
`packages/drivers/src/provider-child-run.ts`, which the Codex driver uses as
well; the driver keeps its stream-json translation. The Codex copy of those
rules and this driver's copy had drifted, and they were wrong together on two
more. Taking one rule for each changes what this driver reports in six runs
that no qualification suite pinned. Every other run is unchanged, which the
transcripts cited below show.

## What changed

- **The first end of a run decides its report** (D1). A stop or a stream
  failure, whichever came first. The driver used to report the last of
  several stream failures, and let a broken line that followed a stop replace
  the stop's report.
- **A run that ended before its result is read by its exit** (D2):
  `VES_CLAUDE_PROCESS_FAILED` for a non-zero exit or a signal,
  `VES_CLAUDE_STREAM_INCOMPLETE` for a clean exit. The driver used to report
  `VES_CLAUDE_STREAM_INCOMPLETE` whatever the exit. The T03 qualification
  spike already read the exit first. A `result` event counts only once the
  `init` event announced the session; one before it leaves the run without a
  result.
- **Every line is a JSON object** (H1). A line that parses to `null`, a
  string, a number, a boolean or an array is `VES_CLAUDE_STREAM_INVALID`. A
  `null` line used to throw inside the line listener, an uncaught exception
  that ended the host process; a string was taken for the run's error code.
- **A spawn that fails ends the run** (H2) as `VES_CLAUDE_PROCESS_FAILED`.
  The child's `error` event used to go unheard, which ended the host process.
- Unchanged: the exit after a result is still part of it. In print mode
  Claude Code exits by itself, so a non-zero exit after a result is still
  `VES_CLAUDE_PROCESS_FAILED`, and the driver still ends nothing at a normal
  end (the provider-ends requalification).

## The sequences

Each row is a session through its close. `reason` is the reason of the
cancel.

| Run | Before (`main` at `7e10272`) | Now |
| --- | --- | --- |
| The provider exits 3 before its result (`crash`) | `session.started`, `model.resolved`, `error` (`VES_CLAUDE_STREAM_INCOMPLETE`), `session.closed` (`failed`) | `session.started`, `model.resolved`, `error` (`VES_CLAUDE_PROCESS_FAILED`), `session.closed` (`failed`) |
| A `result` before any `init`, then a clean exit (`unannounced`) | `usage.updated`, `error` (`VES_CLAUDE_PROCESS_FAILED`), `session.closed` (`failed`) | `usage.updated`, `error` (`VES_CLAUDE_STREAM_INCOMPLETE`), `session.closed` (`failed`) |
| A broken line, then a line past the output limit of 1024 bytes (`broken-then-flood`) | …, `error` (`VES_CLAUDE_OUTPUT_LIMIT`), `session.closed` (`failed`) | …, `error` (`VES_CLAUDE_STREAM_INVALID`), `session.closed` (`failed`) |
| Cancelled when it says it is ready; a broken line follows before it dies (`late-garble`) | …, `content.delta`, `error` (`VES_CLAUDE_STREAM_INVALID`), `session.closed` (`failed`, reason); `close` answers `failed` | …, `content.delta`, `error` (`VES_CLAUDE_ABORTED`), `session.closed` (`cancelled`, reason); `close` answers `cancelled` |
| A line `null`, then a string line (`not-an-object`) | the host process ends: `TypeError: Cannot read properties of null (reading 'type')` | …, `error` (`VES_CLAUDE_STREAM_INVALID`), `session.closed` (`failed`); the provider is ended once |
| A line that is the string `"VES_CLAUDE_ABORTED"` (`code-line`) | …, `error` (`VES_CLAUDE_ABORTED`, "Claude Code stream failed"), `session.closed` (`failed`) | …, `error` (`VES_CLAUDE_STREAM_INVALID`), `session.closed` (`failed`) |
| The executable is gone when it is spawned | the host process ends: uncaught `spawn … ENOENT` | `error` (`VES_CLAUDE_PROCESS_FAILED`), `session.closed` (`failed`); nothing is observed or terminated |

The same holds with a signal in place of the exit code in the first row.

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`ClaudeCodeDriver` runs against the labeled deterministic fake
`spikes/claude-code-driver/test/fake-claude.mjs`, which gains the modes
`crash`, `unannounced`, `broken-then-flood`, `late-garble`, `code-line`,
`not-an-object` and `exit-after-result`; no existing mode changed.

`pnpm qualify:claude` runs
`spikes/claude-code-driver/test/claude-driver-child-run.test.mjs`, which runs
the shared contract `tests/helpers/driver-child-run-fixture.mjs` and pins the
first six rows of the table whole, through the close: the event sequence,
what `close` answers, and how often the injected terminator was asked (once
for each run that failed or was stopped while the provider ran, never for a
provider that exited by itself). Against the driver of `main` all six fail,
each with the "before" value of the table.

Also covered:

- **A spawn that fails** cannot be produced through this driver by the
  labeled fake on every platform: it needs the executable to go between the
  probe and the spawn. The module's own suite
  (`tests/integration/provider-child-run.test.mjs`, the last two cases) runs
  it on every platform with a missing executable, and the transcripts below
  run it through this driver on macOS.
- `tests/contract/driver-lifecycle-matrix.test.mjs`, its child run axis,
  asserts this driver's codes and terminations for each way its provider
  ends.
- **Transcripts.** 49 recorded Claude Code scenarios, each run against the
  driver of `main` and of the branch, on macOS and again with Windows forced
  (`.specs/features/architecture-deepening-2/validation-t3.md`, section 5):
  41 are byte-identical, among them every normal end, stream failure, output
  limit, input failure and cancel, and the eight that differ are the rows of
  this table and its signal variant.
- The T03, mediated, subscription, process-tree, cancel order and
  provider-ends suites pass unmodified.

## What a caller can notice

- A provider that dies before its result with a non-zero code or a signal is
  `VES_CLAUDE_PROCESS_FAILED`, where it was `VES_CLAUDE_STREAM_INCOMPLETE`.
  The message, "Claude Code process failed", is the same.
- A `result` before the `init` event, followed by a clean exit, is
  `VES_CLAUDE_STREAM_INCOMPLETE`, where it was `VES_CLAUDE_PROCESS_FAILED`.
- Of several stream failures the first is reported.
- A cancelled session closes as `cancelled` with `VES_CLAUDE_ABORTED`, even
  when the provider writes a broken line before it dies.
- A line that is not a JSON object fails the session where it ended the host
  process, or where a string line chose the run's error code.
- A provider that cannot be spawned fails its session where it ended the host
  process.

## What was not observed

| To observe in the first supervised run | Why the fake cannot show it |
| --- | --- |
| A real `claude` that dies before its result, and the exit it dies with | The fake chooses its exit |
| A real `claude` that writes a partial line when it is terminated | The fake writes whole lines |

## Limits

- Qualification uses a deterministic fake executable. Live behaviour is listed
  above and is not claimed.
- A spawn that fails is proven through this driver on macOS only; on every
  platform it is proven at the module's interface.
- Nothing here was run on Windows. The module's only platform branch is the
  process group the first round introduced; the transcripts with Windows
  forced agree with those of macOS.
