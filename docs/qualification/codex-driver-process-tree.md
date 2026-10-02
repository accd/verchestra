# Codex Driver Requalification: Process-Tree Termination

**Task:** ADP-4 (T4d) of `.specs/features/architecture-deepening/`
**Status:** Candidate pending independent verification, human review, a
platform matrix run on the branch, and the owner's first supervised run
**Installed Codex CLI observed:** none for this change. Nothing here ran a real
Codex process, and no model was invoked. What changed is how Verchestra starts
and stops the child process, not what it asks of it.
**Supersedes:** nothing. `docs/qualification/codex-driver.md` remains the
evidence for the T04 qualification. The App Server protocol, the read-only
sandbox, the approval policy, the environment, and the working directory are
unchanged.

## Why the driver is requalified

Stopping a session used to signal one process: the `codex app-server` process
the driver started. Two things followed.

- Anything that process had started kept running after a cancel.
- A descendant that inherited the provider's output kept that pipe open. The
  driver waits for the pipe to close before a session ends, so the session
  waited for as long as the descendant lived. For `vestra task` that is the
  independent verifier, and a cancel during verification waited with it.

Requirement ADP-4 says that cancelling a Codex session terminates its whole
process tree.

## What changed

- **Process group.** On macOS and Linux the driver starts `codex app-server`
  with `detached`, so the child leads a process group and a session of its
  own. On Windows the spawn is unchanged; Windows has no process groups.
- **Fallback terminator.** A composition that injects no terminator used to
  signal the one process with `SIGTERM`. It now sends `SIGTERM` to the
  provider's group (to the one process on Windows). A fallback that finds
  nothing left to stop no longer rejects.
- **Injected terminator.** `CodexDriverDependencies.terminateTree` is unchanged
  in shape. The `vestra task` composition used to inject a `SIGKILL` of the
  one process. It now injects the tree terminator of
  `packages/platform-node/src/process-tree-terminator.ts`
  (`terminateProcessTree`): it records the provider's descendants from the
  process table, sends `SIGKILL` to the provider's group, confirms that the
  group is gone, and then kills every recorded descendant, which reaches one
  that left the group with `setsid()`. The driver package still imports
  nothing from `platform-node`.

Unchanged: an aborted start signal still sends `turn/interrupt` first and
escalates to the terminator after the execution's grace period. A cancel
through `Driver.cancel` stops the provider at once, as it did.

One thing changed in the `vestra task` composition rather than in the driver.
The verifier's session now runs through the driver session runner, which
cancels the session when it is stopped. A verifier that is cancelled, or that
reaches its budget, is therefore stopped at once instead of after the
interrupt grace period.

## What the deterministic fake proved

Mandatory gates contact no provider and invoke no model. The production
`CodexDriver` runs against the labeled deterministic fake
`spikes/codex-driver/test/fake-codex-app-server.mjs` in its `fork` mode. In
that mode the fake completes the handshake, opens a thread and a turn, starts
one idle process that stays in its process group and inherits its output,
starts one idle process that leaves the group with `setsid()`, names all three
processes, and never completes the turn.

`pnpm qualify:codex` runs
`spikes/codex-driver/test/codex-driver-process-tree.test.mjs`. The terminator
in these cases is the one the task composition injects. On macOS and Linux:

- Before anything is stopped, the provider leads a process group that is not
  the caller's, the first descendant is in that group, and the second is not.
- A cancel ends the run and leaves none of the three processes alive. The run
  ending is itself evidence: with only the provider killed, the descendant
  that holds its output would keep the run waiting.
- An aborted start signal does the same after the interrupt grace period, and
  the session closes as cancelled.
- With no terminator injected, a cancel still stops the provider and the
  descendant in its group. The descendant that left the group survives the
  fallback. That is what the fallback cannot reach and why the task
  composition always injects the tree terminator.

On Windows the same three cases assert what holds there: a stopped session
ends, its terminal event says cancelled, and the provider process is gone.

Also covered:

- `tests/integration/process-tree-termination.test.mjs` runs the terminator
  itself against a three-process tree: a group signal alone leaves the
  `setsid()` escapee alive, and `terminateProcessTree` leaves nothing alive.
- `tests/integration/codex-verifier-session.test.mjs` runs the verifier as
  `vestra task` composes it, against the labeled fake
  `tests/helpers/task-cli-fakes/fake-codex-task.mjs`: a verifier that forked
  the same two processes is cancelled, the session ends, and all three are
  gone.
- `tests/integration/driver-process-tree.test.mjs` covers what the two drivers
  share: which terminator a driver uses, and a fallback that stops a group and
  resolves when nothing is left to stop.
- `tests/integration/task-process-tree.test.mjs` shows that the task
  composition's terminator resolves for a live provider, for a tree that is
  already gone, and for a kill the runtime refuses.
- `tests/architecture/provider-process-tree-termination.test.mjs` fails when
  the driver stops starting its provider in its own group, when the task
  composition builds a provider driver without the tree terminator, or when a
  task source signals a process itself.
- The existing Codex suites pass unmodified against the new spawn.

## What an operator can notice

- A cancel during verification stops everything Codex started, and no longer
  waits for a process Codex left behind.
- Codex no longer receives the terminal's own signals. Ctrl-C reaches
  `vestra`, which aborts the run and kills the tree.
- If the `vestra` process itself is killed with `SIGKILL`, or its terminal
  goes away, nothing stops Codex. It runs until its closed pipes make it exit.
  Before this change a terminal hang-up reached it directly.

## What was not observed

None of the following was observed. Each is a statement about a real Codex
process that the fake cannot make.

| To observe in the first supervised run | Why the fake cannot show it |
| --- | --- |
| `codex app-server` works when it leads its own session and has no controlling terminal | The fake reads no terminal |
| The processes a real read-only session starts are all gone after a cancel | The fake starts two idle processes of its own choosing |
| A real App Server exits by itself once `vestra` is gone and its input is closed | The fake's `fork` mode never exits by itself |

## Limits

- Qualification uses a deterministic fake executable. Live behaviour is listed
  above and is not claimed.
- A descendant that left the group is found only through the chain of parents
  that links it to the provider when the stop begins. One whose parent had
  already exited has been re-parented and is not found.
- The process table is read with `ps`. Where it cannot be read, only the group
  signal applies and an escapee survives.
- The task composition's terminator never rejects, because the driver calls it
  from an abort timer. A tree that could not be confirmed gone is therefore
  not reported: the session still ends, and it ends as cancelled.
- A process identifier recorded before the kill can be reused by an unrelated
  process of the same user before the recorded descendant is killed. The
  window is the time the group kill takes.
- Windows has no process groups. The terminator kills the tree there through
  `taskkill /T /F`. The `vestra task` path stays refused on Windows, so the
  tree terminator is reachable there only through another composition.
- This is process control, not an OS sandbox.
