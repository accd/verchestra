# Claude Code Driver Requalification: How a Provider Ends

**Task:** follow-up to ADP-4 (T4d) of `.specs/features/architecture-deepening/`
**Status:** Candidate pending independent verification, human review, and a
platform matrix run on the branch
**Installed Claude Code observed:** none for this change. Nothing here ran a
real Claude Code process, and no model was invoked. What changed is how
Verchestra ends the child process when no one stopped the session.
**Supersedes:** nothing. `docs/qualification/claude-code-driver.md` (T03
profile), `docs/qualification/claude-code-driver-mediated.md` (`mediated-mcp`),
`docs/qualification/claude-code-driver-subscription.md`
(`mediated-mcp-subscription`),
`docs/qualification/claude-code-driver-process-tree.md` and
`docs/qualification/claude-code-driver-cancel-order.md` remain the evidence for
each profile's invocation, for how the provider is started and stopped, and
for what a stopped session emits. No argument, environment variable, working
directory, stream check, error code or message changed.

## Why the driver is requalified

The process-tree requalification made a stop terminate the provider's whole
process tree, once per child, and this driver already ended a provider whose
stream had failed through the same termination. A review of every way the
driver ends its provider found one that did not:

- A provider that stopped reading its input was not ended at all. The driver
  recorded `VES_CLAUDE_STDIN_FAILED` and waited for the provider to exit by
  itself. A provider that stayed alive kept the session waiting, with
  everything it had started.

It also found one hazard on the paths that were already right: the driver did
not await the termination a failed stream asked for, so a termination that
failed was an unhandled rejection.

## What changed

- **A provider that stops reading its input is ended.** The failed write asks
  for the same single termination per child as a stream failure and a stop.
- **An end no caller awaits contains its failure.** A stream that failed, an
  output limit and a failed input write ask for the termination without
  awaiting it. A termination that fails there is contained; the run still
  waits for the provider's own exit. A stop is unchanged: a cancel whose
  termination fails still rejects and leaves the session open.

No event sequence changed. A session whose input write failed still reports
`VES_CLAUDE_STDIN_FAILED` and closes as `failed`.

## What was reviewed and left as it is

- **A run that ends normally.** In print mode `claude` exits by itself after
  its result, and the driver reads the exit code as part of that result
  (`VES_CLAUDE_PROCESS_FAILED` for anything but zero). The driver therefore
  has no end at which the provider is still running by design, and none was
  added. A provider that reports its result and never exits keeps its session
  waiting until the session is stopped, as before.
- **A provider that has exited.** Nothing is terminated once the provider has
  been seen to exit; a descendant it left behind, and that holds no output of
  its own, stays.

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`ClaudeCodeDriver` runs against the labeled deterministic fake
`spikes/claude-code-driver/test/fake-claude.mjs`. With `FAKE_CLAUDE_FORK=1` the
fake starts, in any mode, one idle process that stays in its process group and
inherits its output and one that leaves the group with `setsid()`, and names
all three processes before the mode acts.

`pnpm qualify:claude` runs
`spikes/claude-code-driver/test/claude-driver-provider-ends.test.mjs`. The
terminator is the one the task composition injects. On macOS and Linux, for a
provider with that tree:

- It writes a line that is not JSON and stays alive (`garbled`). The run ends
  by itself with `VES_CLAUDE_STREAM_INVALID`, the session closes as `failed`,
  and none of the three processes is alive.
- It exceeds its output limit and stays alive (`flood`). The run ends with
  `VES_CLAUDE_OUTPUT_LIMIT`, and none of the three processes is alive.
- It closes its input before it has read its prompt and stays alive (`deaf`).
  The run ends with `VES_CLAUDE_STDIN_FAILED`, and none of the three processes
  is alive.

On Windows the same three cases assert what holds there: the session ends as
reported, and the provider process, which the fake keeps alive until it is
terminated, is gone.

Also covered:

- `tests/integration/driver-process-tree.test.mjs` asserts on every platform
  that a provider which stops reading its input is ended through one request
  to the injected terminator, and that an end no caller awaits contains a
  termination that fails.
- `tests/architecture/provider-process-tree-termination.test.mjs` fails when
  the driver signals its child itself.
- The suites of the three profiles, the process-tree suite and the cancel
  order suite pass unmodified.

## What an operator can notice

- A session whose provider stopped reading its input ends, and nothing the
  provider started outlives it. It used to wait for the provider.

## What was not observed

| To observe in the first supervised run | Why the fake cannot show it |
| --- | --- |
| Whether a real Claude Code process ever closes its input while it keeps running | The fake does so on purpose |

## Limits

- Qualification uses a deterministic fake executable. Live behaviour is listed
  above and is not claimed.
- A termination that fails at one of these ends is contained and not reported
  by the driver. The task composition's terminator names a tree it could not
  confirm stopped on stderr.
- The limits of the process-tree requalification apply unchanged.
- Nothing here was run on Windows.
