# Codex Driver Requalification: How a Provider Ends

**Task:** follow-up to ADP-4 (T4d) of `.specs/features/architecture-deepening/`
**Status:** Candidate pending independent verification, human review, and a
platform matrix run on the branch
**Installed Codex CLI observed:** none for this change. Nothing here ran a real
Codex process, and no model was invoked. What changed is how Verchestra ends
the child process when no one stopped the session.
**Supersedes:** nothing. `docs/qualification/codex-driver.md` remains the
evidence for the T04 qualification,
`docs/qualification/codex-driver-process-tree.md` for how the provider is
started and for how a stop terminates its tree, and
`docs/qualification/codex-driver-cancel-order.md` for what a stopped session
emits. The App Server protocol, the read-only sandbox, the approval policy,
the environment, the working directory, and every error code and message are
unchanged.

## Why the driver is requalified

The process-tree requalification made a stop terminate the provider's whole
process tree, once per child. A stop is one of several ways the driver ends
its provider, and the others still signalled the one `codex app-server`
process with `child.kill()`:

- a stream that failed: a line that is not JSON, an invalid or undeclared tool
  call, invalid usage, an output limit, a failed write to the provider's
  input;
- the end of a run whose provider had not exited. The App Server does not exit
  when a turn completes, so this is the end of every completed turn, and of a
  run that ended on a protocol failure.

A descendant of the provider survived each of these. One that held the
provider's output open also kept the session waiting, because the driver waits
for that pipe to close.

## What changed

- **Every end goes through the one termination per child.** A stream failure
  and the end of a run with the provider still running now ask for the same
  single termination as a stop: the terminator the composition injects, or
  the fallback that signals the provider's group. The driver no longer signals
  its child itself.
- **Such an end is not awaited, and its failure is contained.** `child.kill()`
  could not throw. A termination can fail, and no caller awaits these ends, so
  a failure there is contained; the run still waits for the provider's own
  exit.
- **A completed turn ends the provider through the terminator.** With the
  terminator `vestra task` injects, that is the tree routine of
  `packages/platform-node/src/process-tree-terminator.ts`: it reads the
  process table, sends `SIGKILL` to the provider's group, confirms that the
  group is gone, and kills every recorded descendant. It used to be one
  `SIGTERM` to the App Server. With no terminator injected it is one `SIGTERM`
  to the provider's group (to the one process on Windows).

Unchanged: a stop. An aborted start signal still sends `turn/interrupt` first
and escalates after the grace period; a cancel still terminates at once. At
the end of a run the termination is asked for only while the provider has not
been seen to exit, as before.

No event sequence changed. A session whose stream failed still reports that
failure's code and closes as `failed`, and a completed turn still closes as
`completed`.

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`CodexDriver` runs against the labeled deterministic fake
`spikes/codex-driver/test/fake-codex-app-server.mjs`. With `FAKE_CODEX_FORK=1`
the fake starts, in any mode, one idle process that stays in its process group
and inherits its output and one that leaves the group with `setsid()`, and
names all three processes before the mode acts.

`pnpm qualify:codex` runs
`spikes/codex-driver/test/codex-driver-provider-ends.test.mjs`. The terminator
is the one the task composition injects. On macOS and Linux, for a provider
with that tree:

- It writes a line that is not JSON and stays alive (`garbled`). The run ends
  by itself with `VES_CODEX_STREAM_INVALID`, the session closes as `failed`,
  and none of the three processes is alive.
- It exceeds its output limit and stays alive (`large`). The run ends with
  `VES_CODEX_OUTPUT_LIMIT`, and none of the three processes is alive.
- It completes its turn and does not exit (`linger`). The run ends with no
  error, the session closes as `completed`, and none of the three processes is
  alive.

In each case the run ending is itself evidence: with only the provider
signalled, the descendant that holds its output keeps the run waiting.

On Windows the same three cases assert what holds there: the session ends as
reported, and the provider process, which the fake keeps alive until it is
terminated, is gone.

Also covered:

- `tests/integration/driver-process-tree.test.mjs` asserts on every platform
  that each of these ends asks the injected terminator once, and that an end
  no caller awaits contains a termination that fails.
- `tests/architecture/provider-process-tree-termination.test.mjs` fails when
  the driver signals its child itself.
- The T04 suite, the process-tree suite, the cancel order suite and the
  verifier suite of `vestra task` pass unmodified.

## What an operator can notice

- Nothing Codex started outlives a session that ended on a failure or on a
  completed turn, and such a session no longer waits for a process Codex left
  behind.
- Under `vestra task` the independent verifier's App Server is killed with
  `SIGKILL` at the end of every verification, together with whatever it
  started. It used to receive `SIGTERM`.
- If a provider's processes could not be confirmed stopped at the end of a
  run, `vestra` says so on stderr, as it already did for a stop.

## What was not observed

None of the following was observed. Each is a statement about a real Codex
process that the fake cannot make.

| To observe in the first supervised run | Why the fake cannot show it |
| --- | --- |
| A real App Server that is killed after a completed ephemeral turn leaves nothing behind that a later session trips over | The fake keeps no state |
| The processes a real App Server has running when its turn completes are all gone afterwards | The fake starts two idle processes of its own choosing |

## Limits

- Qualification uses a deterministic fake executable. Live behaviour is listed
  above and is not claimed.
- A provider that has already exited when its run ends is not swept: nothing
  is terminated, and a descendant it left behind stays. A stop of a session
  whose provider exited but whose output is still held open still terminates
  the group, as before.
- A stream failure that is noticed after the provider has exited still asks
  for the termination, as a stop does. That reaches what is left of the
  provider's group. `child.kill()` did nothing at that point. The limit of the
  process-tree requalification on a reused process id applies to it.
- A termination that fails at one of these ends is contained and not
  reported by the driver. The task composition's terminator names a tree it
  could not confirm stopped on stderr.
- The limits of the process-tree requalification apply unchanged: the tree is
  found through the process table, an escapee whose parent had exited is not
  found, and Windows has no process groups.
- Nothing here was run on Windows.
