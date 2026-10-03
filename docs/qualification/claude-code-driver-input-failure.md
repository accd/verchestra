# Claude Code Driver Requalification: An Input That Fails After the Provider Finished

**Task:** a fix to T3 (ADR2-3, AD-060) of `.specs/features/architecture-deepening-2/`
**Status:** Candidate pending independent verification, human review, and a
platform matrix run on the branch
**Installed Claude Code observed:** none for this change. Nothing here ran a
real Claude Code process, and no model was invoked.
**Corrects:** `docs/qualification/claude-code-driver-child-run.md`, which
states that the driver still ends nothing at a normal end, and
`docs/qualification/claude-code-driver-provider-ends.md`, which states the
same ("a run that ends normally ... the driver therefore has no end at which
the provider is still running"). Both held only while the driver's write of
the prompt reached the provider before the provider had finished. Neither
report is edited; this one records where they did not hold and what now
holds. Every other statement of both stands.
**Supersedes:** nothing else. No argument, environment variable, working
directory, stream check, error code or message changed.

## Why the driver is requalified

The platform matrix of a later branch failed one case of the provider child
run's suite on macOS x64: a provider that writes its result and exits by
itself ended as `…_STDIN_FAILED`, `failed`, with one request to terminate it.
The cause, reproduced on macOS arm64 under parallel load (4 of 60 runs) and
traced with the run instrumented:

1. The driver spawns `claude` and writes its prompt at once. A host that
   deschedules the run right after the spawn lets a fast provider announce
   itself, report its result and exit before that write happens.
2. The write then finds the provider's input closed and fails with `EPIPE`,
   before the run has read the result line and before it has seen the
   provider exit, both of which were already waiting.
3. The child run took any failed write to the provider's input as the run's
   end, at once: it reported `VES_CLAUDE_STDIN_FAILED`, closed the session as
   `failed`, and asked the injected terminator to end a provider that had
   already exited.

The same rule was in the driver before the provider child run: a failed write
to the input always failed the run, and since the provider-ends
requalification it also ended the provider. A completed print session on a
loaded host could be failed this way before T3 as after it.

## What changed

A failed write to the provider's input is weighed once the output and the
exit that were already waiting have been read, after at least one poll of the
event loop. It then fails the run only if the provider still runs and has not
delivered its result:

- a provider that delivered its result, and then exited by itself, is decided
  by its result and its exit, as any provider that exits by itself;
- a provider that died without its result is decided by its exit
  (`VES_CLAUDE_PROCESS_FAILED` for a non-zero code or a signal);
- an input that fails after the result changes nothing;
- a provider that closed its input and still runs without its result is
  `VES_CLAUDE_STDIN_FAILED` and is ended once, as before.

The first end of a run still decides its report (AD-060): a stop or a stream
failure recorded before the input failure is weighed keeps its report. The
exit after a result is still part of a Claude Code result.

## The sequences

| Run | Before | Now |
| --- | --- | --- |
| The provider announces itself, reports its result and exits 0 before the driver writes its prompt | `session.started`, `model.resolved`, `usage.updated`, `error` (`VES_CLAUDE_STDIN_FAILED`), `session.closed` (`failed`); the terminator is asked once | `session.started`, `model.resolved`, `usage.updated`, `session.closed` (`completed`); the terminator is not asked |
| The provider closes its input before reading a prompt larger than the pipe holds, and stays (`deaf`) | `…`, `error` (`VES_CLAUDE_STDIN_FAILED`), `session.closed` (`failed`); ended once | unchanged |

## What the deterministic fake proved

The production `ClaudeCodeDriver` runs against the labeled deterministic fake
`spikes/claude-code-driver/test/fake-claude.mjs`, which gains the mode
`hasty`: it announces itself, reports its result and exits 0 without reading
its input.

`pnpm qualify:claude` runs
`spikes/claude-code-driver/test/claude-driver-input-failure.test.mjs`, which
pins the first row of the table through the close. The order is made certain
through the driver's own spawn observer, which blocks the run until the
provider has exited (on POSIX, until the process table shows it as exited and
not yet reaped), before the driver writes its prompt. Against the driver of
`main` the case fails with the "before" sequence.

Also covered:

- `tests/integration/provider-child-run.test.mjs` asserts the rule at the
  module's interface for both profiles: a provider that delivers its result
  and exits before the first write completes; one that dies before the first
  write is reported by its exit; an input that fails after the result changes
  nothing. Each run starts from a callback of the event loop's poll phase,
  where a failed write weighed too early would decide it. Against the module
  of `main` all six cases fail.
- The `deaf` cases of the provider-ends suite, of the module's suite and of
  the lifecycle matrix pass unmodified.
- **Transcripts.** The 92 scenarios recorded for T3, 49 of them Claude Code,
  run against the drivers of `main` and of the branch, on macOS and again
  with Windows forced: all 92 are byte-identical
  (`.specs/features/architecture-deepening-2/validation-t3-input.md`).
- The failing case of the matrix, repeated 180 times under parallel load:
  3 failures with the module of `main`, none with the branch.

## The Codex driver

The Codex driver runs its App Server through the same module, so it shared
the rule; no Codex completion can meet this order. An App Server answers
nothing before it has read `initialize`, the driver's first write, and every
later write is a request or an answer the App Server waits for before its
turn completes. What a Codex caller can notice is narrower: an App Server
that dies before the driver's first write is now always reported as the
protocol failure its pending `initialize` meets (`VES_CODEX_PROTOCOL_FAILED`),
where a loaded host could report `VES_CODEX_STDIN_FAILED`. No Codex sequence
that a suite pins changed, and the Codex reports state nothing this corrects.

## What a caller can notice

- A print session whose provider finished before the driver wrote its prompt
  closes as `completed`, where a loaded host could close it as `failed` with
  `VES_CLAUDE_STDIN_FAILED`.
- The terminator is no longer asked to end a provider that has already
  exited because of such a write.
- A provider that closed its input and still runs is ended one poll of the
  event loop later than before.

## What was not observed

| To observe in the first supervised run | Why the fake cannot show it |
| --- | --- |
| A real `claude` that reads its prompt before it answers, as it must, so the order above needs a provider that answers without its prompt | The fake chooses not to read |

## Limits

- Qualification uses a deterministic fake executable. Live behaviour is listed
  above and is not claimed.
- A provider that closes its input, keeps running, and then delivers its
  result is still an input failure: it is weighed before that result exists.
- On win32 the order is made by a fixed two-second wait instead of the
  process table, and nothing here was run on Windows.
